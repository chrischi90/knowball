"""
NFL endpoints, mounted under /nfl by main.py. Implements the contract in lib/nfl-types.ts.

Data path: seeded nfl_* tables (seed_nfl.py) → live nflverse current-season file on a DB miss
→ Madden/draft-based projection for rookies → 404.

All player stats are PER GAME: SUM(totals) / SUM(games) across the seasons in scope.
"""
from __future__ import annotations

import bisect
import csv
import datetime as dt
import io
import logging
import threading
import time
import urllib.request
from typing import Callable, Dict, List, Optional, Tuple

from fastapi import APIRouter, HTTPException

from seed_nfl import NFLVERSE, aggregate_player_weeks, franchise_id

logger = logging.getLogger("nfl_service")

# Keep in sync with lib/nfl-rules.js.
NFL_ALL_TIME_START_SEASON = 1999
NFL_CURRENT_STATS_START_WEEK = 10
NFL_REGULAR_SEASON_WEEKS = 18
DEFENSIVE_POSITIONS = {"DE", "DT", "LB", "CB", "S", "DB"}

CACHE_TTL_SECONDS = 6 * 60 * 60

STAT_COLUMNS = [
    "gp", "gs", "pass_cmp", "pass_att", "pass_yds", "pass_td", "pass_int", "pass_sacked",
    "rush_att", "rush_yds", "rush_td", "fumbles_lost", "rec_tgt", "rec", "rec_yds", "rec_td",
    "def_tackles", "def_sacks", "def_int", "def_pass_defended", "def_forced_fumbles", "def_tfl",
]
# Columns that can be NULL (not tracked in some eras) — stay None when every season is NULL.
NULLABLE_COLUMNS = {"rec_tgt", "def_tackles", "def_sacks", "def_pass_defended", "def_forced_fumbles", "def_tfl"}


# ---------------------------------------------------------------------------
# Season context (mirror of getNflSeasonContext in lib/nfl-rules.js)
# ---------------------------------------------------------------------------

def _nfl_kickoff(year: int) -> dt.date:
    """Thursday after Labor Day (first Monday of September)."""
    sept1 = dt.date(year, 9, 1)
    labor_day = sept1 + dt.timedelta(days=(7 - sept1.weekday()) % 7)
    return labor_day + dt.timedelta(days=3)


def season_context(today: Optional[dt.date] = None) -> dict:
    today = today or dt.datetime.utcnow().date()
    year = today.year - 1 if today.month <= 2 else today.year
    week1_start = _nfl_kickoff(year) - dt.timedelta(days=2)  # Tuesday before kickoff
    if today < week1_start:
        return {"season": year, "phase": "offseason", "week": None,
                "rosterSeason": year, "statsSeason": year - 1}
    week = (today - week1_start).days // 7 + 1
    if week > NFL_REGULAR_SEASON_WEEKS:
        return {"season": year, "phase": "postseason", "week": None,
                "rosterSeason": year, "statsSeason": year}
    return {"season": year, "phase": "regular", "week": week, "rosterSeason": year,
            "statsSeason": year if week >= NFL_CURRENT_STATS_START_WEEK else year - 1}


# ---------------------------------------------------------------------------
# Pure stat helpers
# ---------------------------------------------------------------------------

def sum_rows(rows: List[dict]) -> dict:
    """
    Sum stat rows. For nullable columns, also record the games played in seasons where the
    column was tracked (key "_gp:<col>") so per-game uses only those games. A nullable
    column is None when no row tracked it.
    """
    total: Dict[str, Optional[float]] = {}
    for col in STAT_COLUMNS:
        present = [r for r in rows if r.get(col) is not None]
        if col in NULLABLE_COLUMNS:
            total[col] = float(sum(r[col] for r in present)) if present else None
            total[f"_gp:{col}"] = float(sum(r.get("gp") or 0 for r in present))
        else:
            total[col] = float(sum(r[col] for r in present))
    return total


def _pg(total: dict, col: str, gp: float) -> Optional[float]:
    v = total.get(col)
    if v is None:
        return None
    denom = total.get(f"_gp:{col}", gp) or gp
    return round(v / denom, 2)


