import { NextResponse } from "next/server";
import { fetchPlayerStats } from "@/lib/nba-api";
import type { Roster } from "@/lib/game-types";
import type { PlayerStats } from "@/lib/nba-api";
import { POSITIONS } from "@/lib/game-types";

type Body = { roster: Roster; gameMode?: string };

const LEAGUE_AVERAGE_STATS: Omit<PlayerStats, "player_id"> = {
  gp: 82,
  pts: 15,
  reb: 5,
  ast: 3.5,
  stl: 1,
  blk: 0.7,
};

// Same formula as /api/simulate
function powerScore(pts: number, reb: number, ast: number, stl: number, blk: number): number {
  return pts + reb * 1.2 + ast * 1.5 + stl * 3 + blk * 3;
}

const POSITION_GROUP: Record<string, number> = { PG: 0, SG: 0, SF: 1, PF: 2, C: 2 };

function positionMismatchMultiplier(natural: string | null, assigned: string): number {
  if (!natural) return 1.0;
  const diff = Math.abs((POSITION_GROUP[natural] ?? 1) - (POSITION_GROUP[assigned] ?? 1));
  return diff === 0 ? 1.0 : diff === 1 ? 0.85 : 0.70;
}

function averageStats(stats: PlayerStats[]): Omit<PlayerStats, "player_id"> {
  if (stats.length === 0) return LEAGUE_AVERAGE_STATS;

  const sum = stats.reduce(
    (acc, s) => {
      acc.gp += s.gp;
      acc.pts += s.pts;
      acc.reb += s.reb;
      acc.ast += s.ast;
      acc.stl += s.stl;
      acc.blk += s.blk;
      return acc;
    },
    { gp: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0 }
  );

  return {
    gp: Math.round(sum.gp / stats.length),
    pts: sum.pts / stats.length,
    reb: sum.reb / stats.length,
    ast: sum.ast / stats.length,
    stl: sum.stl / stats.length,
    blk: sum.blk / stats.length,
  };
}

function resolveRosterStats(roster: Roster, rawStats: (PlayerStats | null)[]): PlayerStats[] {
  const available = rawStats.filter((s): s is PlayerStats => s !== null);
  const rosterAverage = averageStats(available);

  return POSITIONS.map((p, i) => {
    const existing = rawStats[i];
    if (existing) return existing;
    return {
      player_id: roster[p].playerId ?? "",
      ...rosterAverage,
    };
  });
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
    const { roster, gameMode } = body;
    if (!roster) {
      return NextResponse.json({ error: "roster required" }, { status: 400 });
    }

    if (POSITIONS.filter((p) => roster[p].playerId).length !== 5) {
      return NextResponse.json({ error: "Roster must have 5 players" }, { status: 400 });
    }

    // Fetch stats for all 5 players in parallel, scoped to their selected team
    const rawStatsResults = await Promise.all(
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

    const statsResults = resolveRosterStats(roster, rawStatsResults);

    // Compute per-player power scores for MVP and team stats
    const playerScores = statsResults.map((s, i) => {
      const slot = roster[POSITIONS[i]];
      const multiplier = positionMismatchMultiplier(slot.naturalPosition, POSITIONS[i]);
      return {
        playerName: slot.playerName ?? "",
        position: POSITIONS[i],
        pts: s.pts,
        reb: s.reb,
        ast: s.ast,
        stl: s.stl,
        blk: s.blk,
        score: powerScore(s.pts, s.reb, s.ast, s.stl, s.blk) * multiplier,
      };
    });

    let teamPower = 0;
    playerScores.forEach((p) => { teamPower += p.score; });

    // Win probability per game, clamped to [0.05, 0.98]
    const pWin = Math.min(0.98, Math.max(0.05, 0.5 + (teamPower - BASELINE_POWER) / 300));

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

    // MVP — player with highest individual power score
    const mvp = playerScores.reduce((best, p) => (p.score > best.score ? p : best), playerScores[0]);

    // Team-level badges based on average stats across all 5 players
    const avgPts = playerScores.reduce((sum, p) => sum + p.pts, 0) / 5;
    const avgReb = playerScores.reduce((sum, p) => sum + p.reb, 0) / 5;
    const avgAst = playerScores.reduce((sum, p) => sum + p.ast, 0) / 5;
    const avgDef = playerScores.reduce((sum, p) => sum + p.stl + p.blk, 0) / 5;

    const allBadgeCandidates: { badge: string; priority: number }[] = [];
    if (teamPower >= 180) allBadgeCandidates.push({ badge: "Superteam Alert", priority: 10 });
    if (avgPts >= 22) allBadgeCandidates.push({ badge: "High-Powered Offense", priority: 8 });
    else if (avgPts >= 18) allBadgeCandidates.push({ badge: "Reliable Scoring", priority: 4 });
    else allBadgeCandidates.push({ badge: "Developing Offense", priority: 2 });
    if (avgReb >= 8) allBadgeCandidates.push({ badge: "Glass Eaters", priority: 7 });
    else allBadgeCandidates.push({ badge: "On the Glass", priority: 1 });
    if (avgAst >= 6) allBadgeCandidates.push({ badge: "Playmaking Factory", priority: 6 });
    if (avgDef >= 3) allBadgeCandidates.push({ badge: "Lockdown Defense", priority: 9 });
    else if (avgDef >= 1.8) allBadgeCandidates.push({ badge: "Defensive Presence", priority: 3 });
    else allBadgeCandidates.push({ badge: "Defensive Effort", priority: 0 });
    if (avgPts >= 15 && avgReb >= 5 && avgAst >= 4) allBadgeCandidates.push({ badge: "Complete Package", priority: 5 });

    const badges = allBadgeCandidates
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 3)
      .map((b) => b.badge);

    return NextResponse.json({
      wins,
      losses,
      teamPower: Math.round(teamPower * 10) / 10,
      playerScores: playerScores.map((p) => ({
        playerName: p.playerName,
        position: p.position,
        pts: Math.round(p.pts * 10) / 10,
        reb: Math.round(p.reb * 10) / 10,
        ast: Math.round(p.ast * 10) / 10,
        score: Math.round(p.score * 10) / 10,
      })),
      madePlayoffs,
      playoffResult,
      rounds,
      milestones,
      mvp: { playerName: mvp.playerName, position: mvp.position, pts: mvp.pts, reb: mvp.reb, ast: mvp.ast, stl: mvp.stl, blk: mvp.blk },
      badges,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Season simulation failed" },
      { status: 500 }
    );
  }
}
