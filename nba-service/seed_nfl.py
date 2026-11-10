"""
Seed Neon Postgres with NFL data from nflverse (https://github.com/nflverse/nflverse-data).

Why nflverse: Pro-Football-Reference is behind a Cloudflare JS challenge and can't be
scraped by scripts. nflverse publishes free CSVs (stats 1999+, rosters, draft picks) that
are updated nightly during the season. 1980-1998 will be backfilled later from manually
exported PFR CSVs.

What it loads (all nfl_* tables, see nfl_schema.sql):
  nfl_teams, nfl_team_seasons, nfl_players, nfl_roster_players,
  nfl_player_season_stats, nfl_team_defense_season_stats, nfl_rookie_profiles

Usage (run locally, from nba-service/):
  python seed_nfl.py                    # full seed 1999 → current season
  python seed_nfl.py --current-only     # weekly refresh: current rosters/stats + rookies
  python seed_nfl.py --start 2020       # partial range
  python seed_nfl.py --skip-madden      # don't scrape Madden rookie ratings

DATABASE_URL is read from the environment, or from nba-service/.env.local.
Idempotent: every write is an upsert; current-season roster rows are replaced so cut/traded
players drop off.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import logging
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("seed_nfl")

HERE = Path(__file__).resolve().parent
CACHE_DIR = HERE / ".nflverse_cache"
SCHEMA_PATH = HERE / "nfl_schema.sql"
NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download"
MADDEN_URL = "https://www.ea.com/games/madden-nfl/ratings?rookie=true&page={page}"
BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)

FIRST_SEASON = 1999  # first season with nflverse player stats

# Historical abbreviations → current franchise id.
FRANCHISE_MAP = {"OAK": "LV", "SD": "LAC", "STL": "LA", "LAR": "LA"}
DISPLAY_ABBR = {"LA": "LAR"}  # nflverse uses "LA" for the Rams

# Roster statuses kept for the current-season roster: active, injured reserve, inactive.
# Excludes practice squad (DEV), CUT, RET, TRD, etc.
CURRENT_ROSTER_STATUSES = {"ACT", "RES", "INA"}

# Keep in sync with RAW_POSITION_MAP in lib/nfl-rules.js. Unlisted labels (OL, K, P, LS…) → None.
RAW_POSITION_MAP = {
    "QB": "QB",
    "RB": "RB", "HB": "RB", "FB": "RB", "TB": "RB",
    "WR": "WR", "FL": "WR", "SE": "WR",
    "TE": "TE",
    "DE": "DE", "EDGE": "DE", "LEDG": "DE", "REDG": "DE", "LDE": "DE", "RDE": "DE",
    "DT": "DT", "NT": "DT", "DL": "DT", "LDT": "DT", "RDT": "DT",
    "LB": "LB", "OLB": "LB", "ILB": "LB", "MLB": "LB", "MIKE": "LB", "WILL": "LB", "SAM": "LB",
    "LOLB": "LB", "ROLB": "LB", "LILB": "LB", "RILB": "LB",
    "CB": "CB", "LCB": "CB", "RCB": "CB",
    "S": "S", "FS": "S", "SS": "S",
    "DB": "DB",
}

# Madden attributes worth keeping per position group (for rookie projections).
MADDEN_ATTRS = [
    "overall", "speed", "acceleration", "agility", "strength", "awareness",
    "throwPower", "throwAccuracyShort", "throwAccuracyMid", "throwAccuracyDeep", "throwOnTheRun",
    "carrying", "bCVision", "breakTackle", "elusiveness", "trucking", "stiffArm",
    "catching", "catchInTraffic", "spectacularCatch", "shortRouteRunning", "mediumRouteRunning",
    "deepRouteRunning", "release",
    "tackle", "hitPower", "pursuit", "playRecognition", "blockShedding", "finesseMoves",
    "powerMoves", "manCoverage", "zoneCoverage", "press",
]


# ---------------------------------------------------------------------------
# Pure helpers (unit tested in tests/test_seed_nfl.py)
# ---------------------------------------------------------------------------

def normalize_position(raw: Optional[str]) -> Optional[str]:
    """Map a raw position label to a canonical game position, or None (OL/K/P/LS/unknown)."""
    if not raw:
        return None
    for part in re.split(r"[/,\-\s]+", str(raw).upper()):
        if part in RAW_POSITION_MAP:
            return RAW_POSITION_MAP[part]
    return None


def franchise_id(abbr: str) -> str:
    return FRANCHISE_MAP.get(abbr, abbr)


def normalize_name(name: str) -> str:
    """Lowercase, strip accents/punctuation/suffixes for cross-source name matching."""
    n = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode()
    n = re.sub(r"[.'’`]", "", n.lower())
    n = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", n)
    return re.sub(r"[^a-z0-9]+", " ", n).strip()


def season_team_name(team_id: str, raw_abbr: str, season: int, current_name: str) -> str:
    """Name a franchise went by in a given season."""
    if raw_abbr == "OAK":
        return "Oakland Raiders"
    if raw_abbr == "SD":
        return "San Diego Chargers"
    if raw_abbr == "STL":
        return "St. Louis Rams"
    if team_id == "WAS":
        if season <= 2019:
            return "Washington"
        if season <= 2021:
            return "Washington Football Team"
    return current_name


def primary_positions(
    season_positions: Iterable[Tuple[str, int, Optional[str], int]],
) -> Dict[str, Optional[str]]:
    """
    Career primary position per player.

    season_positions: (player_id, season, normalized_position_or_None, games_played) tuples.
    Each season's listed position is weighted by games played that season (min 1), so a
    player is defined by where they spent most of their career. Ties → most recent season.
    Players whose dominant position is a non-game position (OL, K…) map to None.
    """
    weights: Dict[str, Counter] = defaultdict(Counter)
    latest: Dict[str, Dict[Optional[str], int]] = defaultdict(dict)
    for pid, season, pos, gp in season_positions:
        weights[pid][pos] += max(int(gp or 0), 1)
        latest[pid][pos] = max(latest[pid].get(pos, 0), season)
    result: Dict[str, Optional[str]] = {}
    for pid, counter in weights.items():
        result[pid] = max(counter, key=lambda p: (counter[p], latest[pid][p]))
    return result


def _num(v) -> float:
    try:
        return float(v) if v not in (None, "", "NA") else 0.0
    except ValueError:
        return 0.0


STAT_FIELDS = {
    "pass_cmp": ["completions"],
    "pass_att": ["attempts"],
    "pass_yds": ["passing_yards"],
    "pass_td": ["passing_tds"],
    "pass_int": ["passing_interceptions"],
    "pass_sacked": ["sacks_suffered"],
    "rush_att": ["carries"],
    "rush_yds": ["rushing_yards"],
    "rush_td": ["rushing_tds"],
    "fumbles_lost": ["rushing_fumbles_lost", "receiving_fumbles_lost", "sack_fumbles_lost"],
    "rec_tgt": ["targets"],
    "rec": ["receptions"],
    "rec_yds": ["receiving_yards"],
    "rec_td": ["receiving_tds"],
    "def_tackles": ["def_tackles_solo", "def_tackle_assists"],
    "def_sacks": ["def_sacks"],
    "def_int": ["def_interceptions"],
    "def_pass_defended": ["def_pass_defended"],
    "def_forced_fumbles": ["def_fumbles_forced"],
    "def_tfl": ["def_tackles_for_loss"],
}


def aggregate_player_weeks(rows: Iterable[dict]) -> Dict[Tuple[str, str, int], dict]:
    """
    Sum weekly regular-season rows into per (player_id, franchise_id, season) totals.
    gp = number of games with a stat line for that team (nflverse only emits a weekly row
    when a player records a stat, so this can undercount games for low-usage players).
    """
    out: Dict[Tuple[str, str, int], dict] = {}
    for r in rows:
        if r.get("season_type") != "REG" or not r.get("player_id"):
            continue
        key = (r["player_id"], franchise_id(r["team"]), int(r["season"]))
        agg = out.get(key)
        if agg is None:
            agg = {f: 0.0 for f in STAT_FIELDS}
            agg.update(
                gp=0,
                name=r.get("player_display_name") or r.get("player_name") or "",
                stat_position=r.get("position"),
            )
            out[key] = agg
        agg["gp"] += 1
        for field, cols in STAT_FIELDS.items():
            agg[field] += sum(_num(r.get(c)) for c in cols)
    return out


def aggregate_team_defense(
    team_weeks: Iterable[dict], games: Iterable[dict], season: int
) -> Dict[str, dict]:
    """
    Per-franchise defensive totals for one regular season.
    Yards/TDs allowed = what opponents' offenses gained against the team. Sacks and
    takeaways = the team's own defensive stats. Points allowed come from final scores.
    """
    d: Dict[str, dict] = defaultdict(lambda: defaultdict(float))
    for r in team_weeks:
        if r.get("season_type") != "REG":
            continue
        offense, defense = franchise_id(r["team"]), franchise_id(r["opponent_team"])
        # nflverse stores sack_yards_lost as a negative number; abs() keeps this sign-agnostic.
        net_pass = _num(r.get("passing_yards")) - abs(_num(r.get("sack_yards_lost")))
        d[defense]["pass_yds_allowed"] += net_pass
        d[defense]["rush_yds_allowed"] += _num(r.get("rushing_yards"))
        d[defense]["pass_td_allowed"] += _num(r.get("passing_tds"))
        d[defense]["rush_td_allowed"] += _num(r.get("rushing_tds"))
        d[defense]["plays_allowed"] += (
            _num(r.get("attempts")) + _num(r.get("carries")) + _num(r.get("sacks_suffered"))
        )
        d[offense]["sacks"] += _num(r.get("def_sacks"))
        d[offense]["interceptions"] += _num(r.get("def_interceptions"))
        d[offense]["fumbles_recovered"] += _num(r.get("fumble_recovery_opp"))

    for g in games:
        if int(g["season"]) != season or g["game_type"] != "REG" or g["home_score"] in ("", "NA"):
            continue
        home, away = franchise_id(g["home_team"]), franchise_id(g["away_team"])
        d[home]["points_allowed"] += _num(g["away_score"])
        d[away]["points_allowed"] += _num(g["home_score"])
        d[home]["games"] += 1
        d[away]["games"] += 1

    for t in d.values():
        t["yards_allowed"] = t["pass_yds_allowed"] + t["rush_yds_allowed"]
    return {k: dict(v) for k, v in d.items() if v.get("games")}


def team_records(games: Iterable[dict]) -> Dict[Tuple[str, int], dict]:
    """W/L/T per (franchise_id, season) from played regular-season games, plus raw abbr used."""
    rec: Dict[Tuple[str, int], dict] = {}
    for g in games:
        if g["game_type"] != "REG" or g["home_score"] in ("", "NA"):
            continue
        season = int(g["season"])
        hs, as_ = _num(g["home_score"]), _num(g["away_score"])
        for raw, own, opp in ((g["home_team"], hs, as_), (g["away_team"], as_, hs)):
            key = (franchise_id(raw), season)
            r = rec.setdefault(key, {"wins": 0, "losses": 0, "ties": 0, "raw_abbr": raw})
            if own > opp:
                r["wins"] += 1
            elif own < opp:
                r["losses"] += 1
            else:
                r["ties"] += 1
    return rec


def parse_madden_page(html: str) -> Tuple[List[dict], int]:
    """Extract rating items and total count from an EA ratings page's __NEXT_DATA__."""
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        raise ValueError("Madden page has no __NEXT_DATA__ — EA page structure changed")
    details = json.loads(m.group(1))["props"]["pageProps"]["ratingDetails"]
    return details["items"], int(details["totalItems"])


