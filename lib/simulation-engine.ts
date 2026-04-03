import type { PlayerStats } from "@/lib/nba-api";
import { POSITIONS } from "@/lib/game-types";
import type { Position, Roster } from "@/lib/game-types";

export type TeamFitDiagnostics = {
  usageBalance: number;
  usageOverloadPenalty: number;
  spacingFit: number;
  playmakingFit: number;
  defenseFit: number;
  turnoverRisk: number;
  meshFactor: number;
  chemistryImpact: number;
};

export type PlayerScoreLine = {
  playerName: string;
  position: Position;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  score: number;
};

export type TeamProfileResult = {
  baseTalent: number;
  meshAdjustedTalent: number;
  teamRating: number;
  estimatedPointsFor: number;
  estimatedPointsAgainst: number;
  playerScores: PlayerScoreLine[];
  diagnostics: TeamFitDiagnostics;
};

export type TeamBadgeSummary = {
  strengthBadges: string[];
  weaknessBadges: string[];
};

export type MatchupSimulation = {
  winner: 1 | 2;
  team1Score: number;
  team2Score: number;
  team1WinProbability: number;
  team2WinProbability: number;
};

export type HybridWinBreakdown = {
  ratingWinProbability: number;
  pythagoreanWinProbability: number;
  blendedWinProbability: number;
  blendWeight: number;
  team1EstimatedPointsFor: number;
  team1EstimatedPointsAgainst: number;
  team2EstimatedPointsFor: number;
  team2EstimatedPointsAgainst: number;
};

const CHEMISTRY_WEIGHT = 0.27;
const WIN_PROBABILITY_SCALE = 22;
export const BASELINE_TEAM_RATING = 148;
export const HYBRID_BLEND_WEIGHT = 0.5;
export const PYTHAG_EXPONENT = 14;
export const BASELINE_POINTS_FOR = 109;
export const BASELINE_POINTS_AGAINST = 109;

export const LEAGUE_AVERAGE_STATS: Omit<PlayerStats, "player_id"> = {
  gp: 82,
  pts: 15,
  reb: 5,
  ast: 3.5,
  stl: 1,
  blk: 0.7,
  ts_pct: 0.57,
  three_par: 0.37,
  usg_pct: 21.5,
  ast_pct: 16.5,
  tov_pct: 13.3,
  fg3_pct: 0.355,
  ws48: 0.1,
  bpm: 0,
  dbpm: 0,
};

const POSITION_GROUP: Record<string, number> = { PG: 0, SG: 0, SF: 1, PF: 2, C: 2 };

