#!/usr/bin/env python3
"""
Backtest Knowball matchup simulation against real 2024-25 NBA games.

What this does:
- Pulls real regular-season games from nba_api.
- Builds 5-man starter rosters from each game's box score.
- Calls local /api/simulate with those rosters in active_only mode.
- Compares model win probability against actual winners.

Usage:
  /Users/chrischi/apps/knowball/.venv/bin/python scripts/backtest_matchups.py \
    --season 2024-25 --sample-size 40 --api-base http://localhost:3000
"""

from __future__ import annotations

import argparse
import json
import random
import statistics
import sys
import time
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from nba_api.stats.endpoints import boxscoretraditionalv2, leaguegamefinder, playercareerstats


POSITIONS = ["PG", "SG", "SF", "PF", "C"]


@dataclass
class Starter:
  player_id: str
  player_name: str
  team_id: str
  start_position: str
  pts: float
  reb: float
  ast: float


@dataclass
class GameRecord:
  game_id: str
  game_date: str
  team1_id: str
  team1_pts: float
  team2_id: str
  team2_pts: float


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(description="Backtest simulation with real 2024-25 matchups")
  parser.add_argument("--season", default="2024-25", help="NBA season string, e.g. 2024-25")
  parser.add_argument("--sample-size", type=int, default=30, help="Number of games to evaluate")
  parser.add_argument("--seed", type=int, default=7, help="Random seed for reproducible sampling")
  parser.add_argument("--api-base", default="http://localhost:3000", help="Knowball app base URL")
  parser.add_argument("--sleep-ms", type=int, default=250, help="Delay between game fetches to be polite")
  parser.add_argument("--max-games-scan", type=int, default=500, help="Max historical games to scan before stopping")
  return parser.parse_args()


def http_post_json(url: str, payload: dict) -> dict:
  body = json.dumps(payload).encode("utf-8")
  req = Request(
    url,
    data=body,
    headers={"Content-Type": "application/json"},
    method="POST",
  )
  try:
    with urlopen(req, timeout=30) as resp:
      return json.loads(resp.read().decode("utf-8"))
  except HTTPError as exc:
    text = exc.read().decode("utf-8", errors="ignore")
    raise RuntimeError(f"HTTP {exc.code} calling {url}: {text[:400]}")
  except URLError as exc:
    raise RuntimeError(f"Network error calling {url}: {exc}")


def fetch_games(season: str) -> List[GameRecord]:
  gf = leaguegamefinder.LeagueGameFinder(
    season_nullable=season,
    season_type_nullable="Regular Season",
    player_or_team_abbreviation="T",
  )
  df = gf.get_data_frames()[0]

  # Keep one row per game (leaguegamefinder returns one row per team).
  seen = set()
  games: List[GameRecord] = []

  # Sort by date ascending for stable sampling.
  df = df.sort_values(["GAME_DATE", "GAME_ID", "TEAM_ID"]).reset_index(drop=True)

  grouped = df.groupby("GAME_ID")
  for game_id, g in grouped:
    if len(g) < 2:
      continue
    rows = g.iloc[:2]
    r1 = rows.iloc[0]
    r2 = rows.iloc[1]

    # Ensure team ordering is stable by TEAM_ID to avoid accidental label drift.
    if int(r1["TEAM_ID"]) <= int(r2["TEAM_ID"]):
      t1, t2 = r1, r2
    else:
      t1, t2 = r2, r1

    if game_id in seen:
      continue
    seen.add(game_id)
    games.append(
      GameRecord(
        game_id=str(game_id),
        game_date=str(t1["GAME_DATE"]),
        team1_id=str(int(t1["TEAM_ID"])),
        team1_pts=float(t1["PTS"]),
        team2_id=str(int(t2["TEAM_ID"])),
        team2_pts=float(t2["PTS"]),
      )
    )

  return games


def build_starters_for_team(player_rows, team_id: str) -> Optional[List[Starter]]:
  team_rows = player_rows[player_rows["TEAM_ID"] == int(team_id)]
  starters = team_rows[team_rows["START_POSITION"].fillna("") != ""]
  if len(starters) < 5:
    return None

  # Use first 5 starters if data has edge-case duplicates.
  starters = starters.iloc[:5]

  result = []
  for _, row in starters.iterrows():
    result.append(
      Starter(
        player_id=str(int(row["PLAYER_ID"])),
        player_name=str(row["PLAYER_NAME"]),
        team_id=team_id,
        start_position=str(row["START_POSITION"] or ""),
        pts=float(row["PTS"]),
        reb=float(row["REB"]),
        ast=float(row["AST"]),
      )
    )
  return result


