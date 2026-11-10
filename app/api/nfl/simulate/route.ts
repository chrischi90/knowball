/**
 * 2-player head-to-head: ~2,000 quick sims for the pre-game win probability, then one real
 * game (seeded, replayable) with key moments.
 */
import { NextResponse } from "next/server";
import { parseNflGameMode } from "@/lib/nfl-api";
import { NFL_PLAYER_SLOTS, type NflRoster } from "@/lib/nfl-types";
import { estimateMatchup, randomSeed, simulateGame } from "@/lib/nfl-sim";
import { RosterError, loadTeamProfile, summarizeProfile, validateRosterShape } from "../_sim";

type Body = { roster1: NflRoster; roster2: NflRoster; gameMode?: string; names?: [string, string] };

let active = 0;
const MAX_CONCURRENT = 20;
const WIN_PROBABILITY_SIMS = 2000;

export async function POST(req: Request) {
  if (active >= MAX_CONCURRENT) {
    return NextResponse.json({ error: "Server busy, please try again shortly" }, { status: 503 });
  }
  active++;
  try {
    const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    const gameMode = parseNflGameMode(body.gameMode);
    if (!gameMode) return NextResponse.json({ error: "Invalid gameMode" }, { status: 400 });
    const rosters = [body.roster1, body.roster2];
    for (let i = 0; i < rosters.length; i++) {
      const err = validateRosterShape(rosters[i]);
      if (err) return NextResponse.json({ error: `Player ${i + 1}: ${err}` }, { status: 400 });
    }
    const { roster1, roster2 } = body;
    if (roster1.TEAM_DEF.teamId === roster2.TEAM_DEF.teamId) {
      return NextResponse.json({ error: "Both players can't lock the same team's defense" }, { status: 400 });
    }
    const ids1 = new Set(NFL_PLAYER_SLOTS.map((s) => roster1[s].playerId));
    if (NFL_PLAYER_SLOTS.some((s) => ids1.has(roster2[s].playerId))) {
      return NextResponse.json({ error: "A player can't be on both rosters" }, { status: 400 });
    }

    const [name1, name2] = body.names ?? ["Player 1", "Player 2"];
    const [t1, t2] = await Promise.all([
      loadTeamProfile(roster1, gameMode, String(name1).slice(0, 40), { requestId }),
      loadTeamProfile(roster2, gameMode, String(name2).slice(0, 40), { requestId }),
    ]);

    const seed = randomSeed();
    const odds = estimateMatchup(t1.profile, t2.profile, { seed, sims: WIN_PROBABILITY_SIMS });
    const game = simulateGame(t1.profile, t2.profile, { seed });

    return NextResponse.json({
      seed,
      winner: game.winner,
      team1Score: game.team1Score,
      team2Score: game.team2Score,
      overtime: game.overtime,
      team1WinProbability: odds.team1WinPct,
      team2WinProbability: odds.team2WinPct,
      tieProbability: odds.tiePct,
      expectedScore: [odds.avgTeam1Score, odds.avgTeam2Score],
      keyMoments: game.keyMoments,
      drives: game.drives.map(({ quarter, offense, outcome, score, text }) => ({ quarter, offense, outcome, score, text })),
      teamStats: game.teamStats,
      boxScore: game.boxScore,
      team1: summarizeProfile(t1.profile),
      team2: summarizeProfile(t2.profile),
    });
  } catch (e) {
    if (e instanceof RosterError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Simulation failed" }, { status: 502 });
  } finally {
    active--;
  }
}
