"""
NBA data service. Teams, rosters, and seeded player stats served from Neon Postgres DB.
Player stats path is DB-first with Basketball Reference and nba_api as fallback.
Stats are mode-aware: active_only=current season, all_time=career stint with selected team.
"""
import logging
import os
import re
import threading
import time
import unicodedata
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


def _safe_ratio(numerator: float, denominator: float) -> float:
    if not denominator:
        return 0.0
    return float(numerator) / float(denominator)


# ---------------------------------------------------------------------------
# Basketball Reference — player_season_totals (league-wide per-season scrape)
# Works for both active_only and all_time: static HTML, no JS rendering issues.
# ---------------------------------------------------------------------------

# Process-level cache: shared across concurrent player stat fetches
_br_season_cache: dict[int, list] = {}
_br_fetch_lock = threading.Lock()
_br_last_fetch_time: float = 0.0
_BR_MIN_INTERVAL = 0.35  # seconds between BR HTTP calls to avoid 429s


def _get_br_season_totals(season_end_year: int) -> list:
    # Fast path: already in memory cache
    if season_end_year in _br_season_cache:
        return _br_season_cache[season_end_year]

    with _br_fetch_lock:
        # Re-check after acquiring lock (another thread may have fetched it)
        if season_end_year in _br_season_cache:
            return _br_season_cache[season_end_year]

        # Rate limit: minimum interval between BR HTTP calls
        global _br_last_fetch_time
        elapsed = time.time() - _br_last_fetch_time
        if elapsed < _BR_MIN_INTERVAL:
            time.sleep(_BR_MIN_INTERVAL - elapsed)

        logger.info("BR: fetching players_season_totals for %d", season_end_year)
        _br_season_cache[season_end_year] = br_client.players_season_totals(
            season_end_year=season_end_year
        )
        _br_last_fetch_time = time.time()
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


def _query_seeded_stats_rows(
    player_id: str,
    team_id: Optional[str] = None,
    season_filter: Optional[str] = None,
) -> list[tuple]:
    """Read raw player season stat rows from Postgres."""
    try:
        conn = get_db()
        clauses = ["player_id = %s"]
        params: list = [player_id]

        if team_id:
            clauses.append("team_id = %s")
            params.append(team_id)
        if season_filter:
            clauses.append("season = %s")
            params.append(season_filter)

        query = (
            "SELECT "
            "gp, pts, reb, ast, stl, blk, "
            "per, ts_pct, three_par, ftr, "
            "orb_pct, drb_pct, trb_pct, ast_pct, stl_pct, blk_pct, tov_pct, usg_pct, "
            "ows, dws, ws, ws48, obpm, dbpm, bpm, vorp, "
            "minutes, fgm, fga, fg3m, fg3a, ftm, fta, tov, pf "
            "FROM player_season_stats "
            f"WHERE {' AND '.join(clauses)}"
        )
        with conn.cursor() as cur:
            cur.execute(query, tuple(params))
            return cur.fetchall()
    except Exception as exc:
        logger.warning(
            "seeded stats query failed for player=%s team=%s season=%s: %s",
            player_id,
            team_id,
            season_filter,
            exc,
        )
        return []


