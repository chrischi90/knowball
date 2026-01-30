"""
NBA data service using nba_api. Exposes REST endpoints for teams, team rosters, and player stats.
"""
import os
from functools import lru_cache
from typing import Optional
import threading
import requests

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

# Ball Don't Lie API helpers
BDL_BASE = "https://api.balldontlie.io/api/v1"
BDL_TIMEOUT = 5

def get_bdl_players(team_id: str) -> dict:
    """Fetch players from Ball Don't Lie API as fallback."""
    try:
        # Map NBA team IDs to Ball Don't Lie team abbreviations
        team_id_to_abbr = {
            "1610612738": "bos", "1610612751": "bkn", "1610612752": "cle",
            "1610612761": "chi", "1610612762": "dal", "1610612763": "den",
            "1610612765": "det", "1610612766": "hou", "1610612743": "den",
            "1610612744": "uta", "1610612746": "lac", "1610612747": "lal",
            "1610612748": "mia", "1610612749": "mil", "1610612750": "min",
            "1610612740": "nop", "1610612752": "cle", "1610612760": "okc",
            "1610612753": "orl", "1610612755": "phi", "1610612761": "chi",
            "1610612764": "was", "1610612762": "dal", "1610612738": "bos",
            "1610612745": "hou", "1610612741": "chi", "1610612742": "dal",
            "1610612756": "phx", "1610612757": "por", "1610612758": "sac",
            "1610612759": "sa", "1610612761": "chi", "1610612762": "dal",
        }
        
        abbr = team_id_to_abbr.get(str(team_id), "")
        if not abbr:
            return {}
        
        url = f"{BDL_BASE}/players?team={abbr}&per_page=100"
        resp = requests.get(url, timeout=BDL_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        
        players = {}
        for player in data.get("data", []):
            pid = str(player.get("id", ""))
            if not pid:
                continue
            pos = player.get("position", "F").upper()
            if pos in ("G", "G-F"):
                pos = "SG"
            elif pos in ("F", "F-G"):
                pos = "SF"
            elif pos in ("F-C", "C-F"):
                pos = "PF"
            elif pos not in ("PG", "SG", "SF", "PF", "C"):
                pos = "F"
            
            first = player.get("first_name", "")
            last = player.get("last_name", "")
            name = f"{first} {last}".strip()
            
            players[pid] = {
                "id": pid,
                "name": name,
                "position": pos[:2] if len(pos) >= 2 else pos,
                "jersey": str(player.get("jersey_number", "")),
            }
        
        return players
    except Exception as e:
        print(f"Ball Don't Lie API error: {e}")
        return {}

def get_bdl_player_stats(player_id: str) -> Optional[dict]:
    """Fetch player stats from Ball Don't Lie API as fallback."""
    try:
        url = f"{BDL_BASE}/season_averages?player_ids[]={player_id}"
        resp = requests.get(url, timeout=BDL_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        
        if not data.get("data"):
            return None
        
        stats = data["data"][0]
        return {
            "player_id": player_id,
            "gp": int(stats.get("games_played", 0)),
            "pts": float(stats.get("pts", 0)),
            "reb": float(stats.get("reb", 0)),
            "ast": float(stats.get("ast", 0)),
            "stl": float(stats.get("stl", 0)),
            "blk": float(stats.get("blk", 0)),
        }
    except Exception as e:
        print(f"Ball Don't Lie stats error: {e}")
        return None

# In-memory cache for teams (static data)
_teams_cache: Optional[list] = None

# Seasons to aggregate for "team players" (current season only; minimize API calls for performance on Render)
ROSTER_SEASONS = ["2024-25"]


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
    List players who have played for this team (current season).
    Tries nba_api with 10-second timeout, then falls back to Ball Don't Lie.
    """
    try:
        all_players = {}
        
        # Try nba_api with timeout
        for season in ROSTER_SEASONS:
            result = []
            
            def fetch_roster():
                try:
                    roster = CommonTeamRoster(team_id=team_id, season=season)
                    df = roster.get_data_frames()[0]
                    return df
                except Exception as e:
                    print(f"nba_api error for team {team_id} season {season}: {e}")
                    return None
            
            thread = threading.Thread(target=lambda r=result: r.append(fetch_roster()))
            thread.daemon = True
            thread.start()
            thread.join(timeout=10)  # 10-second timeout
            
            if thread.is_alive():
                print(f"nba_api timeout for team {team_id}, using fallback")
                break
            
            if result and result[0] is not None:
                df = result[0]
                for _, row in df.iterrows():
                    pid = str(row["PLAYER_ID"])
                    if pid not in all_players:
                        pos = str(row.get("POSITION", "")).strip() or "F"
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
        
        # Fallback if nba_api is empty or timed out
        if not all_players:
            print(f"Falling back to Ball Don't Lie for team {team_id}")
            all_players = get_bdl_players(team_id)
        
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
    """Get career per-game stats for simulation. Falls back to Ball Don't Lie if nba_api times out."""
    result = _get_player_career_per_game(player_id)
    if result is None:
        # Fallback to Ball Don't Lie
        result = get_bdl_player_stats(player_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Player stats not found")
    return result


@app.get("/health")
def health():
    return {"status": "ok"}