def per_game_line(total: dict, position: str) -> dict:
    """Shape summed totals into the NflPlayerStats passing/rushing/receiving/defense blocks."""
    gp = total["gp"] or 1.0
    pg = lambda col: _pg(total, col, gp)  # noqa: E731
    is_def = position in DEFENSIVE_POSITIONS
    passing = rushing = receiving = defense = None
    if position == "QB" or (total["pass_att"] or 0) > 0:
        passing = {"cmp": pg("pass_cmp"), "att": pg("pass_att"), "yds": pg("pass_yds"),
                   "td": pg("pass_td"), "int": pg("pass_int"), "sacked": pg("pass_sacked")}
    if not is_def and (position in ("QB", "RB") or (total["rush_att"] or 0) > 0):
        rushing = {"att": pg("rush_att"), "yds": pg("rush_yds"), "td": pg("rush_td"),
                   "fumblesLost": pg("fumbles_lost")}
    if not is_def and (position in ("RB", "WR", "TE") or (total["rec"] or 0) > 0):
        receiving = {"tgt": pg("rec_tgt"), "rec": pg("rec"), "yds": pg("rec_yds"), "td": pg("rec_td")}
    if is_def:
        defense = {"tackles": pg("def_tackles"), "sacks": pg("def_sacks"), "int": pg("def_int"),
                   "passesDefended": pg("def_pass_defended"), "forcedFumbles": pg("def_forced_fumbles"),
                   "tacklesForLoss": pg("def_tfl")}
    return {"passing": passing, "rushing": rushing, "receiving": receiving, "defense": defense}


def weighted_league_line(per_season: Dict[int, dict], weights: Dict[int, float]) -> dict:
    """
    Combine per-season league per-game lines into one, weighted by the player's games in
    each season. Nullable columns average only over seasons where they were tracked.
    Returns a 'total' with gp=1 suitable for per_game_line().
    """
    out: Dict[str, Optional[float]] = {"gp": 1.0, "gs": 0.0}
    for col in STAT_COLUMNS:
        if col in ("gp", "gs"):
            continue
        num = den = 0.0
        for season, w in weights.items():
            v = (per_season.get(season) or {}).get(col)
            if v is None or w <= 0:
                continue
            num += v * w
            den += w
        out[col] = (num / den) if den else (None if col in NULLABLE_COLUMNS else 0.0)
    return out


def league_per_game_from_rows(rows: List[dict], position: str) -> dict:
    """Average qualifying starter's per-game values (by column) from one season's stat rows."""
    rows = [r for r in rows if _qualifies(position, r)]
    if not rows:
        return {}
    total = sum_rows(rows)
    line: Dict[str, Optional[float]] = {}
    for col in STAT_COLUMNS:
        if col in ("gp", "gs"):
            continue
        v = total[col]
        denom = total.get(f"_gp:{col}", total["gp"]) or total["gp"]
        line[col] = None if v is None else v / denom
    return line


# ---------------------------------------------------------------------------
# Rookie projection
# ---------------------------------------------------------------------------

# Highest league percentile a rookie can project to, by position. Rookies are rarely instant
# stars; RB/WR adapt fastest, QBs slowest. Tune during calibration.
ROOKIE_PERCENTILE_CAP = {"QB": 0.55, "RB": 0.80, "WR": 0.80, "TE": 0.65,
                         "DE": 0.70, "DT": 0.70, "LB": 0.70, "CB": 0.70, "S": 0.70, "DB": 0.70}
# Madden overall range mapped linearly onto percentiles [0, 1] before the cap.
MADDEN_FLOOR, MADDEN_CEIL = 55.0, 90.0
# Stats where a higher number is worse — use the mirrored percentile.
LOWER_IS_BETTER = {"pass_int", "pass_sacked", "fumbles_lost"}

POSITION_GROUP = {"QB": ["QB"], "RB": ["RB"], "WR": ["WR"], "TE": ["TE"],
                  "DE": ["DE", "DT"], "DT": ["DE", "DT"], "LB": ["LB"],
                  "CB": ["CB", "S", "DB"], "S": ["CB", "S", "DB"], "DB": ["CB", "S", "DB"]}


def draft_slot_overall(draft_round: Optional[int], draft_pick: Optional[int]) -> float:
    """Pseudo Madden overall from draft slot, for rookies Madden doesn't rate."""
    if draft_pick:
        if draft_pick <= 10:
            return 76.0
        if draft_pick <= 32:
            return 72.0
    if draft_round == 2:
        return 68.0
    if draft_round == 3:
        return 65.0
    if draft_round in (4, 5):
        return 62.0
    if draft_round in (6, 7):
        return 59.0
    return 56.0  # undrafted


