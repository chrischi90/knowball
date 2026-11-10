"""
Dev tool: export every real team-season (1999 → last completed) as an NFL-sim roster for the
backtest (scripts/backtest_nfl.ts). Each team gets its actual top players per slot plus that
season's team defense, in the same shape the /nfl API returns.

  python export_nfl_backtest.py [out.json]
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict

import psycopg2

from nfl_router import (
    NFL_ALL_TIME_START_SEASON, STAT_COLUMNS, league_per_game_from_rows, per_game_line,
    season_context, sum_rows, weighted_league_line,
)
from seed_nfl import database_url

DEF_POSITIONS = ("DE", "DT", "LB", "CB", "S", "DB")


def main(out_path: str) -> None:
    ctx = season_context()
    last = ctx["season"] if ctx["phase"] == "postseason" else ctx["season"] - 1
    conn = psycopg2.connect(database_url())
    conn.set_session(readonly=True)
    cur = conn.cursor()
    cols = ", ".join(f"s.{c}" for c in STAT_COLUMNS)
    cur.execute(
        f"SELECT s.player_id, p.player_name, s.team_id, s.season, s.position, {cols} "
        f"FROM nfl_player_season_stats s JOIN nfl_players p USING (player_id) WHERE s.season BETWEEN %s AND %s",
        (NFL_ALL_TIME_START_SEASON, last),
    )
    names = ["player_id", "name", "team_id", "season", "position", *STAT_COLUMNS]
    rows = [dict(zip(names, r)) for r in cur.fetchall()]

    groups = {"QB": ["QB"], "RB": ["RB"], "WR": ["WR"], "TE": ["TE"],
              "DE": ["DE", "DT"], "DT": ["DE", "DT"], "LB": ["LB"], "CB": ["CB", "S", "DB"],
              "S": ["CB", "S", "DB"], "DB": ["CB", "S", "DB"]}
    by_season_pos = defaultdict(list)
    for r in rows:
        by_season_pos[(r["season"], r["position"])].append(r)
    league_cache = {}

    def league(season: int, position: str) -> dict:
        key = (season, position)
        if key not in league_cache:
            pool = [r for p in groups[position] for r in by_season_pos[(season, p)]]
            line = league_per_game_from_rows(pool, position)
            league_cache[key] = per_game_line(weighted_league_line({season: line}, {season: 1.0}), position)
        return league_cache[key]

    def stats(r: dict) -> dict:
        total = sum_rows([r])
        return {"playerId": r["player_id"], "teamId": r["team_id"], "position": r["position"],
                "gp": r["gp"], "gs": 0, "seasons": [r["season"]], "statsTeamId": r["team_id"],
                **per_game_line(total, r["position"]), "league": league(r["season"], r["position"]),
                "source": "db"}

    by_team = defaultdict(list)
    for r in rows:
        by_team[(r["team_id"], r["season"])].append(r)

    cur.execute("""
        SELECT ts.team_id, ts.season, ts.team_name, ts.wins, ts.losses, ts.ties, ts.points_for,
               ts.points_against, ts.games, d.games, d.points_allowed, d.yards_allowed, d.pass_yds_allowed,
               d.rush_yds_allowed, d.interceptions + d.fumbles_recovered, d.sacks, d.plays_allowed
        FROM nfl_team_seasons ts JOIN nfl_team_defense_season_stats d USING (team_id, season)
        WHERE ts.season BETWEEN %s AND %s""", (NFL_ALL_TIME_START_SEASON, last))
    teams = cur.fetchall()
    league_def = defaultdict(lambda: defaultdict(float))
    for t in teams:
        L = league_def[t[1]]
        for k, v in zip(["games", "pa", "ya", "pya", "rya", "tk", "sk", "plays"], t[9:17]):
            L[k] += v or 0

    out = []
    for t in teams:
        team_id, season, team_name, w, l, ties, pf, pa, games = t[:9]
        dg, dpa, dya, dpya, drya, dtk, dsk, dplays = t[9:17]
        pool = by_team[(team_id, season)]
        top = lambda pos, key, n=1: sorted([r for r in pool if r["position"] == pos], key=lambda r: -(r[key] or 0))[:n]
        qb, rb, wrs, te = top("QB", "pass_att"), top("RB", "rush_att"), top("WR", "rec_yds", 3), top("TE", "rec_yds")
        defenders = sorted([r for r in pool if r["position"] in DEF_POSITIONS],
                           key=lambda r: -((r["def_sacks"] or 0) * 4 + r["def_int"] * 4 + (r["def_tackles"] or 0) * 0.25
                                           + (r["def_pass_defended"] or 0) + (r["def_forced_fumbles"] or 0) * 2))[:6]
        if not (qb and rb and len(wrs) == 3 and te and defenders):
            continue
        L = league_def[season]
        g = dg or 1
        out.append({
            "teamId": team_id, "season": season, "teamName": team_name,
            "wins": w, "losses": l, "ties": ties, "games": games,
            "pointsForPerGame": pf / games, "pointsAgainstPerGame": pa / games,
            "QB": {"name": qb[0]["name"], "stats": stats(qb[0])},
            "RB": {"name": rb[0]["name"], "stats": stats(rb[0])},
            "WR": [{"name": r["name"], "stats": stats(r)} for r in wrs],
            "TE": {"name": te[0]["name"], "stats": stats(te[0])},
            "defenders": [{"name": r["name"], "stats": stats(r)} for r in defenders],
            "TEAM_DEF": {
                "teamId": team_id, "season": season, "teamName": team_name, "games": dg,
                "pointsAllowed": dpa / g, "yardsAllowed": dya / g, "passYardsAllowed": dpya / g,
                "rushYardsAllowed": drya / g, "takeaways": dtk / g,
                "sacks": None if dsk is None else dsk / g, "playsAllowed": (dplays or 0) / g, "source": "db",
                "league": {"pointsAllowed": L["pa"] / L["games"], "yardsAllowed": L["ya"] / L["games"],
                           "passYardsAllowed": L["pya"] / L["games"], "rushYardsAllowed": L["rya"] / L["games"],
                           "takeaways": L["tk"] / L["games"], "sacks": L["sk"] / L["games"],
                           "playsAllowed": L["plays"] / L["games"]},
            },
        })
    conn.close()
    with open(out_path, "w") as f:
        json.dump(out, f)
    print(f"exported {len(out)} team-seasons ({NFL_ALL_TIME_START_SEASON}-{last}) → {out_path}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "nfl_backtest.json")
