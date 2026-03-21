import { NextResponse } from "next/server";
import { fetchPlayerStats } from "@/lib/nba-api";
import type { Roster } from "@/lib/game-types";
import { POSITIONS } from "@/lib/game-types";
import {
  BASELINE_TEAM_RATING,
  computeHybridVsBaselineWinProbability,
  computeTeamProfile,
  deriveTeamBadges,
  resolveRosterStats,
} from "@/lib/simulation-engine";

type Body = { roster: Roster; gameMode?: string };

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
    const teamProfile = computeTeamProfile(roster, statsResults);
    const playerScores = teamProfile.playerScores;
    const teamPower = teamProfile.teamRating;

    // Blend rating-based odds with pythagorean-style expectation for hybrid realism.
    const hybrid = computeHybridVsBaselineWinProbability(teamProfile, BASELINE_TEAM_RATING);
    const pWin = hybrid.blendedWinProbability;
    const expectedWinsRating = Math.round(hybrid.ratingWinProbability * 82 * 10) / 10;
    const expectedWinsPythagorean = Math.round(hybrid.pythagoreanWinProbability * 82 * 10) / 10;
    const expectedWinsBlended = Math.round(hybrid.blendedWinProbability * 82 * 10) / 10;

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

    const { strengthBadges, weaknessBadges } = deriveTeamBadges(teamProfile);

    return NextResponse.json({
      wins,
      losses,
      teamPower: Math.round(teamPower * 10) / 10,
      regularSeasonWinProbability: hybrid.blendedWinProbability,
      ratingWinProbability: hybrid.ratingWinProbability,
      pythagoreanWinProbability: hybrid.pythagoreanWinProbability,
      hybridBlendWeight: hybrid.blendWeight,
      expectedWinsRating,
      expectedWinsPythagorean,
      expectedWinsBlended,
      estimatedPointsFor: teamProfile.estimatedPointsFor,
      estimatedPointsAgainst: teamProfile.estimatedPointsAgainst,
      matchupEstimatedPointsFor: hybrid.team1EstimatedPointsFor,
      matchupEstimatedPointsAgainst: hybrid.team1EstimatedPointsAgainst,
      fitDiagnostics: teamProfile.diagnostics,
      baseTalent: teamProfile.baseTalent,
      meshAdjustedTalent: teamProfile.meshAdjustedTalent,
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
      badges: strengthBadges,
      weaknessBadges,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Season simulation failed" },
      { status: 500 }
    );
  }
}