def match_madden(
    rookies: List[dict], madden_items: List[dict], nick_to_team: Dict[str, str]
) -> Dict[str, dict]:
    """
    Match roster rookies to Madden items by normalized name, using team to break ties.
    rookies: dicts with player_id, name, team_id. Returns player_id → madden item.
    """
    by_name: Dict[str, List[dict]] = defaultdict(list)
    for it in madden_items:
        by_name[normalize_name(f"{it.get('firstName', '')} {it.get('lastName', '')}")].append(it)

    def item_team(it: dict) -> Optional[str]:
        label = ((it.get("team") or {}).get("label") or "").strip()
        return nick_to_team.get(label.split(" ")[-1].lower()) if label else None

    out: Dict[str, dict] = {}
    for rk in rookies:
        cands = by_name.get(normalize_name(rk["name"]), [])
        same_team = [c for c in cands if item_team(c) == rk["team_id"]]
        if len(same_team) == 1:
            out[rk["player_id"]] = same_team[0]
        elif len(cands) == 1 and not same_team:
            out[rk["player_id"]] = cands[0]
    return out


def current_season(today: Optional[dt.date] = None) -> int:
    """Season in progress/upcoming. Jan-Feb belong to the previous season."""
    today = today or dt.date.today()
    return today.year - 1 if today.month <= 2 else today.year


