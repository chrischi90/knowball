"""
NBA data service. Teams and rosters served from Neon Postgres DB.
Player stats still fetched from nba_api (one-time at simulation, with disk cache).
"""
import json
import os
import time
from pathlib import Path
from typing import Optional

import psycopg2
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# nba_api — only needed for the /players/{id}/stats endpoint
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


# Persistent disk cache for player stats. Survives service restarts so a successful
# fetch is never lost. Only successful (non-None) results are stored.
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


def _fetch_player_career_per_game(player_id: str, team_id: Optional[str] = None) -> Optional[dict]:
    """Internal: fetch per-game stats from nba_api. No caching. Retries up to 3 times."""
    for attempt in range(3):
        try:
            stats = PlayerCareerStats(player_id=player_id, per_mode36="PerGame", timeout=30)
            dfs = stats.get_data_frames()
            # SeasonTotalsRegularSeason is index 0; has one row per season-team combo
            for df in dfs:
                if "PTS" in df.columns and "GP" in df.columns:
                    if team_id is not None:
                        # Filter to only seasons with this team; skip TOT rows (TEAM_ID=0)
                        df = df[df["TEAM_ID"] == int(team_id)]
                    # Exclude injury-shortened seasons (< 20 GP) so stats reflect healthy play
                    df = df[df["GP"] >= 20]
                    total_gp = df["GP"].sum()
                    if total_gp == 0:
                        return None
                    return {
                        "player_id": player_id,
                        "gp": int(total_gp),
                        "pts": float((df["PTS"] * df["GP"]).sum() / total_gp),
                        "reb": float((df["REB"] * df["GP"]).sum() / total_gp),
                        "ast": float((df["AST"] * df["GP"]).sum() / total_gp),
                        "stl": float((df["STL"] * df["GP"]).sum() / total_gp),
                        "blk": float((df["BLK"] * df["GP"]).sum() / total_gp),
                    }
            return None
        except Exception:
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
    return None


def _get_player_career_per_game(player_id: str, team_id: Optional[str] = None) -> Optional[dict]:
    """Fetch per-game stats. Uses persistent disk cache; only caches successful results."""
    key = f"{player_id}:{team_id}"
    if key in _stats_cache:
        return _stats_cache[key]
    result = _fetch_player_career_per_game(player_id, team_id)
    if result is not None:
        _stats_cache[key] = result
        _save_stats_cache(_stats_cache)
    return result


@app.get("/players/{player_id}/stats")
def get_player_stats(player_id: str, team_id: Optional[str] = None):
    """Get per-game stats for simulation. Pass team_id to scope stats to that team's tenure."""
    result = _get_player_career_per_game(player_id, team_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Player stats not found")
    return result


@app.get("/health")
def health():
    return {"status": "ok"}
