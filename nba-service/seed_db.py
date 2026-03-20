"""
Seed script to populate Neon Postgres with NBA teams, historical rosters,
and per-season player stats.

Data sources:
    - Teams: nba_api static data (local, no HTTP)
    - Rosters: basketball_reference_web_scraper players_season_totals
                     + BBRef team roster pages (supplemental, captures injured/inactive players)
    - Stats: season totals + advanced season totals from basketball-reference
    - Player IDs: nba_api static player data (local, no HTTP) cross-referenced by name

Run locally (NOT on Render):
        pip install -r seed_requirements.txt
        DATABASE_URL="postgresql://..." python seed_db.py

Idempotent - safe to re-run. Re-run after trades or at the start of a new season.
To add a new season, just re-run - it will skip already-inserted rows.
"""
import os
import re
import time
import unicodedata

import requests

import psycopg2
from basketball_reference_web_scraper import client
from basketball_reference_web_scraper.data import Team, Position

# nba_api static data — no HTTP calls, bundled local JSON
from nba_api.stats.static import teams as static_teams
from nba_api.stats.static import players as static_players

# Season range: 1980-81 through 2025-26
SEASON_START_END_YEAR = 1981   # first season to fetch (1980-81)
SEASON_STOP_END_YEAR  = 2026   # last season to fetch  (2025-26)

# Seconds to wait between basketball-reference requests (be respectful)
REQUEST_DELAY = 3.0

# Small pause between totals and advanced totals calls for the same season.
ADVANCED_REQUEST_DELAY = 1.0

# Generational suffixes that nba_api may include but bref often omits (or vice versa)
_SUFFIX_RE = re.compile(r'\s+(jr\.?|sr\.?|ii|iii|iv|v)$', re.IGNORECASE)


def _normalize_name(name: str) -> str:
    """Lowercase, strip accents, remove generational suffixes for fuzzy matching."""
    normalized = unicodedata.normalize("NFD", name).encode("ascii", "ignore").decode("ascii")
    normalized = normalized.strip().lower()
    normalized = _SUFFIX_RE.sub("", normalized).strip()
    return normalized


def season_label(end_year: int) -> str:
    """Convert end year to season label. 2026 → '2025-26', 2000 → '1999-00'."""
    start = end_year - 1
    return f"{start}-{str(end_year)[-2:]}"


# Map basketball_reference Team enum values → nba_api full_name (only where they differ)
BREF_FULL_NAME_TO_NBA_FULL_NAME = {
    "PHILADELPHIA 76ERS": "Philadelphia 76ers",
    # Historical franchise names that bref uses but nba_api tracks under current name
    "NEW JERSEY NETS": "Brooklyn Nets",
    "NEW ORLEANS HORNETS": "New Orleans Pelicans",
    "NEW ORLEANS/OKLAHOMA CITY HORNETS": "New Orleans Pelicans",
    "CHARLOTTE BOBCATS": "Charlotte Hornets",
    "SEATTLE SUPERSONICS": "Oklahoma City Thunder",
    "VANCOUVER GRIZZLIES": "Memphis Grizzlies",
    "NEW JERSEY NETS": "Brooklyn Nets",
}

POSITION_TO_SHORT = {
    Position.POINT_GUARD: "PG",
    Position.SHOOTING_GUARD: "SG",
    Position.SMALL_FORWARD: "SF",
    Position.POWER_FORWARD: "PF",
    Position.CENTER: "C",
    Position.GUARD: "SG",
    Position.FORWARD: "SF",
}


def apply_schema(conn):
    schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
    with open(schema_path) as f:
        sql = f.read()
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.commit()
    print("Schema applied.")