# ---------------------------------------------------------------------------
# IO
# ---------------------------------------------------------------------------

def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    env_file = HERE / ".env.local"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1].strip().strip("'\"")
    sys.exit("DATABASE_URL not set (env var or nba-service/.env.local)")


def download(tag: str, name: str, refresh: bool = False) -> Optional[Path]:
    """Fetch an nflverse release asset into the local cache. Returns None if it doesn't exist."""
    CACHE_DIR.mkdir(exist_ok=True)
    path = CACHE_DIR / name
    if path.exists() and not refresh:
        return path
    url = f"{NFLVERSE}/{tag}/{name}"
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "knowball-seed"})
            with urllib.request.urlopen(req, timeout=120) as resp:
                path.write_bytes(resp.read())
            log.info("downloaded %s/%s", tag, name)
            return path
        except urllib.error.HTTPError as e:
            if e.code == 404:
                log.warning("not found: %s/%s", tag, name)
                return None
            log.warning("download %s failed (%s), retry %d", name, e, attempt + 1)
        except Exception as e:  # network hiccup
            log.warning("download %s failed (%s), retry %d", name, e, attempt + 1)
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"failed to download {url}")


def read_csv(path: Optional[Path]) -> List[dict]:
    if path is None:
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def fetch_madden_rookies() -> List[dict]:
    items: List[dict] = []
    page, total = 1, None
    while total is None or len(items) < total:
        req = urllib.request.Request(MADDEN_URL.format(page=page), headers={"User-Agent": BROWSER_UA})
        with urllib.request.urlopen(req, timeout=30) as resp:
            page_items, total = parse_madden_page(resp.read().decode("utf-8"))
        if not page_items:
            break
        items.extend(page_items)
        page += 1
        time.sleep(1)
    log.info("Madden: %d rookies (%s)", len(items), items[0]["iteration"]["label"] if items else "-")
    return items


