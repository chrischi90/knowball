"""
NBA data service using nba_api. Exposes REST endpoints for teams, team rosters, and player stats.
"""
import os
from functools import lru_cache
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# nba_api imports
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
def list_team_players(team_id: str):
    """
    List players who have played for this team (current + recent seasons).
    Returns active and recently active/retired players. Deduplicated by player_id.
    """
    try:
        all_players = {}  # player_id -> { id, name, position, ... }
        for season in ROSTER_SEASONS:
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
            except Exception:
                continue
        players = list(all_players.values())
        players.sort(key=lambda p: p["name"])
        return {"players": players}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@lru_cache(maxsize=500)
def _get_player_career_per_game(player_id: str) -> Optional[dict]:
    """Fetch career per-game stats for simulation. Cached by player_id."""
    try:
        stats = PlayerCareerStats(player_id=player_id, per_mode36="PerGame")
        dfs = stats.get_data_frames()
        # CareerTotalsRegularSeason is index 3 per docs
        for df in dfs:
            if "PTS" in df.columns and "GP" in df.columns:
                # Aggregate career: sum totals then divide by total GP for per-game
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
        return None


@app.get("/players/{player_id}/stats")
def get_player_stats(player_id: str):
    """Get career per-game stats for simulation."""
    result = _get_player_career_per_game(player_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Player stats not found")
    return result


@app.get("/health")
def health():
    return {"status": "ok"}