def starters_to_roster(starters: List[Starter]) -> Optional[Dict[str, Dict[str, Optional[str]]]]:
  if len(starters) != 5:
    return None

  guards = [s for s in starters if s.start_position == "G"]
  forwards = [s for s in starters if s.start_position == "F"]
  centers = [s for s in starters if s.start_position == "C"]
  unknowns = [s for s in starters if s.start_position not in {"G", "F", "C"}]

  # Fill missing buckets from unknown starters when needed.
  pool = list(unknowns)
  while len(guards) < 2 and pool:
    guards.append(pool.pop(0))
  while len(forwards) < 2 and pool:
    forwards.append(pool.pop(0))
  while len(centers) < 1 and pool:
    centers.append(pool.pop(0))

  # Still incomplete, fallback by heuristic splits.
  if len(guards) < 2 or len(forwards) < 2 or len(centers) < 1:
    ordered = sorted(starters, key=lambda s: (-(s.ast), -(s.reb)))
    guards = ordered[:2]
    forwards = ordered[2:4]
    centers = [ordered[4]]

  guards = sorted(guards, key=lambda s: -s.ast)[:2]
  forwards = sorted(forwards, key=lambda s: -s.reb)[:2]
  center = sorted(centers, key=lambda s: -s.reb)[:1]

  if len(guards) != 2 or len(forwards) != 2 or len(center) != 1:
    return None

  pg, sg = guards[0], guards[1]
  pf, sf = forwards[0], forwards[1]
  c = center[0]

  roster = {
    "PG": {
      "position": "PG",
      "playerId": pg.player_id,
      "playerName": pg.player_name,
      "teamId": pg.team_id,
      "naturalPosition": "PG",
    },
    "SG": {
      "position": "SG",
      "playerId": sg.player_id,
      "playerName": sg.player_name,
      "teamId": sg.team_id,
      "naturalPosition": "SG",
    },
    "SF": {
      "position": "SF",
      "playerId": sf.player_id,
      "playerName": sf.player_name,
      "teamId": sf.team_id,
      "naturalPosition": "SF",
    },
    "PF": {
      "position": "PF",
      "playerId": pf.player_id,
      "playerName": pf.player_name,
      "teamId": pf.team_id,
      "naturalPosition": "PF",
    },
    "C": {
      "position": "C",
      "playerId": c.player_id,
      "playerName": c.player_name,
      "teamId": c.team_id,
      "naturalPosition": "C",
    },
  }
  return roster


def get_player_season_stats(
  player_id: str,
  team_id: str,
  season: str,
  cache: Dict[Tuple[str, str, str], Optional[dict]],
) -> Optional[dict]:
  key = (player_id, team_id, season)
  if key in cache:
    return cache[key]

  try:
    pcs = playercareerstats.PlayerCareerStats(player_id=player_id)
    df = pcs.season_totals_regular_season.get_data_frame()
  except Exception:
    cache[key] = None
    return None

  if df is None or df.empty:
    cache[key] = None
    return None

  season_rows = df[df["SEASON_ID"] == season]
  if season_rows.empty:
    cache[key] = None
    return None

  # Prefer exact team row for this game; fallback to TOT row if traded.
  team_rows = season_rows[season_rows["TEAM_ID"] == int(team_id)]
  if not team_rows.empty:
    row = team_rows.iloc[0]
  else:
    tot_rows = season_rows[season_rows["TEAM_ABBREVIATION"] == "TOT"]
    row = tot_rows.iloc[0] if not tot_rows.empty else season_rows.iloc[0]

  gp = float(row.get("GP", 0) or 0)
  if gp <= 0:
    cache[key] = None
    return None

  stats = {
    "player_id": player_id,
    "gp": gp,
    "pts": float(row.get("PTS", 0) or 0) / gp,
    "reb": float(row.get("REB", 0) or 0) / gp,
    "ast": float(row.get("AST", 0) or 0) / gp,
    "stl": float(row.get("STL", 0) or 0) / gp,
    "blk": float(row.get("BLK", 0) or 0) / gp,
    "fgm": float(row.get("FGM", 0) or 0) / gp,
    "fga": float(row.get("FGA", 0) or 0) / gp,
    "fg3m": float(row.get("FG3M", 0) or 0) / gp,
    "fg3a": float(row.get("FG3A", 0) or 0) / gp,
    "ftm": float(row.get("FTM", 0) or 0) / gp,
    "fta": float(row.get("FTA", 0) or 0) / gp,
    "tov": float(row.get("TOV", 0) or 0) / gp,
    "pf": float(row.get("PF", 0) or 0) / gp,
    "fg_pct": float(row.get("FG_PCT", 0) or 0),
    "fg3_pct": float(row.get("FG3_PCT", 0) or 0),
    "ft_pct": float(row.get("FT_PCT", 0) or 0),
  }
  cache[key] = stats
  return stats


def roster_to_provided_stats(
  roster: Dict[str, Dict[str, Optional[str]]],
  season: str,
  cache: Dict[Tuple[str, str, str], Optional[dict]],
) -> Optional[List[Optional[dict]]]:
  provided: List[Optional[dict]] = []
  for pos in POSITIONS:
    slot = roster[pos]
    player_id = slot.get("playerId")
    team_id = slot.get("teamId")
    if not player_id or not team_id:
      return None
    stats = get_player_season_stats(player_id, team_id, season, cache)
    provided.append(stats)

  if all(s is None for s in provided):
    return None
  return provided