# ---------------------------------------------------------------------------
# Seed
# ---------------------------------------------------------------------------

def seed(start: int, end: int, current_only: bool, skip_madden: bool) -> None:
    import psycopg2
    from psycopg2.extras import Json, execute_values

    roster_season = end
    seasons = [end] if current_only else list(range(start, end + 1))
    # Primary positions need career context even on a current-only refresh.
    position_seasons = list(range(FIRST_SEASON, end + 1))
    log.info("seasons %s..%s, roster season %d", seasons[0], seasons[-1], roster_season)

    # --- download ----------------------------------------------------------
    teams_csv = read_csv(download("teams", "teams_colors_logos.csv"))
    games = read_csv(download("schedules", "games.csv", refresh=True))
    draft = read_csv(download("draft_picks", "draft_picks.csv", refresh=True))
    rosters_by_season = {
        s: read_csv(download("rosters", f"roster_{s}.csv", refresh=(s == end)))
        for s in position_seasons
    }
    player_weeks: Dict[Tuple[str, str, int], dict] = {}
    for s in position_seasons:
        rows = read_csv(download("stats_player", f"stats_player_week_{s}.csv", refresh=(s == end)))
        player_weeks.update(aggregate_player_weeks(rows))
    team_weeks = {
        s: read_csv(download("stats_team", f"stats_team_week_{s}.csv", refresh=(s == end)))
        for s in seasons
    }

    # --- teams -------------------------------------------------------------
    current_teams = [t for t in teams_csv if t["team_abbr"] not in FRANCHISE_MAP]
    team_name = {t["team_abbr"]: t["team_name"] for t in current_teams}
    nick_to_team = {t["team_nick"].lower(): t["team_abbr"] for t in current_teams}
    team_rows = [
        (t["team_abbr"], t["team_name"], DISPLAY_ABBR.get(t["team_abbr"], t["team_abbr"]),
         t["team_conf"], t["team_division"])
        for t in current_teams
    ]
    assert len(team_rows) == 32, f"expected 32 franchises, got {len(team_rows)}"

    records = team_records(games)
    team_season_rows = [
        (tid, s, season_team_name(tid, r["raw_abbr"], s, team_name[tid]), r["wins"], r["losses"], r["ties"])
        for (tid, s), r in records.items()
        if s in seasons and tid in team_name
    ]

    # --- players & primary positions ---------------------------------------
    gp_by_player_season: Dict[Tuple[str, int], int] = defaultdict(int)
    for (pid, _tid, s), agg in player_weeks.items():
        gp_by_player_season[(pid, s)] += agg["gp"]

    info: Dict[str, dict] = {}
    season_positions: List[Tuple[str, int, Optional[str], int]] = []
    seen_ps = set()
    for s, rows in rosters_by_season.items():
        for r in rows:
            pid = r.get("gsis_id")
            if not pid or (pid, s) in seen_ps:
                continue
            seen_ps.add((pid, s))
            pos = normalize_position(r.get("depth_chart_position")) or normalize_position(r.get("position"))
            season_positions.append((pid, s, pos, gp_by_player_season.get((pid, s), 0)))
            info[pid] = {
                "name": r.get("full_name") or info.get(pid, {}).get("name") or "",
                "pfr_id": r.get("pfr_id") or info.get(pid, {}).get("pfr_id"),
                "birth_date": r.get("birth_date") or None,
                "college": r.get("college") or None,
            }
    # Players with stats but missing from roster files: fall back to the stats position.
    for (pid, _tid, s), agg in player_weeks.items():
        if (pid, s) not in seen_ps:
            seen_ps.add((pid, s))
            season_positions.append((pid, s, normalize_position(agg["stat_position"]), agg["gp"]))
        info.setdefault(pid, {"name": agg["name"], "pfr_id": None, "birth_date": None, "college": None})

    primary = primary_positions(season_positions)

    draft_by_gsis = {d["gsis_id"]: d for d in draft if d.get("gsis_id")}
    player_rows = []
    for pid, i in info.items():
        d = draft_by_gsis.get(pid, {})
        player_rows.append((
            pid, i["pfr_id"] or d.get("pfr_player_id") or None, i["name"], primary.get(pid),
            i["birth_date"], i["college"] or d.get("college") or None,
            int(d["season"]) if d.get("season") else None,
            int(d["round"]) if d.get("round") else None,
            int(d["pick"]) if d.get("pick") else None,
        ))

    # --- stats -------------------------------------------------------------
    stat_rows = []
    hist_roster_rows = []
    for (pid, tid, s), a in player_weeks.items():
        pos = primary.get(pid)
        if s not in seasons or pos is None or tid not in team_name:
            continue
        stat_rows.append((
            pid, tid, s, pos, int(a["gp"]), 0,
            int(a["pass_cmp"]), int(a["pass_att"]), int(a["pass_yds"]), int(a["pass_td"]),
            int(a["pass_int"]), int(a["pass_sacked"]),
            int(a["rush_att"]), int(a["rush_yds"]), int(a["rush_td"]), int(a["fumbles_lost"]),
            int(a["rec_tgt"]), int(a["rec"]), int(a["rec_yds"]), int(a["rec_td"]),
            int(a["def_tackles"]), float(a["def_sacks"]), int(a["def_int"]),
            int(a["def_pass_defended"]), int(a["def_forced_fumbles"]), int(a["def_tfl"]),
        ))
        if s != roster_season:  # current-season rosters come from the live roster file below
            hist_roster_rows.append((pid, tid, s, info[pid]["name"], pos, a["stat_position"], None))

    current_roster_rows = []
    rookies = []
    for r in rosters_by_season.get(roster_season, []):
        pid, raw_team = r.get("gsis_id"), r.get("team")
        if not pid or r.get("status") not in CURRENT_ROSTER_STATUSES:
            continue
        tid, pos = franchise_id(raw_team), primary.get(pid)
        if pos is None or tid not in team_name:
            continue
        current_roster_rows.append((
            pid, tid, roster_season, info[pid]["name"], pos,
            r.get("depth_chart_position") or r.get("position"), r.get("jersey_number") or None,
        ))
        if str(r.get("rookie_year") or "") == str(roster_season) or r.get("years_exp") == "0":
            rookies.append({"player_id": pid, "name": info[pid]["name"], "team_id": tid, "position": pos})
    # A player can appear twice if traded mid-file; keep the last row per (player, team).
    current_roster_rows = list({(x[0], x[1]): x for x in current_roster_rows}.values())

    defense_rows = []
    for s in seasons:
        for tid, t in aggregate_team_defense(team_weeks[s], games, s).items():
            if tid not in team_name:
                continue
            defense_rows.append((
                tid, s, int(t["games"]), int(t.get("points_allowed", 0)), int(t["yards_allowed"]),
                int(t.get("plays_allowed", 0)), int(t["pass_yds_allowed"]), int(t.get("pass_td_allowed", 0)),
                int(t["rush_yds_allowed"]), int(t.get("rush_td_allowed", 0)),
                int(t.get("interceptions", 0)), int(t.get("fumbles_recovered", 0)), float(t.get("sacks", 0)),
            ))

    # --- rookies (Madden + draft fallback) ---------------------------------
    madden: Dict[str, dict] = {}
    if not skip_madden and rookies:
        try:
            madden = match_madden(rookies, fetch_madden_rookies(), nick_to_team)
            log.info("Madden matched %d / %d rookies", len(madden), len(rookies))
        except Exception as e:
            log.error("Madden scrape failed, rookies will use draft-position fallback: %s", e)
    rookie_rows = []
    for rk in rookies:
        m = madden.get(rk["player_id"])
        d = draft_by_gsis.get(rk["player_id"], {})
        attrs = None
        if m:
            stats = m.get("stats") or {}
            attrs = {k: (stats.get(k) or {}).get("value") for k in MADDEN_ATTRS if k in stats}
        rookie_rows.append((
            rk["player_id"], roster_season, rk["team_id"], rk["position"],
            m.get("id") if m else None, m.get("overallRating") if m else None,
            Json(attrs) if attrs else None, (m.get("iteration") or {}).get("label") if m else None,
            int(d["round"]) if d.get("round") else None, int(d["pick"]) if d.get("pick") else None,
        ))

    # --- write -------------------------------------------------------------
    conn = psycopg2.connect(database_url())
    try:
        with conn, conn.cursor() as cur:
            cur.execute(SCHEMA_PATH.read_text())
            execute_values(cur, """
                INSERT INTO nfl_teams (id, full_name, abbreviation, conference, division) VALUES %s
                ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name,
                  abbreviation = EXCLUDED.abbreviation, conference = EXCLUDED.conference,
                  division = EXCLUDED.division""", team_rows)
            execute_values(cur, """
                INSERT INTO nfl_team_seasons (team_id, season, team_name, wins, losses, ties) VALUES %s
                ON CONFLICT (team_id, season) DO UPDATE SET team_name = EXCLUDED.team_name,
                  wins = EXCLUDED.wins, losses = EXCLUDED.losses, ties = EXCLUDED.ties""", team_season_rows)
            execute_values(cur, """
                INSERT INTO nfl_players (player_id, pfr_id, player_name, primary_position, birth_date,
                  college, draft_year, draft_round, draft_pick) VALUES %s
                ON CONFLICT (player_id) DO UPDATE SET pfr_id = COALESCE(EXCLUDED.pfr_id, nfl_players.pfr_id),
                  player_name = EXCLUDED.player_name, primary_position = EXCLUDED.primary_position,
                  birth_date = COALESCE(EXCLUDED.birth_date, nfl_players.birth_date),
                  college = COALESCE(EXCLUDED.college, nfl_players.college),
                  draft_year = EXCLUDED.draft_year, draft_round = EXCLUDED.draft_round,
                  draft_pick = EXCLUDED.draft_pick, updated_at = CURRENT_TIMESTAMP""", player_rows, page_size=2000)
            execute_values(cur, """
                INSERT INTO nfl_player_season_stats (player_id, team_id, season, position, gp, gs,
                  pass_cmp, pass_att, pass_yds, pass_td, pass_int, pass_sacked,
                  rush_att, rush_yds, rush_td, fumbles_lost, rec_tgt, rec, rec_yds, rec_td,
                  def_tackles, def_sacks, def_int, def_pass_defended, def_forced_fumbles, def_tfl) VALUES %s
                ON CONFLICT (player_id, team_id, season) DO UPDATE SET position = EXCLUDED.position,
                  gp = EXCLUDED.gp, pass_cmp = EXCLUDED.pass_cmp, pass_att = EXCLUDED.pass_att,
                  pass_yds = EXCLUDED.pass_yds, pass_td = EXCLUDED.pass_td, pass_int = EXCLUDED.pass_int,
                  pass_sacked = EXCLUDED.pass_sacked, rush_att = EXCLUDED.rush_att,
                  rush_yds = EXCLUDED.rush_yds, rush_td = EXCLUDED.rush_td,
                  fumbles_lost = EXCLUDED.fumbles_lost, rec_tgt = EXCLUDED.rec_tgt, rec = EXCLUDED.rec,
                  rec_yds = EXCLUDED.rec_yds, rec_td = EXCLUDED.rec_td, def_tackles = EXCLUDED.def_tackles,
                  def_sacks = EXCLUDED.def_sacks, def_int = EXCLUDED.def_int,
                  def_pass_defended = EXCLUDED.def_pass_defended,
                  def_forced_fumbles = EXCLUDED.def_forced_fumbles, def_tfl = EXCLUDED.def_tfl,
                  updated_at = CURRENT_TIMESTAMP""", stat_rows, page_size=2000)
            roster_upsert = """
                INSERT INTO nfl_roster_players (player_id, team_id, season, player_name, position,
                  raw_position, jersey) VALUES %s
                ON CONFLICT (player_id, team_id, season) DO UPDATE SET player_name = EXCLUDED.player_name,
                  position = EXCLUDED.position, raw_position = EXCLUDED.raw_position,
                  jersey = EXCLUDED.jersey"""
            execute_values(cur, roster_upsert, hist_roster_rows, page_size=2000)
            # Replace the current-season roster wholesale so cut/traded players drop off.
            cur.execute("DELETE FROM nfl_roster_players WHERE season = %s", (roster_season,))
            execute_values(cur, roster_upsert, current_roster_rows, page_size=2000)
            execute_values(cur, """
                INSERT INTO nfl_team_defense_season_stats (team_id, season, games, points_allowed,
                  yards_allowed, plays_allowed, pass_yds_allowed, pass_td_allowed, rush_yds_allowed,
                  rush_td_allowed, interceptions, fumbles_recovered, sacks) VALUES %s
                ON CONFLICT (team_id, season) DO UPDATE SET games = EXCLUDED.games,
                  points_allowed = EXCLUDED.points_allowed, yards_allowed = EXCLUDED.yards_allowed,
                  plays_allowed = EXCLUDED.plays_allowed, pass_yds_allowed = EXCLUDED.pass_yds_allowed,
                  pass_td_allowed = EXCLUDED.pass_td_allowed, rush_yds_allowed = EXCLUDED.rush_yds_allowed,
                  rush_td_allowed = EXCLUDED.rush_td_allowed, interceptions = EXCLUDED.interceptions,
                  fumbles_recovered = EXCLUDED.fumbles_recovered, sacks = EXCLUDED.sacks,
                  updated_at = CURRENT_TIMESTAMP""", defense_rows)
            if rookie_rows:
                execute_values(cur, """
                    INSERT INTO nfl_rookie_profiles (player_id, season, team_id, position, madden_id,
                      madden_overall, madden_attributes, madden_iteration, draft_round, draft_pick) VALUES %s
                    ON CONFLICT (player_id, season) DO UPDATE SET team_id = EXCLUDED.team_id,
                      position = EXCLUDED.position,
                      madden_id = COALESCE(EXCLUDED.madden_id, nfl_rookie_profiles.madden_id),
                      madden_overall = COALESCE(EXCLUDED.madden_overall, nfl_rookie_profiles.madden_overall),
                      madden_attributes = COALESCE(EXCLUDED.madden_attributes, nfl_rookie_profiles.madden_attributes),
                      madden_iteration = COALESCE(EXCLUDED.madden_iteration, nfl_rookie_profiles.madden_iteration),
                      draft_round = EXCLUDED.draft_round, draft_pick = EXCLUDED.draft_pick,
                      updated_at = CURRENT_TIMESTAMP""", rookie_rows)
    finally:
        conn.close()

    log.info(
        "done: teams=%d team_seasons=%d players=%d stats=%d rosters(hist)=%d rosters(current)=%d "
        "defense=%d rookies=%d (madden %d)",
        len(team_rows), len(team_season_rows), len(player_rows), len(stat_rows), len(hist_roster_rows),
        len(current_roster_rows), len(defense_rows), len(rookie_rows), len(madden),
    )


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--start", type=int, default=FIRST_SEASON)
    p.add_argument("--end", type=int, default=current_season())
    p.add_argument("--current-only", action="store_true", help="only refresh the current season")
    p.add_argument("--skip-madden", action="store_true")
    a = p.parse_args()
    if a.start < FIRST_SEASON:
        sys.exit(f"nflverse stats start in {FIRST_SEASON}; earlier seasons come from the PFR backfill")
    seed(a.start, a.end, a.current_only, a.skip_madden)


if __name__ == "__main__":
    main()
