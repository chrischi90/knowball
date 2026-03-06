"""
NBA data service. Teams and rosters served from Neon Postgres DB.
Player stats: Basketball Reference is primary (more permissive), nba_api is fallback.
Stats are mode-aware: active_only=current season, all_time=career stint with selected team.
"""
import json
import logging
import os
import re
import time
import unicodedata
from pathlib import Path
from typing import Optional

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("nba_service")

import psycopg2
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# basketball_reference_web_scraper — primary stats source
from basketball_reference_web_scraper import client as br_client

# nba_api — fallback stats source only
import nba_api.stats.library.http as _nba_stats_http

_nba_stats_http.NBAStatsHTTP.headers.update({
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.nba.com/",
    "x-nba-stats-origin": "stats",
    "x-nba-stats-token": "true",
})

from nba_api.stats.endpoints import PlayerCareerStats

app = FastAPI(title="NBA Roster Wheel - Data Service")

# CORS: allow Next.js dev and prod
origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    os.environ.get("NEXT_PUBLIC_APP_ORIGIN", ""),
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in origins if o],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# DB connection — reconnects automatically on idle timeout (Neon free tier: 5 min)
_conn = None


def get_db():
    global _conn
    try:
        if _conn is None or _conn.closed:
            raise Exception("no connection")
        with _conn.cursor() as cur:
            cur.execute("SELECT 1")
    except Exception:
        _conn = psycopg2.connect(os.environ["DATABASE_URL"])
    return _conn


# In-memory cache for teams (populated from DB on first request)
_teams_cache: Optional[list] = None


def get_teams_list() -> list[dict]:
    """Get all NBA teams from DB. Cached in memory."""
    global _teams_cache
    if _teams_cache is not None:
        return _teams_cache
    conn = get_db()
    with conn.cursor() as cur:
        cur.execute("SELECT id, full_name, abbreviation, nickname, city FROM teams ORDER BY full_name")
        rows = cur.fetchall()
    _teams_cache = [
        {"id": r[0], "full_name": r[1], "abbreviation": r[2], "nickname": r[3], "city": r[4]}
        for r in rows
    ]
    return _teams_cache


@app.get("/teams")
def list_teams():
    """List all NBA teams for the wheel."""
    try:
        return {"teams": get_teams_list()}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/teams/{team_id}/players")
def list_team_players(team_id: str, active_only: bool = False):
    """
    List players for this team from DB.
    - active_only=True: current season (2025-26) only.
    - active_only=False: all seeded seasons, deduplicated (most recent position wins).
    """
    try:
        conn = get_db()
        with conn.cursor() as cur:
            if active_only:
                cur.execute(
                    """
                    SELECT player_id, player_name, position, jersey
                    FROM roster_players
                    WHERE team_id = %s AND season = '2025-26'
                    ORDER BY player_name
                    """,
                    (team_id,),
                )
            else:
                cur.execute(
                    """
                    SELECT DISTINCT ON (player_id) player_id, player_name, position, jersey
                    FROM roster_players
                    WHERE team_id = %s
                    ORDER BY player_id, season DESC
                    """,
                    (team_id,),
                )
            rows = cur.fetchall()

        players = [
            {"id": r[0], "name": r[1], "position": r[2], "jersey": r[3] or ""}
            for r in rows
        ]
        players.sort(key=lambda p: p["name"])

        if not players:
            raise HTTPException(status_code=404, detail=f"No roster data found for team_id={team_id}")

        return {"players": players}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ---------------------------------------------------------------------------
# Constants & helpers for Basketball Reference
# ---------------------------------------------------------------------------

CURRENT_SEASON = "2025-26"

_SUFFIX_RE = re.compile(r"\s+(jr\.?|sr\.?|ii|iii|iv|v)$", re.IGNORECASE)


def _normalize_name(name: str) -> str:
    """Lowercase, strip accents, remove generational suffixes."""
    n = unicodedata.normalize("NFD", name).encode("ascii", "ignore").decode("ascii")
    n = _SUFFIX_RE.sub("", n.strip().lower()).strip()
    return n


def _strip_team_suffix(name: str) -> str:
    """Remove ' (ABC)' team suffix: 'Stephen Curry (GSW)' → 'Stephen Curry'."""
    return re.sub(r"\s+\([A-Z]+\)$", "", (name or "")).strip()