def _aggregate_seeded_stats(rows: list[tuple], min_gp: int) -> Optional[dict]:
    """Build GP-weighted stats from season rows."""
    qualifying: list[tuple] = []
    for row in rows:
        gp = int(row[0] or 0)
        if gp < min_gp:
            continue
        qualifying.append(row)

    if not qualifying:
        return None

    def weighted_optional(index: int) -> Optional[float]:
        weighted_sum = 0.0
        weighted_gp = 0
        for row in qualifying:
            value = row[index]
            gp = int(row[0] or 0)
            if value is None:
                continue
            weighted_sum += float(value) * gp
            weighted_gp += gp
        if weighted_gp == 0:
            return None
        return weighted_sum / weighted_gp

    total_gp = sum(int(r[0] or 0) for r in qualifying)
    total_pts = sum(float(r[1] or 0) * int(r[0] or 0) for r in qualifying)
    total_reb = sum(float(r[2] or 0) * int(r[0] or 0) for r in qualifying)
    total_ast = sum(float(r[3] or 0) * int(r[0] or 0) for r in qualifying)
    total_stl = sum(float(r[4] or 0) * int(r[0] or 0) for r in qualifying)
    total_blk = sum(float(r[5] or 0) * int(r[0] or 0) for r in qualifying)
    total_minutes = sum(float(r[26] or 0) * int(r[0] or 0) for r in qualifying)
    total_fgm = sum(float(r[27] or 0) * int(r[0] or 0) for r in qualifying)
    total_fga = sum(float(r[28] or 0) * int(r[0] or 0) for r in qualifying)
    total_fg3m = sum(float(r[29] or 0) * int(r[0] or 0) for r in qualifying)
    total_fg3a = sum(float(r[30] or 0) * int(r[0] or 0) for r in qualifying)
    total_ftm = sum(float(r[31] or 0) * int(r[0] or 0) for r in qualifying)
    total_fta = sum(float(r[32] or 0) * int(r[0] or 0) for r in qualifying)
    total_tov = sum(float(r[33] or 0) * int(r[0] or 0) for r in qualifying)
    total_pf = sum(float(r[34] or 0) * int(r[0] or 0) for r in qualifying)

    pts_pg = total_pts / total_gp
    reb_pg = total_reb / total_gp
    ast_pg = total_ast / total_gp
    stl_pg = total_stl / total_gp
    blk_pg = total_blk / total_gp

    ts_pct = weighted_optional(7)
    if ts_pct is None:
        ts_pct = _safe_ratio(total_pts, 2 * (total_fga + 0.44 * total_fta))

    return {
        "player_id": "",
        "gp": total_gp,
        "pts": pts_pg,
        "reb": reb_pg,
        "ast": ast_pg,
        "stl": stl_pg,
        "blk": blk_pg,
        "stocks": stl_pg + blk_pg,
        "mpg": total_minutes / total_gp,
        "fgm": total_fgm / total_gp,
        "fga": total_fga / total_gp,
        "fg3m": total_fg3m / total_gp,
        "fg3a": total_fg3a / total_gp,
        "ftm": total_ftm / total_gp,
        "fta": total_fta / total_gp,
        "tov": total_tov / total_gp,
        "pf": total_pf / total_gp,
        "fg_pct": _safe_ratio(total_fgm, total_fga),
        "fg3_pct": _safe_ratio(total_fg3m, total_fg3a),
        "ft_pct": _safe_ratio(total_ftm, total_fta),
        "per": weighted_optional(6),
        "ts_pct": ts_pct,
        "three_par": _safe_ratio(total_fg3a, total_fga),
        "ftr": _safe_ratio(total_fta, total_fga),
        "orb_pct": weighted_optional(10),
        "drb_pct": weighted_optional(11),
        "trb_pct": weighted_optional(12),
        "ast_pct": weighted_optional(13),
        "stl_pct": weighted_optional(14),
        "blk_pct": weighted_optional(15),
        "tov_pct": weighted_optional(16),
        "usg_pct": weighted_optional(17),
        "ows": weighted_optional(18),
        "dws": weighted_optional(19),
        "ws": weighted_optional(20),
        "ws48": weighted_optional(21),
        "obpm": weighted_optional(22),
        "dbpm": weighted_optional(23),
        "bpm": weighted_optional(24),
        "vorp": weighted_optional(25),
    }


