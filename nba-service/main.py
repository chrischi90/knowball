"""
NBA data service using nba_api. Exposes REST endpoints for teams, team rosters, and player stats.
"""
import json
import os
import time
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# nba_api imports — patch headers before importing endpoints so stats.nba.com
# doesn't block the requests. NBAStatsHTTP (subclass) owns the actual headers dict.
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

from nba_api.stats.static import teams as static_teams
from nba_api.stats.endpoints import CommonTeamRoster, PlayerCareerStats

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

# In-memory cache for teams (static data)
_teams_cache: Optional[list] = None

# Seasons to aggregate for "team players" (current + recent past for more players including retired)
ROSTER_SEASONS = ["2024-25", "2023-24", "2022-23", "2021-22", "2020-21"]


def get_teams_list() -> list[dict]:
    """Get all NBA teams. Cached."""
    global _teams_cache
    if _teams_cache is not None:
        return _teams_cache
    raw = static_teams.get_teams()
    # Filter to current NBA teams only (id is numeric string, 30 teams)
    result = []
    seen_ids = set()
    for t in raw:
        tid = str(t.get("id", ""))
        if tid and tid not in seen_ids:
            seen_ids.add(tid)
            result.append({
                "id": tid,
                "full_name": t.get("full_name", ""),
                "abbreviation": t.get("abbreviation", ""),
                "nickname": t.get("nickname", ""),
                "city": t.get("city", ""),
            })
    # Sort by full_name for consistent wheel order
    result.sort(key=lambda x: x["full_name"])
    _teams_cache = result
    return result


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
    List players who have played for this team.
    - active_only=False (default): current + recent seasons (all-time, includes retired).
    - active_only=True: current season only (active players).
    Deduplicated by player_id.
    """
    try:
        seasons = ["2024-25"] if active_only else ROSTER_SEASONS
        all_players = {}  # player_id -> { id, name, position, ... }
        season_errors = []
        for season in seasons:
            try:
                roster = CommonTeamRoster(team_id=team_id, season=season)
                df = roster.get_data_frames()[0]
                for _, row in df.iterrows():
                    pid = str(row["PLAYER_ID"])
                    if pid not in all_players:
                        pos = str(row.get("POSITION", "")).strip() or "F"
                        # Normalize position to PG/SG/SF/PF/C for game
                        if pos.upper() in ("G", "G-F"):
                            pos = "SG"
                        elif pos.upper() in ("F", "F-G"):
                            pos = "SF"
                        elif pos.upper() in ("F-C", "C-F"):
                            pos = "PF"
                        elif pos.upper() not in ("PG", "SG", "SF", "PF", "C"):
                            pos = "F"
                        all_players[pid] = {
                            "id": pid,
                            "name": str(row.get("PLAYER", "")),
                            "position": pos[:2] if len(pos) >= 2 else pos,
                            "jersey": str(row.get("NUM", "")),
                        }
            except Exception as season_err:
                season_errors.append(f"{season}: {season_err}")
                continue
        players = list(all_players.values())
        if not players and season_errors:
            # Avoid silently returning empty lists when upstream calls failed.
            raise HTTPException(
                status_code=502,
                detail=(
                    "Unable to fetch team roster from NBA stats service. "
                    f"team_id={team_id}. Errors: {' | '.join(season_errors[:2])}"
                ),
            )
        players.sort(key=lambda p: p["name"])
        return {"players": players}
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