# ---------------------------------------------------------------------------
# Basketball Reference — player_season_totals (league-wide per-season scrape)
# Works for both active_only and all_time: static HTML, no JS rendering issues.
# ---------------------------------------------------------------------------

# Process-level cache: the 5 parallel player stat fetches share one BR HTTP call per season
_br_season_cache: dict[int, list] = {}


def _get_br_season_totals(season_end_year: int) -> list:
    if season_end_year not in _br_season_cache:
        logger.info("BR: fetching player_season_totals for %d", season_end_year)
        _br_season_cache[season_end_year] = br_client.players_season_totals(
            season_end_year=season_end_year
        )
        logger.info("BR: got %d players for %d", len(_br_season_cache[season_end_year]), season_end_year)
    return _br_season_cache[season_end_year]


def _fetch_br_seasons(player_name: str, season_end_years: list[int], min_gp: int = 5) -> Optional[dict]:
    """
    GP-weighted per-game stats across the given seasons from BR player_season_totals.
    Used for both active_only (single season [2026]) and all_time (DB-derived seasons).
    """
    clean = _strip_team_suffix(player_name)
    norm = _normalize_name(clean)
    logger.info("BR fetch: player=%r seasons=%s min_gp=%d", clean, season_end_years, min_gp)

    weighted_rows: list[dict] = []
    for year in season_end_years:
        try:
            totals = _get_br_season_totals(year)
            matching = [p for p in totals if _normalize_name(p.get("name", "")) == norm]
            if not matching:
                logger.info("BR: no match for %r in season %d", clean, year)
                continue
            # For traded players: pick the row with the most games
            best = max(matching, key=lambda p: p.get("games_played", 0))
            gp = best.get("games_played") or 0
            if gp < min_gp:
                logger.info("BR: %r season %d only %d gp (min=%d), skipping", clean, year, gp, min_gp)
                continue
            reb = (best.get("offensive_rebounds") or 0) + (best.get("defensive_rebounds") or 0)
            weighted_rows.append({
                "g": gp,
                "pts": (best.get("points") or 0) / gp,
                "reb": reb / gp,
                "ast": (best.get("assists") or 0) / gp,
                "stl": (best.get("steals") or 0) / gp,
                "blk": (best.get("blocks") or 0) / gp,
            })
            logger.info("BR: %r season %d → gp=%d pts=%.1f", clean, year, gp, (best.get("points") or 0) / gp)
        except Exception as exc:
            logger.warning("BR: season %d failed for %r: %s", year, clean, exc)

    if not weighted_rows:
        return None

    total_gp = sum(r["g"] for r in weighted_rows)
    return {
        "player_id": "",
        "gp": total_gp,
        "pts": sum(r["pts"] * r["g"] for r in weighted_rows) / total_gp,
        "reb": sum(r["reb"] * r["g"] for r in weighted_rows) / total_gp,
        "ast": sum(r["ast"] * r["g"] for r in weighted_rows) / total_gp,
        "stl": sum(r["stl"] * r["g"] for r in weighted_rows) / total_gp,
        "blk": sum(r["blk"] * r["g"] for r in weighted_rows) / total_gp,
    }


def _get_player_team_seasons(player_id: str, team_id: str) -> list[int]:
    """
    Return list of season_end_years for which player_id was on team_id in our DB.
    Season strings like '2025-26' are converted to end year 2026.
    """
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT season FROM roster_players WHERE player_id = %s AND team_id = %s",
                (player_id, team_id),
            )
            rows = cur.fetchall()
        end_years = []
        for (season_str,) in rows:
            try:
                # "2025-26" → 2026, "1999-00" → 2000
                start_year = int(season_str[:4])
                end_years.append(start_year + 1)
            except (ValueError, IndexError):
                pass
        return sorted(end_years)
    except Exception as exc:
        logger.warning("_get_player_team_seasons failed for player=%s team=%s: %s", player_id, team_id, exc)
        return []




# ---------------------------------------------------------------------------
# nba_api fallback
# ---------------------------------------------------------------------------