def rookie_percentile(position: str, overall: float) -> float:
    pct = (overall - MADDEN_FLOOR) / (MADDEN_CEIL - MADDEN_FLOOR)
    return max(0.02, min(pct, ROOKIE_PERCENTILE_CAP.get(position, 0.6)))


def quantile(sorted_vals: List[float], q: float) -> float:
    if not sorted_vals:
        return 0.0
    idx = min(int(round(q * (len(sorted_vals) - 1))), len(sorted_vals) - 1)
    return sorted_vals[idx]


def project_rookie_totals(percentile: float, per_game_tables: Dict[str, List[float]]) -> dict:
    """Build a one-game 'total' at the given league percentile for each stat."""
    total: Dict[str, Optional[float]] = {"gp": 1.0, "gs": 0.0}
    for col in STAT_COLUMNS:
        if col in ("gp", "gs"):
            continue
        vals = per_game_tables.get(col)
        if vals is None:
            total[col] = None if col in NULLABLE_COLUMNS else 0.0
            continue
        q = 1 - percentile if col in LOWER_IS_BETTER else percentile
        total[col] = quantile(vals, q)
    return total


def _qualifies(position: str, r: dict) -> bool:
    gp = r["gp"] or 0
    if gp < 8:
        return False
    if position == "QB":
        return r["pass_att"] / gp >= 15
    if position == "RB":
        return r["rush_att"] / gp >= 5
    if position in ("WR", "TE"):
        return (r["rec_tgt"] if r["rec_tgt"] is not None else r["rec"] * 1.5) / gp >= 2
    return (r["def_tackles"] or 0) / gp >= 2


# ---------------------------------------------------------------------------
# nflverse live fallback
# ---------------------------------------------------------------------------

_nflverse_cache: Dict[int, Tuple[float, Dict[Tuple[str, str, int], dict]]] = {}
_nflverse_lock = threading.Lock()