def seed_teams(conn) -> dict:
    """Insert all 30 teams. Returns full_name → team_id dict."""
    raw = static_teams.get_teams()
    rows = []
    full_name_to_id = {}
    seen = set()
    for t in raw:
        tid = str(t.get("id", ""))
        if tid and tid not in seen:
            seen.add(tid)
            rows.append((tid, t["full_name"], t["abbreviation"], t["nickname"], t["city"]))
            full_name_to_id[t["full_name"]] = tid

    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO teams (id, full_name, abbreviation, nickname, city)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (id) DO NOTHING
            """,
            rows,
        )
    conn.commit()
    print(f"Seeded {len(rows)} teams.")
    return full_name_to_id


def build_player_id_lookup():
    """
    Build two lookups from local static data (no HTTP):
      - exact:      lowercase full name → id
      - normalized: accent-stripped, suffix-stripped name → id
    """
    all_players = static_players.get_players()
    exact = {}
    normalized = {}
    for p in all_players:
        full = p["full_name"].strip()
        pid = str(p["id"])
        exact[full.lower()] = pid
        norm_key = _normalize_name(full)
        normalized.setdefault(norm_key, pid)
    return exact, normalized


def lookup_player_id(name: str, exact: dict, normalized: dict) -> "str | None":
    """Try exact match first, then normalized (accent/suffix stripped)."""
    pid = exact.get(name.strip().lower())
    if pid:
        return pid
    return normalized.get(_normalize_name(name))


def normalize_position(positions: list) -> str:
    if not positions:
        return "SF"
    return POSITION_TO_SHORT.get(positions[0], "SF")


def _safe_per_game(total: float, gp: int) -> float:
    if gp <= 0:
        return 0.0
    return float(total) / float(gp)


def _safe_float(value, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _optional_float(value):
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_ratio(numerator: float, denominator: float) -> float:
    if not denominator:
        return 0.0
    return float(numerator) / float(denominator)


def resolve_team_id(team_enum: Team, full_name_to_id: dict) -> "str | None":
    """Map a bref Team enum to our DB team_id, handling historical franchise names."""
    bref_name = team_enum.value.title()
    nba_full_name = BREF_FULL_NAME_TO_NBA_FULL_NAME.get(team_enum.value, bref_name)
    return full_name_to_id.get(nba_full_name) or full_name_to_id.get(bref_name)


def seed_one_season(conn, end_year: int, full_name_to_id: dict, exact_lookup: dict, norm_lookup: dict):
    """Fetch and insert one season's roster and stat data."""
    label = season_label(end_year)
    try:
        season_data = client.players_season_totals(season_end_year=end_year)
    except Exception as e:
        print(f"  [{label}] ERROR fetching: {e}")
        return 0, 0, 0

    advanced_data = []
    try:
        time.sleep(ADVANCED_REQUEST_DELAY)
        advanced_data = client.players_advanced_season_totals(
            season_end_year=end_year,
            include_combined_values=False,
        )
    except Exception as e:
        print(f"  [{label}] WARNING advanced totals unavailable: {e}")

    advanced_by_player_team: dict = {}
    for row in advanced_data:
        team_enum = row.get("team")
        if team_enum is None:
            continue
        team_id = resolve_team_id(team_enum, full_name_to_id)
        if team_id is None:
            continue

        player_name: str = row.get("name", "").strip()
        if not player_name:
            continue

        nba_id = lookup_player_id(player_name, exact_lookup, norm_lookup)
        if nba_id is None:
            continue

        key = (nba_id, team_id)
        existing = advanced_by_player_team.get(key)
        gp = int(row.get("games_played") or 0)
        existing_gp = int(existing.get("games_played") or 0) if existing else -1
        if gp >= existing_gp:
            advanced_by_player_team[key] = row

    # Deduplicate within a single season: bref emits a TOT row + per-team rows for
    # traded players. Track (name, team_id, season) so a player can appear for the
    # same team across different seasons but not twice in the same season.
    seen: set = set()
    rows_to_insert = []
    stats_rows_to_upsert = []
    unmatched_count = 0

    for row in season_data:
        team_enum = row.get("team")
        if team_enum is None:
            continue

        team_id = resolve_team_id(team_enum, full_name_to_id)
        if team_id is None:
            continue  # deprecated/unknown franchise not in our teams table

        player_name: str = row.get("name", "").strip()
        if not player_name:
            continue

        key = (player_name.lower(), team_id, label)
        if key in seen:
            continue
        seen.add(key)

        nba_id = lookup_player_id(player_name, exact_lookup, norm_lookup)
        if nba_id is None:
            unmatched_count += 1
            continue

        positions = row.get("positions", [])
        pos = normalize_position(positions)
        rows_to_insert.append((nba_id, team_id, label, player_name, pos, ""))

        gp = int(row.get("games_played") or 0)
        if gp > 0:
            gs = int(row.get("games_started") or 0)
            minutes_total = _safe_float(row.get("minutes_played"))
            fgm_total = _safe_float(row.get("made_field_goals"))
            fga_total = _safe_float(row.get("attempted_field_goals"))
            fg3m_total = _safe_float(row.get("made_three_point_field_goals"))
            fg3a_total = _safe_float(row.get("attempted_three_point_field_goals"))
            ftm_total = _safe_float(row.get("made_free_throws"))
            fta_total = _safe_float(row.get("attempted_free_throws"))
            orb_total = _safe_float(row.get("offensive_rebounds"))
            drb_total = _safe_float(row.get("defensive_rebounds"))
            reb_total = orb_total + drb_total
            ast_total = _safe_float(row.get("assists"))
            stl_total = _safe_float(row.get("steals"))
            blk_total = _safe_float(row.get("blocks"))
            tov_total = _safe_float(row.get("turnovers"))
            pf_total = _safe_float(row.get("personal_fouls"))
            pts_total = _safe_float(row.get("points"))

            advanced = advanced_by_player_team.get((nba_id, team_id), {})

            per = _optional_float(advanced.get("player_efficiency_rating"))
            ts_pct = _optional_float(advanced.get("true_shooting_percentage"))
            three_par = _optional_float(advanced.get("three_point_attempt_rate"))
            ftr = _optional_float(advanced.get("free_throw_attempt_rate"))
            orb_pct = _optional_float(advanced.get("offensive_rebound_percentage"))
            drb_pct = _optional_float(advanced.get("defensive_rebound_percentage"))
            trb_pct = _optional_float(advanced.get("total_rebound_percentage"))
            ast_pct = _optional_float(advanced.get("assist_percentage"))
            stl_pct = _optional_float(advanced.get("steal_percentage"))
            blk_pct = _optional_float(advanced.get("block_percentage"))
            tov_pct = _optional_float(advanced.get("turnover_percentage"))
            usg_pct = _optional_float(advanced.get("usage_percentage"))
            ows = _optional_float(advanced.get("offensive_win_shares"))
            dws = _optional_float(advanced.get("defensive_win_shares"))
            ws = _optional_float(advanced.get("win_shares"))
            ws48 = _optional_float(advanced.get("win_shares_per_48_minutes"))
            obpm = _optional_float(advanced.get("offensive_box_plus_minus"))
            dbpm = _optional_float(advanced.get("defensive_box_plus_minus"))
            bpm = _optional_float(advanced.get("box_plus_minus"))
            vorp = _optional_float(advanced.get("value_over_replacement_player"))

            if ts_pct is None:
                ts_pct = _safe_ratio(pts_total, 2 * (fga_total + 0.44 * fta_total))
            if three_par is None:
                three_par = _safe_ratio(fg3a_total, fga_total)
            if ftr is None:
                ftr = _safe_ratio(fta_total, fga_total)

            stats_rows_to_upsert.append((
                nba_id,
                team_id,
                label,
                gp,
                gs,
                _safe_per_game(minutes_total, gp),
                _safe_per_game(pts_total, gp),
                _safe_per_game(reb_total, gp),
                _safe_per_game(ast_total, gp),
                _safe_per_game(stl_total, gp),
                _safe_per_game(blk_total, gp),
                _safe_per_game(fgm_total, gp),
                _safe_per_game(fga_total, gp),
                _safe_per_game(fg3m_total, gp),
                _safe_per_game(fg3a_total, gp),
                _safe_per_game(ftm_total, gp),
                _safe_per_game(fta_total, gp),
                _safe_per_game(tov_total, gp),
                _safe_per_game(pf_total, gp),
                per,
                ts_pct,
                three_par,
                ftr,
                orb_pct,
                drb_pct,
                trb_pct,
                ast_pct,
                stl_pct,
                blk_pct,
                tov_pct,
                usg_pct,
                ows,
                dws,
                ws,
                ws48,
                obpm,
                dbpm,
                bpm,
                vorp,
                "basketball_reference",
            ))

    if rows_to_insert or stats_rows_to_upsert:
        with conn.cursor() as cur:
            if rows_to_insert:
                cur.executemany(
                    """
                    INSERT INTO roster_players (player_id, team_id, season, player_name, position, jersey)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (player_id, team_id, season) DO NOTHING
                    """,
                    rows_to_insert,
                )

            if stats_rows_to_upsert:
                cur.executemany(
                    """
                    INSERT INTO player_season_stats
                        (
                            player_id, team_id, season, gp, gs, minutes,
                            pts, reb, ast, stl, blk,
                            fgm, fga, fg3m, fg3a, ftm, fta, tov, pf,
                            per, ts_pct, three_par, ftr,
                            orb_pct, drb_pct, trb_pct, ast_pct, stl_pct, blk_pct, tov_pct, usg_pct,
                            ows, dws, ws, ws48, obpm, dbpm, bpm, vorp,
                            source
                        )
                    VALUES (
                        %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s, %s, %s,
                        %s
                    )
                    ON CONFLICT (player_id, team_id, season) DO UPDATE
                    SET
                        gp = EXCLUDED.gp,
                        gs = EXCLUDED.gs,
                        minutes = EXCLUDED.minutes,
                        pts = EXCLUDED.pts,
                        reb = EXCLUDED.reb,
                        ast = EXCLUDED.ast,
                        stl = EXCLUDED.stl,
                        blk = EXCLUDED.blk,
                        fgm = EXCLUDED.fgm,
                        fga = EXCLUDED.fga,
                        fg3m = EXCLUDED.fg3m,
                        fg3a = EXCLUDED.fg3a,
                        ftm = EXCLUDED.ftm,
                        fta = EXCLUDED.fta,
                        tov = EXCLUDED.tov,
                        pf = EXCLUDED.pf,
                        per = EXCLUDED.per,
                        ts_pct = EXCLUDED.ts_pct,
                        three_par = EXCLUDED.three_par,
                        ftr = EXCLUDED.ftr,
                        orb_pct = EXCLUDED.orb_pct,
                        drb_pct = EXCLUDED.drb_pct,
                        trb_pct = EXCLUDED.trb_pct,
                        ast_pct = EXCLUDED.ast_pct,
                        stl_pct = EXCLUDED.stl_pct,
                        blk_pct = EXCLUDED.blk_pct,
                        tov_pct = EXCLUDED.tov_pct,
                        usg_pct = EXCLUDED.usg_pct,
                        ows = EXCLUDED.ows,
                        dws = EXCLUDED.dws,
                        ws = EXCLUDED.ws,
                        ws48 = EXCLUDED.ws48,
                        obpm = EXCLUDED.obpm,
                        dbpm = EXCLUDED.dbpm,
                        bpm = EXCLUDED.bpm,
                        vorp = EXCLUDED.vorp,
                        source = EXCLUDED.source,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    stats_rows_to_upsert,
                )
        conn.commit()

    return len(rows_to_insert), len(stats_rows_to_upsert), unmatched_count


def seed_all_seasons(conn, full_name_to_id: dict, exact_lookup: dict, norm_lookup: dict):
    total_roster_inserted = 0
    total_stats_upserted = 0
    total_unmatched = 0
    years = list(range(SEASON_START_END_YEAR, SEASON_STOP_END_YEAR + 1))
    print(f"Seeding {len(years)} seasons ({season_label(years[0])} → {season_label(years[-1])})...")

    for i, end_year in enumerate(years):
        label = season_label(end_year)
        roster_inserted, stats_upserted, unmatched = seed_one_season(
            conn,
            end_year,
            full_name_to_id,
            exact_lookup,
            norm_lookup,
        )
        total_roster_inserted += roster_inserted
        total_stats_upserted += stats_upserted
        total_unmatched += unmatched
        print(
            f"  [{i+1}/{len(years)}] {label}: "
            f"{roster_inserted} rosters, {stats_upserted} stats rows, {unmatched} unmatched"
        )
        if i < len(years) - 1:
            time.sleep(REQUEST_DELAY)

    print(
        "\nAll seasons done. "
        f"{total_roster_inserted} total rosters, "
        f"{total_stats_upserted} total stats rows, "
        f"{total_unmatched} unmatched."
    )


# BBRef uses different abbreviations for a handful of teams
_NBA_API_ABBREV_TO_BREF = {
    "PHX": "PHO",  # Phoenix Suns
    "BKN": "BRK",  # Brooklyn Nets
    "CHA": "CHO",  # Charlotte Hornets
}

_BREF_POS_CSK_TO_SHORT = {
    "1": "PG",
    "2": "SG",
    "3": "SF",
    "4": "PF",
    "5": "C",
}

_BREF_ROSTER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
}

CURRENT_ROSTER_SEASON = "2025-26"
CURRENT_ROSTER_END_YEAR = 2026


def _parse_bref_roster_page(html: str) -> list[dict]:
    """
    Parse a BBRef team roster page HTML.
    Returns list of {name, position, jersey} dicts for all players,
    including injured/inactive players who have an empty jersey number.
    """
    idx = html.find('id="roster"')
    if idx == -1:
        return []

    # Clamp to just this table to avoid bleeding into other tables on the page
    end_idx = html.find("</table>", idx)
    chunk = html[idx: end_idx + len("</table>") if end_idx != -1 else idx + 20000]

    # Match every <tr> row in the table body
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", chunk, re.DOTALL)
    players = []
    for row in rows:
        name_m = re.search(r'data-stat="player"[^>]*>.*?<a[^>]*>([^<]+)</a>', row, re.DOTALL)
        if not name_m:
            continue  # header row or empty row

        name = name_m.group(1).strip()

        pos_m = re.search(r'data-stat="pos"[^>]*csk="(\d+)"', row)
        position = _BREF_POS_CSK_TO_SHORT.get(pos_m.group(1) if pos_m else "", "SF")

        jersey_m = re.search(r'data-stat="number"[^>]*>\s*([^<\s]*)\s*</th>', row)
        jersey = (jersey_m.group(1).strip() if jersey_m else "").replace("&nbsp;", "")

        players.append({"name": name, "position": position, "jersey": jersey})

    return players


def seed_current_rosters_from_bref(
    conn,
    full_name_to_id: dict,
    exact_lookup: dict,
    norm_lookup: dict,
):
    """
    Supplemental pass: scrape BBRef team roster pages for the current season
    and insert any players missing from roster_players (e.g. injured players
    who haven't posted stats yet).

    Safe to run after seed_all_seasons — uses ON CONFLICT DO NOTHING.
    """
    team_rows = []
    for t in static_teams.get_teams():
        tid = str(t["id"])
        abbrev = _NBA_API_ABBREV_TO_BREF.get(t["abbreviation"], t["abbreviation"])
        team_rows.append({"full_name": t["full_name"], "id": tid, "bref_abbrev": abbrev})

    total_inserted = 0
    total_unmatched = 0

    for i, team in enumerate(team_rows):
        url = f"https://www.basketball-reference.com/teams/{team['bref_abbrev']}/{CURRENT_ROSTER_END_YEAR}.html"
        try:
            resp = requests.get(url, headers=_BREF_ROSTER_HEADERS, timeout=15)
            resp.raise_for_status()
            resp.encoding = "utf-8"  # BBRef is UTF-8; requests sometimes misdetects it
        except Exception as e:
            print(f"  [{team['full_name']}] ERROR fetching {url}: {e}")
            if i < len(team_rows) - 1:
                time.sleep(REQUEST_DELAY)
            continue

        players = _parse_bref_roster_page(resp.text)
        if not players:
            print(f"  [{team['full_name']}] WARNING: no players parsed from roster page")
            if i < len(team_rows) - 1:
                time.sleep(REQUEST_DELAY)
            continue

        rows_to_insert = []
        for p in players:
            nba_id = lookup_player_id(p["name"], exact_lookup, norm_lookup)
            if nba_id is None:
                total_unmatched += 1
                print(f"    unmatched: {p['name']!r}")
                continue
            rows_to_insert.append((
                nba_id, team["id"], CURRENT_ROSTER_SEASON,
                p["name"], p["position"], p["jersey"],
            ))

        # Replace the team's current-season roster entirely so traded players
        # don't linger on their old team. Only do this if the scrape looks
        # complete (≥10 players) to guard against partial/failed pages.
        if rows_to_insert and len(players) >= 10:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM roster_players WHERE team_id = %s AND season = %s",
                    (team["id"], CURRENT_ROSTER_SEASON),
                )
                cur.executemany(
                    """
                    INSERT INTO roster_players (player_id, team_id, season, player_name, position, jersey)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (player_id, team_id, season) DO NOTHING
                    """,
                    rows_to_insert,
                )
                inserted = cur.rowcount
            conn.commit()
            total_inserted += inserted
            print(f"  [{team['full_name']}] roster replaced: {inserted} players, {total_unmatched} unmatched")
        elif rows_to_insert:
            # Too few players scraped — fall back to supplement-only to be safe
            with conn.cursor() as cur:
                cur.executemany(
                    """
                    INSERT INTO roster_players (player_id, team_id, season, player_name, position, jersey)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (player_id, team_id, season) DO NOTHING
                    """,
                    rows_to_insert,
                )
                inserted = cur.rowcount
            conn.commit()
            total_inserted += inserted
            print(f"  [{team['full_name']}] WARNING: only {len(players)} players scraped, supplemented {inserted}")
        else:
            print(f"  [{team['full_name']}] 0 insertable rows")

        if i < len(team_rows) - 1:
            time.sleep(REQUEST_DELAY)

    print(f"\nRoster scrape done. {total_inserted} players inserted across 30 teams, {total_unmatched} unmatched.")


def main():
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("ERROR: DATABASE_URL environment variable not set.")

    print("Connecting to database...")
    conn = psycopg2.connect(database_url)

    print("Applying schema...")
    apply_schema(conn)

    print("Seeding teams...")
    full_name_to_id = seed_teams(conn)

    print("Building player name → ID lookup (local, no HTTP)...")
    exact_lookup, norm_lookup = build_player_id_lookup()
    print(f"  {len(exact_lookup)} players in static dataset.")

    seed_all_seasons(conn, full_name_to_id, exact_lookup, norm_lookup)

    print(f"\nScraping current-season ({CURRENT_ROSTER_SEASON}) rosters from BBRef (captures injured/inactive players)...")
    seed_current_rosters_from_bref(conn, full_name_to_id, exact_lookup, norm_lookup)

    conn.close()
    print("\nDone! Verify with:")
    print("  SELECT COUNT(*) FROM teams;          -- expect 30")
    print("  SELECT COUNT(*) FROM roster_players; -- expect ~8,000-12,000")
    print("  SELECT COUNT(*) FROM player_season_stats; -- expect ~8,000-12,000")
    print("  SELECT COUNT(DISTINCT player_id) FROM roster_players; -- unique players")


if __name__ == "__main__":
    main()