def _fetch_nba_api_stats(
    player_id: str,
    team_id: Optional[str] = None,
    season_filter: Optional[str] = None,
) -> Optional[dict]:
    """Fetch per-game stats from nba_api. Used as fallback when BR scraping fails."""
    logger.info("nba_api fallback: player_id=%s team_id=%s season_filter=%s", player_id, team_id, season_filter)
    for attempt in range(3):
        try:
            stats = PlayerCareerStats(player_id=player_id, per_mode36="PerGame", timeout=8)
            dfs = stats.get_data_frames()
            for df in dfs:
                if "PTS" not in df.columns or "GP" not in df.columns:
                    continue
                if season_filter:
                    df = df[df["SEASON_ID"] == season_filter]
                if team_id is not None:
                    df = df[df["TEAM_ID"] == int(team_id)]
                df = df[df["GP"] >= 20]
                total_gp = df["GP"].sum()
                if total_gp == 0:
                    logger.info("nba_api: player_id=%s has 0 qualifying GP after filters", player_id)
                    return None
                logger.info("nba_api: player_id=%s → total_gp=%d", player_id, total_gp)
                return {
                    "player_id": player_id,
                    "gp": int(total_gp),
                    "pts": float((df["PTS"] * df["GP"]).sum() / total_gp),
                    "reb": float((df["REB"] * df["GP"]).sum() / total_gp),
                    "ast": float((df["AST"] * df["GP"]).sum() / total_gp),
                    "stl": float((df["STL"] * df["GP"]).sum() / total_gp),
                    "blk": float((df["BLK"] * df["GP"]).sum() / total_gp),
                }
            logger.info("nba_api: player_id=%s no matching dataframe found", player_id)
            return None
        except Exception as exc:
            logger.warning("nba_api attempt %d failed for player_id=%s: %s", attempt, player_id, exc)
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
    return None


# ---------------------------------------------------------------------------
# Persistent disk cache
# ---------------------------------------------------------------------------

_STATS_CACHE_FILE = Path(__file__).parent / "stats_cache.json"


def _load_stats_cache() -> dict:
    try:
        if _STATS_CACHE_FILE.exists():
            return json.loads(_STATS_CACHE_FILE.read_text())
    except Exception:
        pass
    return {}


def _save_stats_cache(cache: dict) -> None:
    try:
        _STATS_CACHE_FILE.write_text(json.dumps(cache))
    except Exception:
        pass


_stats_cache: dict = _load_stats_cache()


def _get_player_stats(
    player_id: str,
    team_id: Optional[str] = None,
    player_name: Optional[str] = None,
    game_mode: str = "all_time",
) -> Optional[dict]:
    """
    Fetch per-game stats with BR as primary and nba_api as fallback.

    active_only: 2025-26 season stats via BR player_season_totals → nba_api fallback.
    all_time:    career stats scoped to team via BR player_season_totals (DB seasons) → nba_api fallback.
    """
    key = f"{player_id}:{team_id}:{game_mode}"
    if key in _stats_cache:
        logger.info("stats cache hit: %s", key)
        return _stats_cache[key]

    result: Optional[dict] = None

    if game_mode == "active_only":
        if player_name:
            result = _fetch_br_seasons(player_name, [2026], min_gp=5)
        if result is None:
            result = _fetch_nba_api_stats(player_id, team_id=None, season_filter=CURRENT_SEASON)
    else:  # all_time
        seasons = _get_player_team_seasons(player_id, team_id) if player_id and team_id else []
        if player_name and seasons:
            result = _fetch_br_seasons(player_name, seasons, min_gp=20)
        if result is None:
            result = _fetch_nba_api_stats(player_id, team_id)

    if result is not None:
        result["player_id"] = player_id
        _stats_cache[key] = result
        _save_stats_cache(_stats_cache)

    return result


@app.get("/players/{player_id}/stats")
def get_player_stats(
    player_id: str,
    team_id: Optional[str] = None,
    player_name: Optional[str] = None,
    game_mode: str = "all_time",
):
    """
    Get per-game stats for simulation.
    - game_mode=active_only: 2025-26 season only
    - game_mode=all_time: career stats scoped to team_id tenure
    Pass player_name (display form OK, e.g. 'Stephen Curry (GSW)') to enable BR primary path.
    """
    result = _get_player_stats(player_id, team_id, player_name, game_mode)
    if result is None:
        raise HTTPException(status_code=404, detail="Player stats not found")
    return result


@app.get("/health")
def health():
    return {"status": "ok"}
