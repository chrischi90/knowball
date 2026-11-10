/**
 * NFL domain types and API contract. Lives alongside the NBA types in
 * lib/game-types.ts — NBA types are intentionally untouched.
 *
 * Game rules (eligibility, validation, season context) live in lib/nfl-rules.js
 * so the CommonJS socket server can share them; this file re-exports them typed.
 */

import * as rules from "./nfl-rules.js";

export type Sport = "nba" | "nfl";

// ---------------------------------------------------------------------------
// Positions and slots
// ---------------------------------------------------------------------------

export const NFL_SLOTS = rules.NFL_SLOTS as readonly NflSlot[];
export const NFL_PLAYER_SLOTS = rules.NFL_PLAYER_SLOTS as readonly NflPlayerSlot[];
export const NFL_SLOT_LABELS = rules.NFL_SLOT_LABELS as Record<NflSlot, string>;

export type NflSlot = NflPlayerSlot | "TEAM_DEF";
export type NflPlayerSlot = "QB" | "RB" | "WR1" | "WR2" | "WR3" | "TE" | "DEF_CAPTAIN";

/** Canonical primary position. Each player has exactly one (the one they primarily played). */
export type NflPosition = "QB" | "RB" | "WR" | "TE" | "DE" | "DT" | "LB" | "CB" | "S" | "DB";

export type NflPlayerRosterSlot = {
  slot: NflPlayerSlot;
  playerId: string | null;
  playerName: string | null;
  teamId: string | null;
  naturalPosition: NflPosition | null;
};

export type NflTeamDefenseSlot = {
  slot: "TEAM_DEF";
  teamId: string | null;
  teamName: string | null;
  season: number | null;
};

export type NflRoster = Record<NflPlayerSlot, NflPlayerRosterSlot> & {
  TEAM_DEF: NflTeamDefenseSlot;
};

// ---------------------------------------------------------------------------
// Season context
// ---------------------------------------------------------------------------

export type NflSeasonPhase = "offseason" | "regular" | "postseason";

export type NflSeasonContext = {
  /** Season in progress (or upcoming during the offseason), labeled by start year. */
  season: number;
  phase: NflSeasonPhase;
  /** Regular-season week 1-18, null outside the regular season. */
  week: number | null;
  /** Season whose rosters are used (always current/upcoming). */
  rosterSeason: number;
  /** Season whose stats active_only uses (previous season before week 10). */
  statsSeason: number;
};

export const NFL_ALL_TIME_START_SEASON: number = rules.NFL_ALL_TIME_START_SEASON;
export const NFL_CURRENT_STATS_START_WEEK: number = rules.NFL_CURRENT_STATS_START_WEEK;

// ---------------------------------------------------------------------------
// API contract (Python service → Next.js proxy → client)
// All NFL service routes are mounted under /nfl.
// ---------------------------------------------------------------------------

/** GET /nfl/teams → { teams: NflTeam[] }. id = PFR franchise code (stable across relocations). */
export type NflTeam = {
  id: string; // e.g. "kan", "rai" (Raiders: OAK/LA/LV), "oti" (Oilers/Titans)
  fullName: string; // current name, e.g. "Las Vegas Raiders"
  abbreviation: string; // current, e.g. "LV"
  conference: "AFC" | "NFC";
  division: string; // e.g. "AFC West"
};

/** GET /nfl/teams/{teamId}/players?game_mode=active_only|all_time → { players: NflPlayer[] } */
export type NflPlayer = {
  id: string; // PFR player id, e.g. "MahoPa00"
  name: string;
  position: NflPosition; // primary position (players with non-game positions are excluded)
  jersey: string;
  isRookie: boolean; // true → stats may be a Madden-based projection before week 10
};

export type NflStatSource = "db" | "scrape" | "projection";

/** Per-game passing line. */
export type NflPassingPerGame = {
  cmp: number;
  att: number;
  yds: number;
  td: number;
  int: number;
  sacked: number;
};

export type NflRushingPerGame = {
  att: number;
  yds: number;
  td: number;
  fumblesLost: number;
};

export type NflReceivingPerGame = {
  tgt: number | null; // targets not tracked before 1992
  rec: number;
  yds: number;
  td: number;
};

