import { NextResponse } from "next/server";
import { fetchPlayerStats } from "@/lib/nba-api";
import type { Roster } from "@/lib/game-types";
import type { PlayerStats } from "@/lib/nba-api";
import { POSITIONS } from "@/lib/game-types";

type Body = { roster1: Roster; roster2: Roster; gameMode?: string };

function powerScore(pts: number, reb: number, ast: number, stl: number, blk: number): number {
  return pts + reb * 1.2 + ast * 1.5 + stl * 3 + blk * 3;
}

const POSITION_GROUP: Record<string, number> = { PG: 0, SG: 0, SF: 1, PF: 2, C: 2 };

function positionMismatchMultiplier(natural: string | null, assigned: string): number {
  if (!natural) return 1.0;
  const diff = Math.abs((POSITION_GROUP[natural] ?? 1) - (POSITION_GROUP[assigned] ?? 1));
  return diff === 0 ? 1.0 : diff === 1 ? 0.85 : 0.70;
}

function buildStatsMap(roster: Roster, stats: (PlayerStats | null)[]): Record<string, PlayerStats | null> {
  const map: Record<string, PlayerStats | null> = {};
  POSITIONS.forEach((p, i) => {
    const playerId = roster[p].playerId;
    if (playerId) map[playerId] = stats[i];
  });
  return map;
}

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
        POSITIONS.map((p) => {
          const slot = roster[p];
          return slot.playerId
            ? fetchPlayerStats(slot.playerId, slot.teamId, slot.playerName, gameMode).catch(() => null)
            : Promise.resolve(null);
        })
      );

    const [stats1, stats2] = await Promise.all([fetchAll(roster1), fetchAll(roster2)]);

    let team1Score = 0;
    let team2Score = 0;
    stats1.forEach((s, i) => {
      if (s) {
        const slot = roster1[POSITIONS[i]];
        team1Score += powerScore(s.pts, s.reb, s.ast, s.stl, s.blk) * positionMismatchMultiplier(slot.naturalPosition, POSITIONS[i]);
      }
    });
    stats2.forEach((s, i) => {
      if (s) {
        const slot = roster2[POSITIONS[i]];
        team2Score += powerScore(s.pts, s.reb, s.ast, s.stl, s.blk) * positionMismatchMultiplier(slot.naturalPosition, POSITIONS[i]);
      }
    });

    const winner: 1 | 2 | null =
      team1Score > team2Score ? 1 : team2Score > team1Score ? 2 : null;

    return NextResponse.json({
      winner,
      team1Score: Math.round(team1Score * 10) / 10,
      team2Score: Math.round(team2Score * 10) / 10,
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