def evaluate(args: argparse.Namespace) -> int:
  random.seed(args.seed)

  print(f"Loading regular-season games for {args.season}...")
  games = fetch_games(args.season)
  if not games:
    print("No games found.")
    return 1

  random.shuffle(games)
  games = games[: args.max_games_scan]

  simulate_url = f"{args.api_base.rstrip('/')}/api/simulate"
  results = []
  scanned = 0
  season_stats_cache: Dict[Tuple[str, str, str], Optional[dict]] = {}

  for g in games:
    if len(results) >= args.sample_size:
      break

    scanned += 1
    try:
      bs = boxscoretraditionalv2.BoxScoreTraditionalV2(game_id=g.game_id)
      players = bs.player_stats.get_data_frame()
    except Exception as exc:
      print(f"skip {g.game_id}: boxscore fetch failed ({exc})")
      continue

    starters1 = build_starters_for_team(players, g.team1_id)
    starters2 = build_starters_for_team(players, g.team2_id)
    if not starters1 or not starters2:
      print(f"skip {g.game_id}: missing starter data")
      continue

    roster1 = starters_to_roster(starters1)
    roster2 = starters_to_roster(starters2)
    if not roster1 or not roster2:
      print(f"skip {g.game_id}: could not infer positions")
      continue

    provided_stats1 = roster_to_provided_stats(roster1, args.season, season_stats_cache)
    provided_stats2 = roster_to_provided_stats(roster2, args.season, season_stats_cache)
    if not provided_stats1 or not provided_stats2:
      print(f"skip {g.game_id}: missing season stats for starters")
      continue

    payload = {
      "roster1": roster1,
      "roster2": roster2,
      "gameMode": "active_only",
      "providedStats1": provided_stats1,
      "providedStats2": provided_stats2,
    }

    try:
      sim = http_post_json(simulate_url, payload)
    except Exception as exc:
      print(f"fatal: simulate API failed for {g.game_id}: {exc}")
      return 1

    if "error" in sim:
      print(f"skip {g.game_id}: simulate error {sim['error']}")
      continue

    p = float(sim.get("team1BlendedWinProbability", sim.get("team1WinProbability", 0.5)))
    y = 1.0 if g.team1_pts > g.team2_pts else 0.0
    pred_winner = 1 if p >= 0.5 else 2
    actual_winner = 1 if y == 1.0 else 2

    results.append(
      {
        "game_id": g.game_id,
        "date": g.game_date,
        "team1_id": g.team1_id,
        "team2_id": g.team2_id,
        "actual_score": f"{int(g.team1_pts)}-{int(g.team2_pts)}",
        "pred_prob_team1": p,
        "pred_winner": pred_winner,
        "actual_winner": actual_winner,
        "correct": pred_winner == actual_winner,
        "brier": (p - y) ** 2,
      }
    )

    time.sleep(max(0, args.sleep_ms) / 1000.0)

  if not results:
    print("No valid matchups evaluated. Try increasing --max-games-scan.")
    return 1

  accuracy = sum(1 for r in results if r["correct"]) / len(results)
  brier = statistics.mean(r["brier"] for r in results)

  print("\n=== Backtest Summary ===")
  print(f"Season: {args.season}")
  print(f"Requested sample size: {args.sample_size}")
  print(f"Scanned games: {scanned}")
  print(f"Evaluated games: {len(results)}")
  print(f"Winner accuracy: {accuracy * 100:.1f}%")
  print(f"Brier score: {brier:.4f} (lower is better)")

  # Simple confidence buckets.
  buckets = {
    "50-55": [],
    "55-60": [],
    "60-65": [],
    "65-70": [],
    "70+": [],
  }
  for r in results:
    conf = max(r["pred_prob_team1"], 1 - r["pred_prob_team1"]) * 100
    if conf < 55:
      buckets["50-55"].append(r)
    elif conf < 60:
      buckets["55-60"].append(r)
    elif conf < 65:
      buckets["60-65"].append(r)
    elif conf < 70:
      buckets["65-70"].append(r)
    else:
      buckets["70+"].append(r)

  print("\n=== Confidence Buckets ===")
  for label, rows in buckets.items():
    if not rows:
      print(f"{label}%: n=0")
      continue
    acc = sum(1 for r in rows if r["correct"]) / len(rows)
    print(f"{label}%: n={len(rows)} | accuracy={acc * 100:.1f}%")

  print("\n=== Sample Rows (first 12) ===")
  for r in results[:12]:
    print(
      f"{r['date']} {r['game_id']} score={r['actual_score']} "
      f"p(team1)={r['pred_prob_team1']:.3f} pred={r['pred_winner']} "
      f"actual={r['actual_winner']} {'OK' if r['correct'] else 'MISS'}"
    )

  return 0


def main() -> int:
  args = parse_args()
  return evaluate(args)


if __name__ == "__main__":
  sys.exit(main())