export type NflDefensePerGame = {
  tackles: number | null; // unreliable before ~2001
  sacks: number | null; // official from 1982
  int: number;
  passesDefended: number | null;
  forcedFumbles: number | null;
  tacklesForLoss: number | null;
};

/**
 * GET /nfl/players/{playerId}/stats?team_id=&game_mode= → NflPlayerStats
 * All numbers are PER GAME, computed as (sum of totals) / (sum of games) across
 * the seasons in scope, so 14/16/17-game seasons compare fairly.
 */
/** The four per-game blocks; a block is null when it doesn't apply to the position. */
export type NflPerGameLine = {
  passing: NflPassingPerGame | null;
  rushing: NflRushingPerGame | null;
  receiving: NflReceivingPerGame | null;
  defense: NflDefensePerGame | null;
};

export type NflPlayerStats = {
  playerId: string;
  teamId: string;
  position: NflPosition;
  gp: number;
  gs: number;
  /** Seasons aggregated: [statsSeason] for active_only, team stint for all_time. */
  seasons: number[];
  /** Team the stats came from — differs from teamId when a player changed teams. */
  statsTeamId: string;
  passing: NflPassingPerGame | null;
  rushing: NflRushingPerGame | null;
  receiving: NflReceivingPerGame | null;
  defense: NflDefensePerGame | null;
  /**
   * League baseline: the average qualifying starter at this position group in the same
   * seasons, weighted by this player's games per season. Ratings are relative to this
   * (era adjustment without a ceiling).
   */
  league: NflPerGameLine;
  source: NflStatSource;
};

/** GET /nfl/teams/{teamId}/defense/seasons → { seasons: NflTeamSeason[] } (NFL_ALL_TIME_START_SEASON+, newest first) */
export type NflTeamSeason = {
  season: number;
  teamName: string; // name that season, e.g. "Houston Oilers"
  wins: number;
  losses: number;
  ties: number;
};

/** GET /nfl/teams/{teamId}/defense?season= → NflTeamDefense (per game) */
export type NflTeamDefense = {
  teamId: string;
  season: number;
  teamName: string;
  games: number;
  pointsAllowed: number;
  yardsAllowed: number;
  passYardsAllowed: number;
  rushYardsAllowed: number;
  takeaways: number;
  sacks: number | null;
  playsAllowed: number;
  /** League per-game averages for the same season. */
  league: {
    pointsAllowed: number;
    yardsAllowed: number;
    passYardsAllowed: number;
    rushYardsAllowed: number;
    takeaways: number;
    sacks: number | null;
    playsAllowed: number;
  };
  source: NflStatSource;
};

// ---------------------------------------------------------------------------
// Typed rule re-exports
// ---------------------------------------------------------------------------

export const normalizeNflPosition = rules.normalizeNflPosition as (
  raw: string | null | undefined
) => NflPosition | null;

export const isEligibleForSlot = rules.isEligibleForSlot as (
  slot: NflPlayerSlot,
  primaryPosition: NflPosition | null | undefined
) => boolean;

export const eligibleSlotsFor = rules.eligibleSlotsFor as (
  primaryPosition: NflPosition
) => NflPlayerSlot[];

export const createEmptyNflRoster = rules.createEmptyNflRoster as () => NflRoster;
export const isSlotFilled = rules.isSlotFilled as (roster: NflRoster, slot: NflSlot) => boolean;
export const getOpenSlots = rules.getOpenSlots as (roster: NflRoster) => NflSlot[];
export const isNflRosterComplete = rules.isNflRosterComplete as (roster: NflRoster) => boolean;

export const validateNflPlayerPick = rules.validateNflPlayerPick as (args: {
  roster: NflRoster;
  slot: NflPlayerSlot;
  player: { id: string; position: NflPosition | null };
  takenPlayerIds: string[];
}) => string | null;

export const validateTeamDefensePick = rules.validateTeamDefensePick as (args: {
  roster: NflRoster;
  opponentRoster?: NflRoster | null;
  teamId: string;
  wheelTeamId: string | null;
  season: number;
  gameMode: "all_time" | "active_only";
  activeSeason?: number;
  availableSeasons?: number[];
}) => string | null;

export const getNflSeasonContext = rules.getNflSeasonContext as (now?: Date) => NflSeasonContext;
