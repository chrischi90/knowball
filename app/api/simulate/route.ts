import { NextResponse } from "next/server";
import { fetchPlayerStats } from "@/lib/nba-api";
import type { Roster } from "@/lib/game-types";
import { POSITIONS } from "@/lib/game-types";

type Body = { roster1: Roster; roster2: Roster };

function getPlayerIds(roster: Roster): string[] {
  return POSITIONS.map((p) => roster[p].playerId).filter(
    (id): id is string => id != null
  );
}

function powerScore(pts: number, reb: number, ast: number, stl: number, blk: number): number {
  return pts + reb * 1.2 + ast * 1.5 + stl * 3 + blk * 3;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const { roster1, roster2 } = body;
    if (!roster1 || !roster2) {
      return NextResponse.json(
        { error: "rosters required" },
        { status: 400 }
      );
    }

    const ids1 = getPlayerIds(roster1);
    const ids2 = getPlayerIds(roster2);
    if (ids1.length !== 5 || ids2.length !== 5) {
      return NextResponse.json(
        { error: "Each roster must have 5 players" },
        { status: 400 }
      );
    }

    const fetchAll = async (ids: string[]) => {
      const results = await Promise.all(
        ids.map((id) => fetchPlayerStats(id).catch(() => null))
      );
      return results;
    };

    const [stats1, stats2] = await Promise.all([
      fetchAll(ids1),
      fetchAll(ids2),
    ]);

    let team1Score = 0;
    let team2Score = 0;

    stats1.forEach((s) => {
      if (s) team1Score += powerScore(s.pts, s.reb, s.ast, s.stl, s.blk);
    });
    stats2.forEach((s) => {
      if (s) team2Score += powerScore(s.pts, s.reb, s.ast, s.stl, s.blk);
    });

    const winner: 1 | 2 | null =
      team1Score > team2Score ? 1 : team2Score > team1Score ? 2 : null;

    return NextResponse.json({
      winner,
      team1Score: Math.round(team1Score * 10) / 10,
      team2Score: Math.round(team2Score * 10) / 10,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Simulation failed" },
      { status: 500 }
    );
  }
}
