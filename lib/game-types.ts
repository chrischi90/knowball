/**
 * Shared game types for client and server.
 */

export const POSITIONS = ["PG", "SG", "SF", "PF", "C"] as const;
export type Position = (typeof POSITIONS)[number];

export type GamePhase = "lobby" | "drafting" | "simulation" | "completed";

export type GameMode = "all_time" | "active_only";

export type RosterSlot = {
  position: Position;
  playerId: string | null;
  playerName: string | null;
  teamId: string | null;
  naturalPosition: string | null;
};

export type Roster = Record<Position, RosterSlot>;

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

export function createEmptyRoster(): Roster {
  return {
    PG: { position: "PG", playerId: null, playerName: null, teamId: null, naturalPosition: null },
    SG: { position: "SG", playerId: null, playerName: null, teamId: null, naturalPosition: null },
    SF: { position: "SF", playerId: null, playerName: null, teamId: null, naturalPosition: null },
    PF: { position: "PF", playerId: null, playerName: null, teamId: null, naturalPosition: null },
    C: { position: "C", playerId: null, playerName: null, teamId: null, naturalPosition: null },
  };
}

export type GameState = {
  gameId: string;
  phase: GamePhase;
  gameMode: GameMode;
  player1: { socketId: string; name?: string } | null;
  player2: { socketId: string; name?: string } | null;
  firstDrafter: 1 | 2;
  currentTurn: 1 | 2; // 1 or 2
  wheelTeamId: string | null;
  wheelTeamName: string | null;
  rosters: { 1: Roster; 2: Roster };
  takenPlayerIds: string[];
  simulationResult: {
    winner: 1 | 2 | null;
    team1Score: number;
    team2Score: number;
    team1WinProbability?: number;
    team2WinProbability?: number;
    team1RatingWinProbability?: number;
    team2RatingWinProbability?: number;
    team1PythagoreanWinProbability?: number;
    team2PythagoreanWinProbability?: number;
    team1BlendedWinProbability?: number;
    team2BlendedWinProbability?: number;
    hybridBlendWeight?: number;
    team1Rating?: number;
    team2Rating?: number;
    team1EstimatedPointsFor?: number;
    team1EstimatedPointsAgainst?: number;
    team2EstimatedPointsFor?: number;
    team2EstimatedPointsAgainst?: number;
    team1Diagnostics?: TeamFitDiagnostics;
    team2Diagnostics?: TeamFitDiagnostics;
    team1Stats?: Record<string, number>;
    team2Stats?: Record<string, number>;
    playerStats1?: Record<string, { pts: number; reb: number; ast: number; stl: number; blk: number } | null>;
    playerStats2?: Record<string, { pts: number; reb: number; ast: number; stl: number; blk: number } | null>;
  } | null;
};

export type SimulationInput = {
  roster1: Roster;
  roster2: Roster;
};
