/**
 * Client-side NFL helpers: game-state and API response types, wheel adapter, display labels.
 */
import type { NflRoster, NflSlot, NflTeam } from "@/lib/nfl-types";
import type { DriveOutcome, KeyMoment, SeasonResult } from "@/lib/nfl-sim";
import type { NBATeam } from "@/lib/nba-api";

export type NflGameMode = "all_time" | "active_only";

/** Multiplayer game state as broadcast by the socket server for sport === "nfl". */
export type NflGameState = {
  gameId: string;
  sport: "nfl";
  phase: "lobby" | "drafting" | "simulation" | "completed";
  gameMode: NflGameMode;
  player1: { socketId: string } | null;
  player2: { socketId: string } | null;
  firstDrafter: 1 | 2 | null;
  currentTurn: 1 | 2;
  wheelTeamId: string | null;
  wheelTeamName: string | null;
  rosters: { 1: NflRoster; 2: NflRoster };
  takenPlayerIds: string[];
  simulationResult: NflSimulationResponse | null;
};

export type TeamSummary = {
  name: string;
  units: {
    passing: number;
    rushing: number;
    ballSecurity: number;
    passDefense: number;
    runDefense: number;
    takeaways: number;
    passRush: number;
  };
  passShare: number;
  players: { name: string; slot: string; value: number; archetype?: string }[];
};

/** POST /api/nfl/simulate response. */
export type NflSimulationResponse = {
  seed: number;
  winner: 1 | 2 | null;
  team1Score: number;
  team2Score: number;
  overtime: boolean;
  team1WinProbability: number;
  team2WinProbability: number;
  tieProbability: number;
  expectedScore: [number, number];
  keyMoments: KeyMoment[];
  drives: { quarter: number; offense: 1 | 2; outcome: DriveOutcome; score: [number, number]; text: string }[];
  teamStats: Record<1 | 2, { touchdowns: number; fieldGoals: number; turnovers: number }>;
  team1: TeamSummary;
  team2: TeamSummary;
};

/** POST /api/nfl/season response. */
export type NflSeasonResponse = SeasonResult & {
  team: TeamSummary;
  mvp: { name: string; slot: string; value: number; archetype?: string };
};

/** The Wheel component takes NBA-shaped teams; adapt NFL teams to it. */
export function toWheelTeams(teams: NflTeam[]): NBATeam[] {
  return teams.map((t) => ({ id: t.id, full_name: t.fullName, abbreviation: t.abbreviation, nickname: "", city: "" }));
}

export const SLOT_SHORT_LABELS: Record<NflSlot, string> = {
  QB: "QB",
  RB: "RB",
  WR1: "WR",
  WR2: "WR",
  WR3: "WR",
  TE: "TE",
  DEF_CAPTAIN: "DEF",
  TEAM_DEF: "D/ST",
};

/** Human label for a unit strength (0 = league average, ~1 = elite; no ceiling). */
export function unitGrade(v: number): { label: string; tone: string } {
  if (v >= 1.2) return { label: "Elite", tone: "text-emerald-300" };
  if (v >= 0.7) return { label: "Great", tone: "text-green-400" };
  if (v >= 0.3) return { label: "Good", tone: "text-lime-300" };
  if (v > -0.3) return { label: "Average", tone: "text-zinc-300" };
  return { label: "Weak", tone: "text-red-400" };
}

/** Bar fill for a unit strength — display only, the engine has no ceiling. */
export function unitBarPct(v: number): number {
  return Math.max(4, Math.min(100, ((v + 1) / 3) * 100));
}

export function quarterLabel(q: number): string {
  return q === 5 ? "OT" : `Q${q}`;
}

export const UNIT_LABELS: { key: keyof TeamSummary["units"]; label: string }[] = [
  { key: "passing", label: "Passing" },
  { key: "rushing", label: "Rushing" },
  { key: "ballSecurity", label: "Ball security" },
  { key: "passDefense", label: "Pass defense" },
  { key: "runDefense", label: "Run defense" },
  { key: "takeaways", label: "Takeaways" },
];
