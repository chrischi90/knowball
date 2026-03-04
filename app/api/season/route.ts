import { NextResponse } from "next/server";
import { fetchPlayerStats } from "@/lib/nba-api";
import type { Roster } from "@/lib/game-types";
import { POSITIONS } from "@/lib/game-types";

type Body = { roster: Roster };

// Same formula as /api/simulate
function powerScore(pts: number, reb: number, ast: number, stl: number, blk: number): number {
  return pts + reb * 1.2 + ast * 1.5 + stl * 3 + blk * 3;
}

// Simulate a best-of-7 series. Returns { wins, losses } for the user's team.
function simulateSeries(pWin: number): { wins: number; losses: number } {
  let wins = 0;
  let losses = 0;
  while (wins < 4 && losses < 4) {
    if (Math.random() < pWin) wins++;
    else losses++;
  }
  return { wins, losses };
}

const ROUND_NAMES = ["First Round", "Conference Semifinals", "Conference Finals", "NBA Finals"];
// Each later playoff round faces a tougher opponent — reduce win probability
const ROUND_MULTIPLIERS = [1.0, 0.93, 0.87, 0.82];

// A solid average NBA team across all eras (tuned so ~130 power ≈ .500 team)
const BASELINE_POWER = 130;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const { roster } = body;
    if (!roster) {
      return NextResponse.json({ error: "roster required" }, { status: 400 });
    }

    const playerIds = POSITIONS.map((p) => roster[p].playerId).filter(
      (id): id is string => id != null
    );
    if (playerIds.length !== 5) {
      return NextResponse.json({ error: "Roster must have 5 players" }, { status: 400 });
    }

    // Fetch stats for all 5 players in parallel
    const statsResults = await Promise.all(
      playerIds.map((id) => fetchPlayerStats(id).catch(() => null))
    );

    let teamPower = 0;
    statsResults.forEach((s) => {
      if (s) teamPower += powerScore(s.pts, s.reb, s.ast, s.stl, s.blk);
    });

    // Win probability per game, clamped to [0.05, 0.98]
    const pWin = Math.min(0.98, Math.max(0.05, 0.5 + (teamPower - BASELINE_POWER) / 380));

    // Simulate 82-game regular season
    let wins = 0;
    for (let i = 0; i < 82; i++) {
      if (Math.random() < pWin) wins++;
    }
    const losses = 82 - wins;

    // Playoffs: qualify with ≥ 41 wins
    const madePlayoffs = wins >= 41;
    const rounds: { name: string; wins: number; losses: number }[] = [];
    let playoffResult: string | null = null;

    if (madePlayoffs) {
      let eliminated = false;
      for (let r = 0; r < 4; r++) {
        const roundPWin = Math.min(0.98, Math.max(0.05, pWin * ROUND_MULTIPLIERS[r]));
        const series = simulateSeries(roundPWin);
        rounds.push({ name: ROUND_NAMES[r], wins: series.wins, losses: series.losses });

        if (series.losses === 4) {
          // Eliminated this round
          const exitNames = [
            "First Round Exit",
            "Conference Semifinals",
            "Conference Finals",
            "NBA Finals",
          ];
          playoffResult = exitNames[r];
          eliminated = true;
          break;
        }
      }
      if (!eliminated) {
        playoffResult = "Champion";
      }
    }

    // Build milestone callouts
    const milestones: string[] = [];
    if (wins >= 78) milestones.push("Could go undefeated territory!");
    else if (wins >= 70) milestones.push("Historic season!");
    else if (wins >= 60) milestones.push("Dynasty-level team!");
    if (playoffResult === "Champion") milestones.push("NBA Champion!");
    else if (playoffResult === "NBA Finals") milestones.push("Made the Finals");
    else if (!madePlayoffs) milestones.push("Missed the Playoffs");

    return NextResponse.json({
      wins,
      losses,
      teamPower: Math.round(teamPower * 10) / 10,
      madePlayoffs,
      playoffResult,
      rounds,
      milestones,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Season simulation failed" },
      { status: 500 }
    );
  }
}