type PlayerProfile = {
  usagePct: number;
  astPct: number;
  tovPct: number;
  spacingIndex: number;
  defenseIndex: number;
  fg3Pct: number;
  threePar: number;
  stlPct: number;
  blkPct: number;
  playerTalent: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function fallback(value: number | null | undefined, defaultValue: number): number {
  return isFiniteNumber(value) ? value : defaultValue;
}

function normalize(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return clamp((value - min) / (max - min), 0, 1);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = mean(values);
  const variance = mean(values.map((v) => (v - avg) ** 2));
  return Math.sqrt(variance);
}

type BadgeCandidate = { label: string; score: number };

function selectTopBadges(candidates: BadgeCandidate[], limit: number): string[] {
  const seen = new Set<string>();
  const top: string[] = [];

  candidates
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .forEach((candidate) => {
      if (top.length >= limit || seen.has(candidate.label)) return;
      seen.add(candidate.label);
      top.push(candidate.label);
    });

  return top;
}

function deriveThreePar(stats: PlayerStats): number {
  if (isFiniteNumber(stats.three_par)) return clamp(stats.three_par, 0.05, 0.85);
  const fga = fallback(stats.fga, 0);
  const fg3a = fallback(stats.fg3a, 0);
  if (fga > 0) return clamp(fg3a / fga, 0.05, 0.85);
  return fallback(LEAGUE_AVERAGE_STATS.three_par, 0.37);
}

function deriveFg3Pct(stats: PlayerStats): number {
  if (isFiniteNumber(stats.fg3_pct)) return clamp(stats.fg3_pct, 0.2, 0.48);
  const fg3a = fallback(stats.fg3a, 0);
  const fg3m = fallback(stats.fg3m, 0);
  if (fg3a > 0) return clamp(fg3m / fg3a, 0.2, 0.48);
  return fallback(LEAGUE_AVERAGE_STATS.fg3_pct, 0.355);
}

function deriveTsPct(stats: PlayerStats): number {
  if (isFiniteNumber(stats.ts_pct)) return clamp(stats.ts_pct, 0.45, 0.75);
  const fga = fallback(stats.fga, 0);
  const fta = fallback(stats.fta, 0);
  const denominator = 2 * (fga + 0.44 * fta);
  if (denominator > 0) return clamp(stats.pts / denominator, 0.45, 0.75);
  return fallback(LEAGUE_AVERAGE_STATS.ts_pct, 0.57);
}

function deriveUsagePct(stats: PlayerStats): number {
  if (isFiniteNumber(stats.usg_pct)) return clamp(stats.usg_pct, 8, 40);
  const tov = fallback(stats.tov, 2);
  return clamp(11 + stats.pts * 0.55 + stats.ast * 0.35 + tov * 1.3, 11, 36);
}

function deriveAstPct(stats: PlayerStats): number {
  if (isFiniteNumber(stats.ast_pct)) return clamp(stats.ast_pct, 5, 55);
  return clamp(stats.ast * 4.4, 5, 45);
}

function deriveTovPct(stats: PlayerStats, usagePct: number): number {
  if (isFiniteNumber(stats.tov_pct)) return clamp(stats.tov_pct, 6, 24);
  return clamp(10 + Math.max(0, usagePct - 18) * 0.28, 8, 22);
}

function deriveDbpm(stats: PlayerStats): number {
  if (isFiniteNumber(stats.dbpm)) return clamp(stats.dbpm, -5, 5);
  return clamp((stats.stl * 0.9 + stats.blk * 1.1) - 2, -3, 3);
}

function deriveBpm(stats: PlayerStats, dbpm: number): number {
  if (isFiniteNumber(stats.bpm)) return clamp(stats.bpm, -8, 10);
  if (isFiniteNumber(stats.obpm)) return clamp(stats.obpm + dbpm, -8, 10);
  return clamp((stats.pts - 15) * 0.12 + (stats.ast - 4) * 0.25 + dbpm * 0.4, -6, 8);
}

function deriveWs48(stats: PlayerStats): number {
  if (isFiniteNumber(stats.ws48)) return clamp(stats.ws48, -0.1, 0.35);
  return fallback(LEAGUE_AVERAGE_STATS.ws48, 0.1);
}

function deriveStlPct(stats: PlayerStats): number {
  if (isFiniteNumber(stats.stl_pct)) return clamp(stats.stl_pct, 0.4, 4.5);
  return clamp(stats.stl * 1.4, 0.4, 3.5);
}

function deriveBlkPct(stats: PlayerStats): number {
  if (isFiniteNumber(stats.blk_pct)) return clamp(stats.blk_pct, 0.2, 7);
  return clamp(stats.blk * 1.8, 0.2, 5);
}

function deriveStocks(stats: PlayerStats): number {
  if (isFiniteNumber(stats.stocks)) return clamp(stats.stocks, 0.4, 6);
  return clamp(stats.stl + stats.blk, 0.4, 6);
}

function buildPlayerProfile(stats: PlayerStats): PlayerProfile {
  const threePar = deriveThreePar(stats);
  const fg3Pct = deriveFg3Pct(stats);
  const tsPct = deriveTsPct(stats);
  const usagePct = deriveUsagePct(stats);
  const astPct = deriveAstPct(stats);
  const tovPct = deriveTovPct(stats, usagePct);
  const dbpm = deriveDbpm(stats);
  const bpm = deriveBpm(stats, dbpm);
  const ws48 = deriveWs48(stats);
  const stlPct = deriveStlPct(stats);
  const blkPct = deriveBlkPct(stats);
  const stocks = deriveStocks(stats);

  const basicPower = stats.pts + stats.reb * 1.2 + stats.ast * 1.5 + stats.stl * 3 + stats.blk * 3;
  const efficiencyAdj = clamp((tsPct - 0.57) * 36, -5.5, 6.5);
  const impactAdj = clamp(bpm * 0.85 + dbpm * 0.35, -7, 8);
  const valueAdj = clamp((ws48 - 0.1) * 24, -3.5, 4.5);
  const ballSecurityAdj = clamp((13 - tovPct) * 0.22, -2.5, 2.5);

  const playerTalent = Math.max(8, basicPower + efficiencyAdj + impactAdj + valueAdj + ballSecurityAdj);

  const spacingIndex = clamp(
    normalize(fg3Pct, 0.3, 0.43) * 0.6 + normalize(threePar, 0.18, 0.55) * 0.4,
    0,
    1
  );

  const defenseIndex = clamp(
    normalize(dbpm, -2, 3) * 0.45 +
      normalize(stocks, 1.2, 3.2) * 0.35 +
      normalize((stlPct + blkPct) / 2, 1, 3) * 0.2,
    0,
    1
  );

  return {
    usagePct,
    astPct,
    tovPct,
    spacingIndex,
    defenseIndex,
    fg3Pct,
    threePar,
    stlPct,
    blkPct,
    playerTalent,
  };
}

export function positionMismatchMultiplier(natural: string | null, assigned: Position): number {
  if (!natural) return 1;
  const diff = Math.abs((POSITION_GROUP[natural] ?? 1) - (POSITION_GROUP[assigned] ?? 1));
  return diff === 0 ? 1 : diff === 1 ? 0.85 : 0.7;
}

export function averageStats(stats: PlayerStats[]): Omit<PlayerStats, "player_id"> {
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

export function resolveRosterStats(roster: Roster, rawStats: (PlayerStats | null)[]): PlayerStats[] {
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

export function buildStatsMap(roster: Roster, stats: PlayerStats[]): Record<string, PlayerStats | null> {
  const map: Record<string, PlayerStats | null> = {};
  POSITIONS.forEach((p, i) => {
    const playerId = roster[p].playerId;
    if (playerId) map[playerId] = stats[i];
  });
  return map;
}

export function computeTeamProfile(roster: Roster, stats: PlayerStats[]): TeamProfileResult {
  const playerProfiles = POSITIONS.map((position, index) => {
    const slot = roster[position];
    const statLine = stats[index];
    const profile = buildPlayerProfile(statLine);
    const roleMultiplier = positionMismatchMultiplier(slot.naturalPosition, position);
    const roleAdjustedTalent = profile.playerTalent * roleMultiplier;

    return {
      position,
      slot,
      statLine,
      profile,
      roleAdjustedTalent,
    };
  });

  const baseTalent = playerProfiles.reduce((sum, p) => sum + p.roleAdjustedTalent, 0);

  const usageValues = playerProfiles.map((p) => p.profile.usagePct);
  const usageSum = usageValues.reduce((sum, v) => sum + v, 0);
  const usageStd = standardDeviation(usageValues);
  const highUsageCount = usageValues.filter((v) => v >= 28).length;

  const usageOverloadPenalty = clamp(
    Math.max(0, usageSum - 104) * 0.012 +
      Math.max(0, highUsageCount - 2) * 0.035 +
      Math.max(0, usageStd - 7) * 0.01,
    0,
    0.26
  );

  const spacingValues = playerProfiles.map((p) => p.profile.spacingIndex);
  const spacingMean = mean(spacingValues);
  const nonShooters = spacingValues.filter((v) => v < 0.4).length;
  const eliteShooters = spacingValues.filter((v) => v > 0.68).length;
  const spacingAdjustment = clamp(
    (spacingMean - 0.5) * 0.18 + eliteShooters * 0.012 - Math.max(0, nonShooters - 2) * 0.035,
    -0.12,
    0.1
  );

  const creatorLoad = playerProfiles.reduce(
    (sum, p) => sum + clamp((p.profile.astPct - 14) / 18, 0, 1),
    0
  );
  const primaryHandlers = playerProfiles.filter((p) => p.profile.astPct >= 25).length;
  const playmakingCoverage = clamp(creatorLoad / 2.2, 0, 1);
  const playmakingAdjustment = clamp(
    (playmakingCoverage - 0.5) * 0.12 + (primaryHandlers >= 1 ? 0.015 : -0.03),
    -0.1,
    0.1
  );

  const defenseValues = playerProfiles.map((p) => p.profile.defenseIndex);
  const defenseMean = mean(defenseValues);
  const rimProtectors = playerProfiles.filter(
    (p) => p.statLine.blk >= 1.1 || p.profile.blkPct >= 2.3
  ).length;
  const perimeterStoppers = playerProfiles.filter(
    (p) => p.statLine.stl >= 1.3 || p.profile.stlPct >= 1.9
  ).length;
  const defenseRoleBonus =
    rimProtectors >= 1 && perimeterStoppers >= 1
      ? 0.03
      : rimProtectors === 0 || perimeterStoppers === 0
        ? -0.025
        : 0;
  const defenseAdjustment = clamp((defenseMean - 0.5) * 0.14 + defenseRoleBonus, -0.1, 0.1);

  const avgTovPct = mean(playerProfiles.map((p) => p.profile.tovPct));
  const turnoverPenalty = clamp(
    Math.max(0, avgTovPct - 13) * 0.007 + Math.max(0, usageSum - 104) * 0.0025,
    0,
    0.11
  );

  const meshFactor = clamp(
    1 - usageOverloadPenalty - turnoverPenalty + spacingAdjustment + playmakingAdjustment + defenseAdjustment,
    0.74,
    1.18
  );

  const chemistryMultiplier = 1 + (meshFactor - 1) * CHEMISTRY_WEIGHT;
  const teamRating = baseTalent * chemistryMultiplier;

  const avgPts = mean(playerProfiles.map((p) => p.statLine.pts));
  const avgAst = mean(playerProfiles.map((p) => p.statLine.ast));
  const avgTs = mean(playerProfiles.map((p) => deriveTsPct(p.statLine)));

  const estimatedPointsFor = clamp(
    95 +
      (teamRating - BASELINE_TEAM_RATING) * 0.38 +
      (avgPts - 15) * 2.2 +
      (avgAst - 4.5) * 1.6 +
      (avgTs - 0.57) * 42 -
      Math.max(0, avgTovPct - 13) * 0.9,
    84,
    136
  );

  const estimatedPointsAgainst = clamp(
    111 -
      (defenseMean - 0.5) * 24 +
      usageOverloadPenalty * 9 +
      turnoverPenalty * 6 -
      Math.max(0, rimProtectors - 1) * 1.3,
    88,
    132
  );

  const diagnostics: TeamFitDiagnostics = {
    usageBalance: round1(clamp(1 - usageStd / 11 - Math.max(0, usageSum - 104) / 40, 0, 1) * 100),
    usageOverloadPenalty: round1(usageOverloadPenalty * 100),
    spacingFit: round1(spacingMean * 100),
    playmakingFit: round1(playmakingCoverage * 100),
    defenseFit: round1(clamp(defenseMean + defenseRoleBonus, 0, 1) * 100),
    turnoverRisk: round1(clamp((avgTovPct - 10) / 10, 0, 1) * 100),
    meshFactor: Math.round(meshFactor * 1000) / 1000,
    chemistryImpact: round1((chemistryMultiplier - 1) * 100),
  };

  const playerScores: PlayerScoreLine[] = playerProfiles.map((p) => ({
    playerName: p.slot.playerName ?? "",
    position: p.position,
    pts: p.statLine.pts,
    reb: p.statLine.reb,
    ast: p.statLine.ast,
    stl: p.statLine.stl,
    blk: p.statLine.blk,
    score: round1(p.roleAdjustedTalent),
  }));

  return {
    baseTalent: round1(baseTalent),
    meshAdjustedTalent: round1(baseTalent * meshFactor),
    teamRating: round1(teamRating),
    estimatedPointsFor: round1(estimatedPointsFor),
    estimatedPointsAgainst: round1(estimatedPointsAgainst),
    playerScores,
    diagnostics,
  };
}

export function deriveTeamBadges(profile: TeamProfileResult): TeamBadgeSummary {
  const d = profile.diagnostics;
  const avgPts = mean(profile.playerScores.map((p) => p.pts));
  const avgAst = mean(profile.playerScores.map((p) => p.ast));
  const avgDef = mean(profile.playerScores.map((p) => p.stl + p.blk));

  const strengthCandidates: BadgeCandidate[] = [];
  if (profile.teamRating >= 185) strengthCandidates.push({ label: "Superteam Alert", score: 100 });
  if (d.meshFactor >= 1.06) strengthCandidates.push({ label: "Lineup Synergy", score: 92 });
  if (d.usageBalance >= 72 && d.usageOverloadPenalty <= 5) {
    strengthCandidates.push({ label: "Shared Shot Diet", score: 90 });
  }
  if (d.spacingFit >= 62) strengthCandidates.push({ label: "Elite Spacing", score: 84 });
  if (d.playmakingFit >= 62) strengthCandidates.push({ label: "Ball Movement Engine", score: 82 });
  if (d.defenseFit >= 60) strengthCandidates.push({ label: "Connected Defense", score: 80 });
  if (d.turnoverRisk <= 22) strengthCandidates.push({ label: "Disciplined Possessions", score: 76 });
  if (avgPts >= 21) strengthCandidates.push({ label: "High-Powered Offense", score: 72 });
  if (avgAst >= 6) strengthCandidates.push({ label: "Playmaking Factory", score: 70 });
  if (avgDef >= 3) strengthCandidates.push({ label: "Lockdown Defense", score: 68 });

  const weaknessCandidates: BadgeCandidate[] = [];
  if (d.usageOverloadPenalty >= 10) weaknessCandidates.push({ label: "Usage Logjam", score: 96 });
  if (d.usageBalance < 48) weaknessCandidates.push({ label: "Role Collision", score: 88 });
  if (d.spacingFit < 42) weaknessCandidates.push({ label: "Spacing Crunch", score: 84 });
  if (d.playmakingFit < 45) weaknessCandidates.push({ label: "Limited Playmaking", score: 80 });
  if (d.defenseFit < 42) weaknessCandidates.push({ label: "Defensive Holes", score: 76 });
  if (d.turnoverRisk > 50) weaknessCandidates.push({ label: "Turnover Trouble", score: 74 });
  if (d.meshFactor < 0.94) weaknessCandidates.push({ label: "Chemistry Drag", score: 72 });
  if (avgDef < 1.8) weaknessCandidates.push({ label: "Low Defensive Activity", score: 66 });
  if (avgAst < 3.8) weaknessCandidates.push({ label: "Stagnant Offense", score: 64 });
  if (avgPts < 15.5) weaknessCandidates.push({ label: "Scoring Drought", score: 62 });

  const strengthBadges = selectTopBadges(strengthCandidates, 3);
  const weaknessBadges = selectTopBadges(weaknessCandidates, 3);

  if (strengthBadges.length === 0) {
    strengthBadges.push("Balanced Core");
  }

  return {
    strengthBadges,
    weaknessBadges,
  };
}

export function winProbabilityFromRatings(team1Rating: number, team2Rating: number): number {
  const delta = team1Rating - team2Rating;
  const p = 1 / (1 + Math.exp(-delta / WIN_PROBABILITY_SCALE));
  return clamp(p, 0.05, 0.95);
}

function randomCentered(): number {
  return Math.random() + Math.random() - 1;
}

function randomInt(minInclusive: number, maxInclusive: number): number {
  return minInclusive + Math.floor(Math.random() * (maxInclusive - minInclusive + 1));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function estimateMatchupScoring(teamPointsFor: number, opponentPointsAgainst: number): number {
  return clamp(teamPointsFor * 0.56 + opponentPointsAgainst * 0.44, 78, 145);
}

export function pythagoreanWinProbability(
  pointsFor: number,
  pointsAgainst: number,
  exponent: number = PYTHAG_EXPONENT
): number {
  const pf = clamp(pointsFor, 70, 160);
  const pa = clamp(pointsAgainst, 70, 160);
  const exp = clamp(exponent, 4, 20);

  const pfPower = pf ** exp;
  const paPower = pa ** exp;
  const denominator = pfPower + paPower;
  if (!Number.isFinite(denominator) || denominator <= 0) return 0.5;

  return clamp(pfPower / denominator, 0.05, 0.95);
}

export function blendWinProbabilities(
  ratingWinProbability: number,
  pythagoreanWinProbabilityValue: number,
  blendWeight: number = HYBRID_BLEND_WEIGHT
): number {
  const weight = clamp(blendWeight, 0, 1);
  const blended = ratingWinProbability * weight + pythagoreanWinProbabilityValue * (1 - weight);
  return clamp(blended, 0.05, 0.95);
}

export function computeHybridMatchupWinProbability(
  team1Profile: TeamProfileResult,
  team2Profile: TeamProfileResult,
  blendWeight: number = HYBRID_BLEND_WEIGHT
): HybridWinBreakdown {
  const ratingWinProbability = winProbabilityFromRatings(team1Profile.teamRating, team2Profile.teamRating);
  const team1MatchupPF = estimateMatchupScoring(
    team1Profile.estimatedPointsFor,
    team2Profile.estimatedPointsAgainst
  );
  const team2MatchupPF = estimateMatchupScoring(
    team2Profile.estimatedPointsFor,
    team1Profile.estimatedPointsAgainst
  );
  const pythagoreanWinProbabilityValue = pythagoreanWinProbability(team1MatchupPF, team2MatchupPF);
  const blendedWinProbability = blendWinProbabilities(
    ratingWinProbability,
    pythagoreanWinProbabilityValue,
    blendWeight
  );

  return {
    ratingWinProbability: round3(ratingWinProbability),
    pythagoreanWinProbability: round3(pythagoreanWinProbabilityValue),
    blendedWinProbability: round3(blendedWinProbability),
    blendWeight: round3(clamp(blendWeight, 0, 1)),
    team1EstimatedPointsFor: round1(team1MatchupPF),
    team1EstimatedPointsAgainst: round1(team2MatchupPF),
    team2EstimatedPointsFor: round1(team2MatchupPF),
    team2EstimatedPointsAgainst: round1(team1MatchupPF),
  };
}

export function computeHybridVsBaselineWinProbability(
  teamProfile: TeamProfileResult,
  baselineTeamRating: number = BASELINE_TEAM_RATING,
  blendWeight: number = HYBRID_BLEND_WEIGHT
): Omit<HybridWinBreakdown, "team2EstimatedPointsFor" | "team2EstimatedPointsAgainst"> {
  const ratingWinProbability = winProbabilityFromRatings(teamProfile.teamRating, baselineTeamRating);
  const teamMatchupPF = estimateMatchupScoring(teamProfile.estimatedPointsFor, BASELINE_POINTS_AGAINST);
  const teamMatchupPA = estimateMatchupScoring(BASELINE_POINTS_FOR, teamProfile.estimatedPointsAgainst);
  const pythagoreanWinProbabilityValue = pythagoreanWinProbability(teamMatchupPF, teamMatchupPA);
  const blendedWinProbability = blendWinProbabilities(
    ratingWinProbability,
    pythagoreanWinProbabilityValue,
    blendWeight
  );

  return {
    ratingWinProbability: round3(ratingWinProbability),
    pythagoreanWinProbability: round3(pythagoreanWinProbabilityValue),
    blendedWinProbability: round3(blendedWinProbability),
    blendWeight: round3(clamp(blendWeight, 0, 1)),
    team1EstimatedPointsFor: round1(teamMatchupPF),
    team1EstimatedPointsAgainst: round1(teamMatchupPA),
  };
}

export function simulateHeadToHeadGame(
  team1Rating: number,
  team2Rating: number,
  team1WinProbabilityOverride?: number
): MatchupSimulation {
  const team1WinProbability = isFiniteNumber(team1WinProbabilityOverride)
    ? clamp(team1WinProbabilityOverride, 0.05, 0.95)
    : winProbabilityFromRatings(team1Rating, team2Rating);
  const team2WinProbability = 1 - team1WinProbability;

  // Score-first simulation: odds shape expected margin, then game noise is applied.
  const ratingExpected1 = 99 + (team1Rating - BASELINE_TEAM_RATING) * 0.45;
  const ratingExpected2 = 99 + (team2Rating - BASELINE_TEAM_RATING) * 0.45;
  const oddsMarginShift = (team1WinProbability - 0.5) * 14;
  const expectedTeam1 = ratingExpected1 + oddsMarginShift;
  const expectedTeam2 = ratingExpected2 - oddsMarginShift;

  const SCORE_NOISE = 6;
  let team1Score = Math.round(clamp(expectedTeam1 + randomCentered() * SCORE_NOISE, 78, 165));
  let team2Score = Math.round(clamp(expectedTeam2 + randomCentered() * SCORE_NOISE, 78, 165));

  // Keep ties rare while giving a slight edge to the team with better odds.
  if (team1Score === team2Score) {
    const team1TieBreakerBias = clamp(0.5 + (team1WinProbability - 0.5) * 0.8, 0.2, 0.8);
    if (Math.random() < team1TieBreakerBias) team1Score += randomInt(1, 2);
    else team2Score += randomInt(1, 2);
  }

  const team1Wins = team1Score > team2Score;

  return {
    winner: team1Wins ? 1 : 2,
    team1Score,
    team2Score,
    team1WinProbability: Math.round(team1WinProbability * 1000) / 1000,
    team2WinProbability: Math.round(team2WinProbability * 1000) / 1000,
  };
}
