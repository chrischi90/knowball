"""
Seed script to populate Neon Postgres with NBA teams and historical rosters.

Data sources:
  - Teams:      nba_api static data (local, no HTTP)
  - Rosters:    basketball_reference_web_scraper players_season_totals (one HTTP call per season)
  - Player IDs: nba_api static player data (local, no HTTP) cross-referenced by name

Run locally (NOT on Render):
    pip install -r seed_requirements.txt
    DATABASE_URL="postgresql://..." python seed_db.py

Idempotent — safe to re-run. Re-run after trades or at the start of a new season.
To add a new season, just re-run — it will skip already-inserted rows.
"""
import os
import re
import time
import unicodedata

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


def resolve_team_id(team_enum: Team, full_name_to_id: dict) -> "str | None":
    """Map a bref Team enum to our DB team_id, handling historical franchise names."""
    bref_name = team_enum.value.title()
    nba_full_name = BREF_FULL_NAME_TO_NBA_FULL_NAME.get(team_enum.value, bref_name)
    return full_name_to_id.get(nba_full_name) or full_name_to_id.get(bref_name)


def seed_one_season(conn, end_year: int, full_name_to_id: dict, exact_lookup: dict, norm_lookup: dict):
    """Fetch and insert one season's roster data. Returns (inserted, unmatched) counts."""
    label = season_label(end_year)
    try:
        season_data = client.players_season_totals(season_end_year=end_year)
    except Exception as e:
        print(f"  [{label}] ERROR fetching: {e}")
        return 0, 0

    # Deduplicate within a single season: bref emits a TOT row + per-team rows for
    # traded players. Track (name, team_id, season) so a player can appear for the
    # same team across different seasons but not twice in the same season.
    seen: set = set()
    rows_to_insert = []
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

    if rows_to_insert:
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO roster_players (player_id, team_id, season, player_name, position, jersey)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (player_id, team_id, season) DO NOTHING
                """,
                rows_to_insert,
            )
        conn.commit()

    return len(rows_to_insert), unmatched_count


def seed_all_seasons(conn, full_name_to_id: dict, exact_lookup: dict, norm_lookup: dict):
    total_inserted = 0
    total_unmatched = 0
    years = list(range(SEASON_START_END_YEAR, SEASON_STOP_END_YEAR + 1))
    print(f"Seeding {len(years)} seasons ({season_label(years[0])} → {season_label(years[-1])})...")

    for i, end_year in enumerate(years):
        label = season_label(end_year)
        inserted, unmatched = seed_one_season(conn, end_year, full_name_to_id, exact_lookup, norm_lookup)
        total_inserted += inserted
        total_unmatched += unmatched
        print(f"  [{i+1}/{len(years)}] {label}: {inserted} inserted, {unmatched} unmatched")
        if i < len(years) - 1:
            time.sleep(REQUEST_DELAY)

    print(f"\nAll seasons done. {total_inserted} total rows inserted, {total_unmatched} unmatched.")


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

    conn.close()
    print("\nDone! Verify with:")
    print("  SELECT COUNT(*) FROM teams;          -- expect 30")
    print("  SELECT COUNT(*) FROM roster_players; -- expect ~8,000-12,000")
    print("  SELECT COUNT(DISTINCT player_id) FROM roster_players; -- unique players")


if __name__ == "__main__":
    main()