def _fetch_seeded_stats(
    player_id: str,
    team_id: Optional[str] = None,
    game_mode: str = "all_time",
) -> Optional[dict]:
    """DB-first stats lookup from seeded player_season_stats."""
    min_gp = 5 if game_mode == "active_only" else 20
    season_filter = CURRENT_SEASON if game_mode == "active_only" else None

    rows = _query_seeded_stats_rows(player_id, team_id, season_filter)
    if not rows:
        logger.info(
            "seeded stats miss: no rows for player=%s team=%s mode=%s",
            player_id,
            team_id,
            game_mode,
        )
        return None

    aggregated = _aggregate_seeded_stats(rows, min_gp)
    if aggregated is None:
        logger.info(
            "seeded stats miss: rows below gp threshold for player=%s team=%s mode=%s min_gp=%d",
            player_id,
            team_id,
            game_mode,
            min_gp,
        )
    return aggregated




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

                def weighted_pg(col: str) -> float:
                    if col not in df.columns:
                        return 0.0
                    return float((df[col].fillna(0) * df["GP"]).sum() / total_gp)

                pts_pg = weighted_pg("PTS")
                reb_pg = weighted_pg("REB")
                ast_pg = weighted_pg("AST")
                stl_pg = weighted_pg("STL")
                blk_pg = weighted_pg("BLK")
                fgm_pg = weighted_pg("FGM")
                fga_pg = weighted_pg("FGA")
                fg3m_pg = weighted_pg("FG3M")
                fg3a_pg = weighted_pg("FG3A")
                ftm_pg = weighted_pg("FTM")
                fta_pg = weighted_pg("FTA")
                tov_pg = weighted_pg("TOV")
                pf_pg = weighted_pg("PF")

                total_pts = pts_pg * total_gp
                total_fga = fga_pg * total_gp
                total_fta = fta_pg * total_gp
                logger.info("nba_api: player_id=%s → total_gp=%d", player_id, total_gp)
                return {
                    "player_id": player_id,
                    "gp": int(total_gp),
                    "pts": pts_pg,
                    "reb": reb_pg,
                    "ast": ast_pg,
                    "stl": stl_pg,
                    "blk": blk_pg,
                    "stocks": stl_pg + blk_pg,
                    "mpg": weighted_pg("MIN"),
                    "fgm": fgm_pg,
                    "fga": fga_pg,
                    "fg3m": fg3m_pg,
                    "fg3a": fg3a_pg,
                    "ftm": ftm_pg,
                    "fta": fta_pg,
                    "tov": tov_pg,
                    "pf": pf_pg,
                    "fg_pct": _safe_ratio(fgm_pg, fga_pg),
                    "fg3_pct": _safe_ratio(fg3m_pg, fg3a_pg),
                    "ft_pct": _safe_ratio(ftm_pg, fta_pg),
                    "ts_pct": _safe_ratio(total_pts, 2 * (total_fga + 0.44 * total_fta)),
                    "three_par": _safe_ratio(fg3a_pg, fga_pg),
                    "ftr": _safe_ratio(fta_pg, fga_pg),
                }
            logger.info("nba_api: player_id=%s no matching dataframe found", player_id)
            return None
        except Exception as exc:
            logger.warning("nba_api attempt %d failed for player_id=%s: %s", attempt, player_id, exc)
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
    return None


# In-memory cache only. Seeded DB is the persistent source of truth.
_stats_cache: dict = {}


def _get_player_stats(
    player_id: str,
    team_id: Optional[str] = None,
    player_name: Optional[str] = None,
    game_mode: str = "all_time",
) -> Optional[dict]:
    """
    Fetch per-game stats with DB as primary and live fetch fallback.

    active_only: seeded 2025-26 rows from DB → BR season scrape → nba_api fallback.
    all_time:    seeded career rows scoped to team from DB → BR scrape via DB seasons → nba_api fallback.
    """
    key = f"{player_id}:{team_id}:{game_mode}"
    if key in _stats_cache:
        logger.info("stats cache hit: %s", key)
        return _stats_cache[key]

    result: Optional[dict] = _fetch_seeded_stats(player_id, team_id, game_mode)

    if result is None:
        if game_mode == "active_only":
            seasons = _get_player_team_seasons(player_id, team_id) if player_id and team_id else []
            if player_name and seasons:
                result = _fetch_br_seasons(player_name, seasons, min_gp=5)
            if result is None:
                result = _fetch_nba_api_stats(player_id, team_id, season_filter=CURRENT_SEASON)
        else:  # all_time
            seasons = _get_player_team_seasons(player_id, team_id) if player_id and team_id else []
            if player_name and seasons:
                result = _fetch_br_seasons(player_name, seasons, min_gp=20)
            if result is None:
                result = _fetch_nba_api_stats(player_id, team_id)

    if result is not None:
        result["player_id"] = player_id
        _stats_cache[key] = result

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
    DB seeded stats are primary.
    - game_mode=active_only: 2025-26 season only
    - game_mode=all_time: career stats scoped to team_id tenure
    Pass player_name (display form OK, e.g. 'Stephen Curry (GSW)') to enable BR fallback path.
    """
    result = _get_player_stats(player_id, team_id, player_name, game_mode)
    if result is None:
        raise HTTPException(status_code=404, detail="Player stats not found")
    return result


@app.get("/health")
def health():
    return {"status": "ok"}
