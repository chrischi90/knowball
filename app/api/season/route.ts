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
const ALLOWED_GAME_MODES = new Set(["all_time", "active_only"]);

const ROUND_NAMES = ["First Round", "Conference Semifinals", "Conference Finals", "NBA Finals"];
const RECENT_BEST_TEAM_WIN_RATE = 68 / 82;
const SERIES_VOLATILITY_STDDEV = 0.012;
const FATIGUE_PER_EXTRA_GAME = 0.009;
const FATIGUE_RECOVERY_BETWEEN_ROUNDS = 0.004;
const HOME_COURT_ADVANTAGE = 0.008;
const ROUND_OPPONENT_BONUS = [0, 0.015, 0.03, 0.045] as const;

const SEED_BASE_STRENGTH: Record<number, number> = {
  1: 0.78,
  2: 0.74,
  3: 0.7,
  4: 0.66,
  5: 0.62,
  6: 0.58,
  7: 0.55,
  8: 0.52,
};

type PlayoffTeam = {
  seed: number;
  strength: number;
  isUser?: boolean;
};

type SeriesOutcome = {
  winner: PlayoffTeam;
  loser: PlayoffTeam;
  winnerWins: number;
  loserWins: number;
  games: number;
  userWins: number;
  userLosses: number;
  opponentSeed: number | null;
  opponentStrength: number | null;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function randomNormal(): number {
  const u = Math.max(1e-12, Math.random());
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function weightedSample<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((sum, w) => sum + w, 0);
  const r = Math.random() * total;
  let running = 0;
  for (let i = 0; i < items.length; i++) {
    running += weights[i];
    if (r <= running) return items[i];
  }
  return items[items.length - 1];
}

function seedWeightsFromWins(wins: number): number[] {
  if (wins >= 64) return [0.46, 0.29, 0.14, 0.06, 0.03, 0.015, 0.005, 0];
  if (wins >= 57) return [0.2, 0.24, 0.22, 0.15, 0.1, 0.06, 0.03, 0];
  if (wins >= 50) return [0.08, 0.13, 0.19, 0.22, 0.18, 0.11, 0.07, 0.02];
  if (wins >= 44) return [0.03, 0.05, 0.09, 0.14, 0.2, 0.2, 0.18, 0.11];
  return [0.01, 0.02, 0.03, 0.06, 0.12, 0.2, 0.27, 0.29];
}

function sampleSeedFromWins(wins: number): number {
  return weightedSample([1, 2, 3, 4, 5, 6, 7, 8], seedWeightsFromWins(wins));
}

function sampleSeedStrength(seed: number): number {
  const base = SEED_BASE_STRENGTH[seed] ?? 0.58;
  const noise = randomNormal() * 0.014;
  return clamp(base + noise, 0.42, RECENT_BEST_TEAM_WIN_RATE);
}

function buildConferenceSlots(userSeed: number, userStrength: number): PlayoffTeam[] {
  const bySeed: Record<number, PlayoffTeam> = {};
  for (let seed = 1; seed <= 8; seed++) {
    bySeed[seed] = { seed, strength: sampleSeedStrength(seed) };
  }
  bySeed[userSeed] = {
    seed: userSeed,
    strength: clamp(userStrength, 0.42, RECENT_BEST_TEAM_WIN_RATE),
    isUser: true,
  };

  // Bracket layout: 1v8, 4v5, 3v6, 2v7
  return [1, 8, 4, 5, 3, 6, 2, 7].map((seed) => bySeed[seed]);
}

function buildGenericConferenceSlots(): PlayoffTeam[] {
  const bySeed: Record<number, PlayoffTeam> = {};
  for (let seed = 1; seed <= 8; seed++) {
    bySeed[seed] = { seed, strength: sampleSeedStrength(seed) };
  }
  return [1, 8, 4, 5, 3, 6, 2, 7].map((seed) => bySeed[seed]);
}

function log5WinProbability(teamA: number, teamB: number): number {
  const a = clamp(teamA, 0.02, 0.98);
  const b = clamp(teamB, 0.02, 0.98);
  const denominator = a * (1 - b) + b * (1 - a);
  if (denominator <= 0) return 0.5;
  return clamp((a * (1 - b)) / denominator, 0.02, 0.98);
}

function simulateSeries(
  teamA: PlayoffTeam,
  teamB: PlayoffTeam,
  roundIndex: number,
  userFatigue: number
): SeriesOutcome {
  let strengthA = teamA.strength;
  let strengthB = teamB.strength;

  if (teamA.isUser) {
    strengthA = clamp(strengthA - userFatigue, 0.35, RECENT_BEST_TEAM_WIN_RATE);
    strengthB = clamp(
      strengthB + ROUND_OPPONENT_BONUS[roundIndex],
      0.35,
      RECENT_BEST_TEAM_WIN_RATE
    );
  }
  if (teamB.isUser) {
    strengthB = clamp(strengthB - userFatigue, 0.35, RECENT_BEST_TEAM_WIN_RATE);
    strengthA = clamp(
      strengthA + ROUND_OPPONENT_BONUS[roundIndex],
      0.35,
      RECENT_BEST_TEAM_WIN_RATE
    );
  }

  let pA = log5WinProbability(strengthA, strengthB);
  if (teamA.seed < teamB.seed) pA += HOME_COURT_ADVANTAGE;
  else if (teamA.seed > teamB.seed) pA -= HOME_COURT_ADVANTAGE;
  pA += randomNormal() * SERIES_VOLATILITY_STDDEV;
  pA = clamp(pA, 0.06, 0.94);

  let aWins = 0;
  let bWins = 0;
  while (aWins < 4 && bWins < 4) {
    if (Math.random() < pA) aWins++;
    else bWins++;
  }

  const winner = aWins > bWins ? teamA : teamB;
  const loser = winner === teamA ? teamB : teamA;
  const userWins = teamA.isUser ? aWins : teamB.isUser ? bWins : 0;
  const userLosses = teamA.isUser ? bWins : teamB.isUser ? aWins : 0;
  const opponent = teamA.isUser ? teamB : teamB.isUser ? teamA : null;

  return {
    winner,
    loser,
    winnerWins: Math.max(aWins, bWins),
    loserWins: Math.min(aWins, bWins),
    games: aWins + bWins,
    userWins,
    userLosses,
    opponentSeed: opponent?.seed ?? null,
    opponentStrength: opponent ? Math.round(opponent.strength * 1000) / 1000 : null,
  };
}

function simulateOtherConferenceChampion(): PlayoffTeam {
  let current = buildGenericConferenceSlots();
  for (let round = 0; round < 3; round++) {
    const next: PlayoffTeam[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const outcome = simulateSeries(current[i], current[i + 1], round, 0);
      next.push(outcome.winner);
    }
    current = next;
  }
  return current[0];
}

// Cap concurrent season simulations (heavier than head-to-head) to prevent event-loop saturation
let _activeSeasonSims = 0;
const MAX_CONCURRENT_SEASON_SIMS = 10;

export async function POST(req: Request) {
  if (_activeSeasonSims >= MAX_CONCURRENT_SEASON_SIMS) {
    return NextResponse.json({ error: "Server busy, please try again shortly" }, { status: 503 });
  }
  _activeSeasonSims++;
  try {
    const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
    const body = (await req.json()) as Body;
    const { roster, gameMode } = body;
    if (!roster) {
      return NextResponse.json({ error: "roster required" }, { status: 400 });
    }
    if (gameMode && !ALLOWED_GAME_MODES.has(gameMode)) {
      return NextResponse.json({ error: "Invalid gameMode" }, { status: 400 });
    }

    if (POSITIONS.filter((p) => roster[p].playerId).length !== 5) {
      return NextResponse.json({ error: "Roster must have 5 players" }, { status: 400 });
    }

    // Fetch stats for all 5 players in parallel, scoped to their selected team
    const rawStatsResults = await Promise.all(
      POSITIONS.map(async (p) => {
        const slot = roster[p];
        if (!slot.playerId) return null;

        if (!slot.teamId) {
          return fetchPlayerStats(slot.playerId, null, slot.playerName, gameMode, { requestId }).catch(() => null);
        }

        const teamScoped = await fetchPlayerStats(
          slot.playerId,
          slot.teamId,
          slot.playerName,
          gameMode,
          { requestId }
        ).catch(() => null);
        if (teamScoped) return teamScoped;

        return fetchPlayerStats(slot.playerId, null, slot.playerName, gameMode, { requestId }).catch(() => null);
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
    let playoffSeed: number | null = null;
    let playoffFatigue: number | null = null;
    const rounds: {
      name: string;
      wins: number;
      losses: number;
      opponentSeed?: number;
      opponentStrength?: number;
    }[] = [];
    let playoffResult: string | null = null;

    if (madePlayoffs) {
      const userSeed = sampleSeedFromWins(wins);
      playoffSeed = userSeed;
      let fatigue = 0;
      let current = buildConferenceSlots(userSeed, pWin);
      let userAlive = true;

      for (let r = 0; r < 3; r++) {
        if (r > 0) {
          fatigue = Math.max(0, fatigue - FATIGUE_RECOVERY_BETWEEN_ROUNDS);
        }

        const next: PlayoffTeam[] = [];
        for (let i = 0; i < current.length; i += 2) {
          const outcome = simulateSeries(current[i], current[i + 1], r, fatigue);
          next.push(outcome.winner);

          if (current[i].isUser || current[i + 1].isUser) {
            rounds.push({
              name: ROUND_NAMES[r],
              wins: outcome.userWins,
              losses: outcome.userLosses,
              opponentSeed: outcome.opponentSeed ?? undefined,
              opponentStrength: outcome.opponentStrength ?? undefined,
            });

            fatigue += Math.max(0, outcome.games - 5) * FATIGUE_PER_EXTRA_GAME;

            if (!outcome.winner.isUser) {
              const exitNames = [
                "First Round Exit",
                "Conference Semifinals",
                "Conference Finals",
              ];
              playoffResult = exitNames[r];
              userAlive = false;
              break;
            }
          }
        }

        if (!userAlive) break;
        current = next;
      }

      if (userAlive) {
        fatigue = Math.max(0, fatigue - FATIGUE_RECOVERY_BETWEEN_ROUNDS);
        const otherChampion = simulateOtherConferenceChampion();
        const finals = simulateSeries(
          { seed: current[0].seed, strength: pWin, isUser: true },
          otherChampion,
          3,
          fatigue
        );

        rounds.push({
          name: ROUND_NAMES[3],
          wins: finals.userWins,
          losses: finals.userLosses,
          opponentSeed: finals.opponentSeed ?? undefined,
          opponentStrength: finals.opponentStrength ?? undefined,
        });

        playoffResult = finals.winner.isUser ? "Champion" : "NBA Finals";
      }

      playoffFatigue = Math.round(fatigue * 1000) / 1000;
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
      playoffSeed,
      playoffFatigue,
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
  } finally {
    _activeSeasonSims--;
  }
}