def nflverse_season_totals(season: int) -> Dict[Tuple[str, str, int], dict]:
    """Download + aggregate a season's weekly stats from nflverse (cached for CACHE_TTL)."""
    with _nflverse_lock:
        cached = _nflverse_cache.get(season)
        if cached and time.time() - cached[0] < CACHE_TTL_SECONDS:
            return cached[1]
        url = f"{NFLVERSE}/stats_player/stats_player_week_{season}.csv"
        logger.info("nflverse fallback download: %s", url)
        req = urllib.request.Request(url, headers={"User-Agent": "knowball-service"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = resp.read().decode("utf-8")
        totals = aggregate_player_weeks(csv.DictReader(io.StringIO(text)))
        _nflverse_cache[season] = (time.time(), totals)
        return totals


def _nflverse_rows(player_id: str, season: int) -> List[dict]:
    try:
        totals = nflverse_season_totals(season)
    except Exception as e:
        logger.warning("nflverse fallback failed for %s: %s", season, e)
        return []
    rows = []
    for (pid, tid, s), a in totals.items():
        if pid == player_id:
            row = {c: a.get(c, 0.0) for c in STAT_COLUMNS if c not in ("gp", "gs")}
            row.update(gp=a["gp"], gs=0, team_id=tid, season=s)
            rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

def create_nfl_router(get_db: Callable, release_db: Callable) -> APIRouter:
    router = APIRouter(prefix="/nfl")
    cache: Dict[str, Tuple[float, object]] = {}

    def cached(key: str, fn: Callable):
        hit = cache.get(key)
        if hit and time.time() - hit[0] < CACHE_TTL_SECONDS:
            return hit[1]
        value = fn()
        if value is not None:
            cache[key] = (time.time(), value)
        return value

    def query(sql: str, params: tuple = ()) -> List[dict]:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                cols = [d[0] for d in cur.description]
                return [dict(zip(cols, row)) for row in cur.fetchall()]
        finally:
            release_db(conn)

    def db_call(fn: Callable):
        try:
            return fn()
        except HTTPException:
            raise
        except Exception as e:
            logger.exception("nfl db error")
            raise HTTPException(status_code=502, detail=str(e))

    # --- season context ------------------------------------------------------
    @router.get("/season-context")
    def get_season_context():
        return season_context()

    # --- teams ---------------------------------------------------------------
    @router.get("/teams")
    def list_teams():
        def load():
            rows = query("SELECT id, full_name, abbreviation, conference, division FROM nfl_teams ORDER BY full_name")
            return [{"id": r["id"], "fullName": r["full_name"], "abbreviation": r["abbreviation"],
                     "conference": r["conference"], "division": r["division"]} for r in rows]
        return {"teams": db_call(lambda: cached("teams", load))}

    # --- players -------------------------------------------------------------
    @router.get("/teams/{team_id}/players")
    def list_team_players(team_id: str, game_mode: str = "all_time"):
        ctx = season_context()

        def load():
            if game_mode == "active_only":
                rows = query(
                    """
                    SELECT r.player_id, r.player_name, r.position, r.jersey,
                           (rk.player_id IS NOT NULL) AS is_rookie
                    FROM nfl_roster_players r
                    LEFT JOIN nfl_rookie_profiles rk
                      ON rk.player_id = r.player_id AND rk.season = r.season
                    WHERE r.team_id = %s AND r.season = %s
                    """,
                    (team_id, ctx["rosterSeason"]),
                )
            else:
                rows = query(
                    """
                    SELECT p.player_id, p.player_name, p.primary_position AS position,
                           (SELECT jersey FROM nfl_roster_players rp
                             WHERE rp.player_id = p.player_id AND rp.team_id = %s
                             ORDER BY season DESC LIMIT 1) AS jersey,
                           FALSE AS is_rookie
                    FROM nfl_players p
                    WHERE p.primary_position IS NOT NULL AND EXISTS (
                      SELECT 1 FROM nfl_player_season_stats s
                      WHERE s.player_id = p.player_id AND s.team_id = %s AND s.season >= %s)
                    """,
                    (team_id, team_id, NFL_ALL_TIME_START_SEASON),
                )
            players = [{"id": r["player_id"], "name": r["player_name"], "position": r["position"],
                        "jersey": r["jersey"] or "", "isRookie": bool(r["is_rookie"])} for r in rows]
            players.sort(key=lambda p: p["name"])
            return players or None

        players = db_call(lambda: cached(f"players:{team_id}:{game_mode}:{ctx['rosterSeason']}", load))
        if not players:
            raise HTTPException(status_code=404, detail=f"No roster data found for team_id={team_id}")
        return {"players": players}

    # --- player stats --------------------------------------------------------
    def stat_rows(player_id: str, where: str, params: tuple) -> List[dict]:
        cols = ", ".join(f"s.{c}" for c in STAT_COLUMNS)
        return query(
            f"SELECT s.team_id, s.season, {cols} FROM nfl_player_season_stats s "
            f"WHERE s.player_id = %s AND {where}",
            (player_id, *params),
        )

    def projection_tables(stats_season: int, position: str) -> Dict[str, List[float]]:
        def load():
            group = POSITION_GROUP.get(position, [position])
            cols = ", ".join(STAT_COLUMNS)
            rows = query(
                f"SELECT {cols} FROM nfl_player_season_stats WHERE season = %s AND position = ANY(%s)",
                (stats_season, group),
            )
            rows = [r for r in rows if _qualifies(position, r)]
            tables: Dict[str, List[float]] = {}
            for col in STAT_COLUMNS:
                if col in ("gp", "gs"):
                    continue
                vals = [r[col] / r["gp"] for r in rows if r[col] is not None]
                if vals:
                    tables[col] = sorted(vals)
            return tables
        return cached(f"proj:{stats_season}:{position}", load)

    def league_per_game(season: int, position: str) -> dict:
        """Average qualifying starter's per-game line at this position group in a season."""
        def load():
            group = POSITION_GROUP.get(position, [position])
            cols = ", ".join(STAT_COLUMNS)
            rows = query(
                f"SELECT {cols} FROM nfl_player_season_stats WHERE season = %s AND position = ANY(%s)",
                (season, group),
            )
            return league_per_game_from_rows(rows, position)
        return cached(f"league:{season}:{position}", load) or {}

    def league_line(position: str, weights: Dict[int, float]) -> dict:
        per_season = {s: league_per_game(s, position) for s in weights}
        line = per_game_line(weighted_league_line(per_season, weights), position)
        return line

    def build_stats(player_id: str, team_id: str, game_mode: str) -> Optional[dict]:
        ctx = season_context()
        player = query("SELECT primary_position FROM nfl_players WHERE player_id = %s", (player_id,))
        if not player or not player[0]["primary_position"]:
            return None
        position = player[0]["primary_position"]

        if game_mode == "all_time":
            rows = stat_rows(player_id, "s.team_id = %s AND s.season >= %s", (team_id, NFL_ALL_TIME_START_SEASON))
            source = "db"
        else:
            stats_season = ctx["statsSeason"]
            rows = stat_rows(player_id, "s.season = %s", (stats_season,))
            source = "db"
            if not rows and stats_season == ctx["season"]:
                # Current-season stats not seeded yet → live nflverse file.
                rows = _nflverse_rows(player_id, stats_season)
                source = "scrape"
            if not rows:
                rookie = query(
                    "SELECT madden_overall, draft_round, draft_pick FROM nfl_rookie_profiles "
                    "WHERE player_id = %s AND season = %s",
                    (player_id, ctx["rosterSeason"]),
                )
                if rookie:
                    rk = rookie[0]
                    overall = rk["madden_overall"] or draft_slot_overall(rk["draft_round"], rk["draft_pick"])
                    pct = rookie_percentile(position, float(overall))
                    # League distribution from the last completed season.
                    last_completed = ctx["season"] if ctx["phase"] == "postseason" else ctx["season"] - 1
                    tables = projection_tables(last_completed, position)
                    total = project_rookie_totals(pct, tables)
                    return {"playerId": player_id, "teamId": team_id, "position": position,
                            "gp": 0, "gs": 0, "seasons": [], "statsTeamId": team_id,
                            **per_game_line(total, position),
                            "league": league_line(position, {last_completed: 1.0}),
                            "source": "projection"}
            if not rows:
                # Veteran who missed the stats season (injury etc.) → most recent season played.
                latest = query("SELECT MAX(season) AS s FROM nfl_player_season_stats WHERE player_id = %s",
                               (player_id,))
                if latest and latest[0]["s"] is not None:
                    rows = stat_rows(player_id, "s.season = %s", (latest[0]["s"],))

        if not rows:
            return None
        total = sum_rows(rows)
        if not total["gp"]:
            return None
        gp_by_team: Dict[str, float] = {}
        for r in rows:
            gp_by_team[r["team_id"]] = gp_by_team.get(r["team_id"], 0) + (r["gp"] or 0)
        stats_team = team_id if team_id in gp_by_team else max(gp_by_team, key=gp_by_team.get)
        weights: Dict[int, float] = {}
        for r in rows:
            weights[int(r["season"])] = weights.get(int(r["season"]), 0.0) + float(r["gp"] or 0)
        return {"playerId": player_id, "teamId": team_id, "position": position,
                "gp": int(total["gp"]), "gs": int(total["gs"] or 0),
                "seasons": sorted(weights), "statsTeamId": stats_team,
                **per_game_line(total, position),
                "league": league_line(position, weights), "source": source}

    @router.get("/players/{player_id}/stats")
    def get_player_stats(player_id: str, team_id: str, game_mode: str = "all_time"):
        ctx = season_context()
        key = f"stats:{player_id}:{team_id}:{game_mode}:{ctx['statsSeason']}"
        result = db_call(lambda: cached(key, lambda: build_stats(player_id, team_id, game_mode)))
        if result is None:
            raise HTTPException(status_code=404, detail="Player stats not found")
        return result

    # --- league (season-mode opponents, backtest) -------------------------------
    @router.get("/league/teams")
    def league_teams(season: Optional[int] = None):
        """Every team's real record and scoring for a season (default: last completed)."""
        ctx = season_context()
        if season is None:
            season = ctx["season"] if ctx["phase"] == "postseason" else ctx["season"] - 1

        def load():
            rows = query(
                """
                SELECT ts.team_id, ts.team_name, t.conference, t.division, ts.wins, ts.losses, ts.ties,
                       ts.points_for, ts.points_against, ts.games
                FROM nfl_team_seasons ts JOIN nfl_teams t ON t.id = ts.team_id
                WHERE ts.season = %s AND ts.games > 0
                ORDER BY ts.team_id
                """,
                (season,),
            )
            if not rows:
                return None
            games = sum(r["games"] for r in rows)
            return {
                "season": season,
                "leaguePointsPerGame": round(sum(r["points_for"] for r in rows) / games, 2),
                "teams": [{"teamId": r["team_id"], "teamName": r["team_name"], "conference": r["conference"],
                           "division": r["division"], "wins": r["wins"], "losses": r["losses"], "ties": r["ties"],
                           "games": r["games"],
                           "pointsForPerGame": round(r["points_for"] / r["games"], 2),
                           "pointsAgainstPerGame": round(r["points_against"] / r["games"], 2)} for r in rows],
            }
        result = db_call(lambda: cached(f"league:{season}", load))
        if result is None:
            raise HTTPException(status_code=404, detail=f"No league data for season={season}")
        return result

    # --- team defense --------------------------------------------------------
    @router.get("/teams/{team_id}/defense/seasons")
    def list_defense_seasons(team_id: str):
        def load():
            rows = query(
                """
                SELECT ts.season, ts.team_name, ts.wins, ts.losses, ts.ties
                FROM nfl_team_seasons ts
                JOIN nfl_team_defense_season_stats d USING (team_id, season)
                WHERE ts.team_id = %s AND ts.season >= %s
                ORDER BY ts.season DESC
                """,
                (team_id, NFL_ALL_TIME_START_SEASON),
            )
            return [{"season": r["season"], "teamName": r["team_name"], "wins": r["wins"],
                     "losses": r["losses"], "ties": r["ties"]} for r in rows] or None
        seasons = db_call(lambda: cached(f"defseasons:{team_id}", load))
        if not seasons:
            raise HTTPException(status_code=404, detail=f"No defense data for team_id={team_id}")
        return {"seasons": seasons}

    @router.get("/teams/{team_id}/defense")
    def get_team_defense(team_id: str, season: Optional[int] = None):
        season = season if season is not None else season_context()["statsSeason"]

        def load():
            rows = query(
                """
                SELECT d.*, ts.team_name FROM nfl_team_defense_season_stats d
                JOIN nfl_team_seasons ts USING (team_id, season)
                WHERE d.team_id = %s AND d.season = %s
                """,
                (team_id, season),
            )
            if not rows:
                return None
            r = rows[0]
            g = r["games"] or 1
            lg = query(
                """
                SELECT SUM(points_allowed)::float / SUM(games) AS pa, SUM(yards_allowed)::float / SUM(games) AS ya,
                       SUM(pass_yds_allowed)::float / SUM(games) AS pya, SUM(rush_yds_allowed)::float / SUM(games) AS rya,
                       SUM(interceptions + fumbles_recovered)::float / SUM(games) AS tk,
                       SUM(sacks)::float / NULLIF(SUM(CASE WHEN sacks IS NOT NULL THEN games END), 0) AS sk,
                       SUM(plays_allowed)::float / NULLIF(SUM(games), 0) AS plays
                FROM nfl_team_defense_season_stats WHERE season = %s
                """,
                (season,),
            )[0]
            return {"teamId": team_id, "season": season, "teamName": r["team_name"], "games": r["games"],
                    "pointsAllowed": round(r["points_allowed"] / g, 2),
                    "yardsAllowed": round(r["yards_allowed"] / g, 2),
                    "passYardsAllowed": round(r["pass_yds_allowed"] / g, 2),
                    "rushYardsAllowed": round(r["rush_yds_allowed"] / g, 2),
                    "takeaways": round((r["interceptions"] + r["fumbles_recovered"]) / g, 2),
                    "sacks": None if r["sacks"] is None else round(r["sacks"] / g, 2),
                    "playsAllowed": round((r["plays_allowed"] or 0) / g, 2),
                    "league": {"pointsAllowed": round(lg["pa"], 2), "yardsAllowed": round(lg["ya"], 2),
                               "passYardsAllowed": round(lg["pya"], 2), "rushYardsAllowed": round(lg["rya"], 2),
                               "takeaways": round(lg["tk"], 2),
                               "sacks": None if lg["sk"] is None else round(lg["sk"], 2),
                               "playsAllowed": round(lg["plays"] or 0, 2)},
                    "source": "db"}
        result = db_call(lambda: cached(f"defense:{team_id}:{season}", load))
        if result is None:
            raise HTTPException(status_code=404, detail=f"No defense data for team_id={team_id} season={season}")
        return result

    return router
