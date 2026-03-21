import { NextResponse } from "next/server";
import { fetchPlayerStats } from "@/lib/nba-api";
import type { Roster } from "@/lib/game-types";
import { POSITIONS } from "@/lib/game-types";
import {
  buildStatsMap,
  computeTeamProfile,
  resolveRosterStats,
  simulateHeadToHeadGame,
} from "@/lib/simulation-engine";

type Body = { roster1: Roster; roster2: Roster; gameMode?: string };

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const { roster1, roster2, gameMode } = body;
    if (!roster1 || !roster2) {
      return NextResponse.json(
        { error: "rosters required" },
        { status: 400 }
      );
    }

    const count1 = POSITIONS.filter((p) => roster1[p].playerId).length;
    const count2 = POSITIONS.filter((p) => roster2[p].playerId).length;
    if (count1 !== 5 || count2 !== 5) {
      return NextResponse.json(
        { error: "Each roster must have 5 players" },
        { status: 400 }
      );
    }

    const fetchAll = async (roster: Roster) =>
      Promise.all(
        POSITIONS.map(async (p) => {
          const slot = roster[p];
          if (!slot.playerId) return null;

          const teamScoped = await fetchPlayerStats(
            slot.playerId,
            slot.teamId,
            slot.playerName,
            gameMode
          ).catch(() => null);
          if (teamScoped) return teamScoped;

          return fetchPlayerStats(slot.playerId, null, slot.playerName, gameMode).catch(() => null);
        })
      );

    const [rawStats1, rawStats2] = await Promise.all([fetchAll(roster1), fetchAll(roster2)]);
    const stats1 = resolveRosterStats(roster1, rawStats1);
    const stats2 = resolveRosterStats(roster2, rawStats2);
    const team1Profile = computeTeamProfile(roster1, stats1);
    const team2Profile = computeTeamProfile(roster2, stats2);
    const gameResult = simulateHeadToHeadGame(team1Profile.teamRating, team2Profile.teamRating);

    return NextResponse.json({
      winner: gameResult.winner,
      team1Score: gameResult.team1Score,
      team2Score: gameResult.team2Score,
      team1WinProbability: gameResult.team1WinProbability,
      team2WinProbability: gameResult.team2WinProbability,
      team1Rating: team1Profile.teamRating,
      team2Rating: team2Profile.teamRating,
      team1Diagnostics: team1Profile.diagnostics,
      team2Diagnostics: team2Profile.diagnostics,
      playerStats1: buildStatsMap(roster1, stats1),
      playerStats2: buildStatsMap(roster2, stats2),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Simulation failed" },
      { status: 500 }
    );
  }
}
