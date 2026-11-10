/**
 * NFL game rules — single source of truth shared by the Socket.io server
 * (CommonJS, server/*.js) and the Next.js app (via lib/nfl-types.ts).
 *
 * Keep this file dependency-free and CommonJS so both runtimes can load it.
 */

/** Roster slots, in display order. */
const NFL_SLOTS = ["QB", "RB", "WR1", "WR2", "WR3", "TE", "DEF_CAPTAIN", "TEAM_DEF"];

/** Slots filled by an individual player (everything except TEAM_DEF). */
const NFL_PLAYER_SLOTS = NFL_SLOTS.filter((s) => s !== "TEAM_DEF");

const NFL_SLOT_LABELS = {
  QB: "QB",
  RB: "RB",
  WR1: "WR1",
  WR2: "WR2",
  WR3: "WR3",
  TE: "TE",
  DEF_CAPTAIN: "Defensive Captain",
  TEAM_DEF: "Team Defense",
};

/** Canonical primary positions a player can have. */
const NFL_DEFENSIVE_POSITIONS = ["DE", "DT", "LB", "CB", "S", "DB"];
const NFL_OFFENSIVE_SKILL_POSITIONS = ["QB", "RB", "WR", "TE"];

/** Which canonical primary positions may fill each player slot. Strict: no cross-filling. */
const NFL_SLOT_ELIGIBILITY = {
  QB: ["QB"],
  RB: ["RB"], // FB is normalized to RB
  WR1: ["WR"],
  WR2: ["WR"],
  WR3: ["WR"],
  TE: ["TE"],
  DEF_CAPTAIN: NFL_DEFENSIVE_POSITIONS,
};

/**
 * Map raw position labels from Pro-Football-Reference and Madden to a canonical
 * primary position. Returns null for positions not used in the game (OL, K, P, LS).
 */
const RAW_POSITION_MAP = {
  // Offense
  QB: "QB",
  RB: "RB",
  HB: "RB",
  FB: "RB",
  TB: "RB",
  WR: "WR",
  FL: "WR",
  SE: "WR",
  TE: "TE",
  // Defensive line / edge
  DE: "DE",
  EDGE: "DE",
  LEDG: "DE",
  REDG: "DE",
  LDE: "DE",
  RDE: "DE",
  DT: "DT",
  NT: "DT",
  DL: "DT",
  LDT: "DT",
  RDT: "DT",
  // Linebackers
  LB: "LB",
  OLB: "LB",
  ILB: "LB",
  MLB: "LB",
  MIKE: "LB",
  WILL: "LB",
  SAM: "LB",
  LOLB: "LB",
  ROLB: "LB",
  LILB: "LB",
  RILB: "LB",
  // Secondary
  CB: "CB",
  LCB: "CB",
  RCB: "CB",
  S: "S",
  FS: "S",
  SS: "S",
  DB: "DB",
};

/**
 * Normalize a single raw position label (e.g. "HB", "LEDG", "olb") to a canonical
 * primary position, or null if it isn't a position used in the game.
 * For multi-position labels like "LB/DE", the first recognized label wins — the
 * seed script resolves true primary position from games played, this is only a fallback.
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
function normalizeNflPosition(raw) {
  if (!raw) return null;
  const parts = String(raw)
    .toUpperCase()
    .split(/[\/,\-\s]+/)
    .filter(Boolean);
  for (const part of parts) {
    const mapped = RAW_POSITION_MAP[part];
    if (mapped) return mapped;
  }
  return null;
}

/**
 * @param {string} slot
 * @param {string | null | undefined} primaryPosition canonical primary position
 * @returns {boolean}
 */
function isEligibleForSlot(slot, primaryPosition) {
  const allowed = NFL_SLOT_ELIGIBILITY[slot];
  if (!allowed || !primaryPosition) return false;
  return allowed.includes(primaryPosition);
}

/** Player slots a given primary position could fill. */
function eligibleSlotsFor(primaryPosition) {
  return NFL_PLAYER_SLOTS.filter((slot) => isEligibleForSlot(slot, primaryPosition));
}

function createEmptyNflRoster() {
  const roster = {};
  for (const slot of NFL_PLAYER_SLOTS) {
    roster[slot] = {
      slot,
      playerId: null,
      playerName: null,
      teamId: null,
      naturalPosition: null,
    };
  }
  roster.TEAM_DEF = { slot: "TEAM_DEF", teamId: null, teamName: null, season: null };
  return roster;
}

function isSlotFilled(roster, slot) {
  const entry = roster && roster[slot];
  if (!entry) return false;
  return slot === "TEAM_DEF" ? Boolean(entry.teamId && entry.season != null) : Boolean(entry.playerId);
}

function getOpenSlots(roster) {
  return NFL_SLOTS.filter((slot) => !isSlotFilled(roster, slot));
}

function isNflRosterComplete(roster) {
  return getOpenSlots(roster).length === 0;
}

/**
 * Validate a player pick. Returns null if valid, otherwise an error message.
 * @param {object} args
 * @param {object} args.roster the picking user's roster
 * @param {string} args.slot
 * @param {{ id: string, position: string | null }} args.player position = canonical primary position
 * @param {string[]} args.takenPlayerIds
 */
function validateNflPlayerPick({ roster, slot, player, takenPlayerIds }) {
  if (!NFL_PLAYER_SLOTS.includes(slot)) return "Invalid slot";
  if (isSlotFilled(roster, slot)) return "Slot already filled";
  if (!player || !player.id) return "Missing player";
  if ((takenPlayerIds || []).includes(player.id)) return "Player already taken";
  if (!isEligibleForSlot(slot, player.position)) {
    return `${player.position || "Unknown position"} is not eligible for ${NFL_SLOT_LABELS[slot]}`;
  }
  return null;
}

/**
 * Validate a TEAM_DEF lock. Returns null if valid, otherwise an error message.
 * Rules:
 *  - teamId must be the team the wheel currently landed on
 *  - active_only: season must equal the active stats season
 *  - all_time: season must be one of the team's available seasons (NFL_ALL_TIME_START_SEASON+)
 *  - 2p: the opponent must not already have this team's defense (any season)
 * @param {object} args
 * @param {object} args.roster
 * @param {object | null} [args.opponentRoster]
 * @param {string} args.teamId
 * @param {string | null} args.wheelTeamId
 * @param {number} args.season
 * @param {"all_time" | "active_only"} args.gameMode
 * @param {number} [args.activeSeason] required for active_only
 * @param {number[]} [args.availableSeasons] required for all_time
 */
function validateTeamDefensePick({
  roster,
  opponentRoster,
  teamId,
  wheelTeamId,
  season,
  gameMode,
  activeSeason,
  availableSeasons,
}) {
  if (isSlotFilled(roster, "TEAM_DEF")) return "Team Defense already filled";
  if (!teamId || teamId !== wheelTeamId) return "Team Defense must be the team the wheel landed on";
  if (!Number.isInteger(season)) return "Missing season";
  if (gameMode === "active_only") {
    if (season !== activeSeason) return "Team Defense must use the current season";
  } else {
    if (season < NFL_ALL_TIME_START_SEASON) return `Seasons before ${NFL_ALL_TIME_START_SEASON} are not available`;
    if (!(availableSeasons || []).includes(season)) return "Season not available for this team";
  }
  if (opponentRoster && opponentRoster.TEAM_DEF && opponentRoster.TEAM_DEF.teamId === teamId) {
    return "Your opponent already locked this team's defense";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Season context
// ---------------------------------------------------------------------------

// 1999 = first season in nflverse. Lower to 1980 once the manual PFR backfill (1980-1998) is imported.
const NFL_ALL_TIME_START_SEASON = 1999;
/** From this regular-season week onward, active_only uses current-season stats. */
const NFL_CURRENT_STATS_START_WEEK = 10;
const NFL_REGULAR_SEASON_WEEKS = 18;

/** First Monday of September (Labor Day), UTC. */
function laborDay(year) {
  const d = new Date(Date.UTC(year, 8, 1));
  const offset = (8 - d.getUTCDay()) % 7; // days until Monday (getUTCDay: 1 = Monday)
  return new Date(Date.UTC(year, 8, 1 + offset));
}

/** Regular-season kickoff: Thursday after Labor Day, UTC. */
function nflKickoff(year) {
  const ld = laborDay(year);
  return new Date(Date.UTC(ld.getUTCFullYear(), ld.getUTCMonth(), ld.getUTCDate() + 3));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Determine the NFL calendar context for a date.
 *
 * Seasons are labeled by the year they start (the 2025 season ends Feb 2026).
 * Weeks run Tuesday→Monday so Thursday/Sunday/Monday games share a week.
 *
 * Returns:
 *  - season: the season currently in progress (or upcoming, during the offseason)
 *  - phase: "offseason" | "regular" | "postseason"
 *  - week: regular-season week (1-18) or null outside the regular season
 *  - rosterSeason: season whose rosters to use (always the current/upcoming one)
 *  - statsSeason: season whose stats active_only should use
 *      offseason → previous season; weeks 1-9 → previous season;
 *      week 10+ and postseason → current season
 * @param {Date} [now]
 */
function getNflSeasonContext(now = new Date()) {
  // Jan-Feb belong to the season that started the previous calendar year.
  const year = now.getUTCMonth() <= 1 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  // Weeks start the Tuesday before kickoff Thursday.
  const week1Start = new Date(nflKickoff(year).getTime() - 2 * DAY_MS);

  if (now.getTime() < week1Start.getTime()) {
    // Mar → kickoff: offseason. Rosters for the upcoming season, stats from the last one.
    return {
      season: year,
      phase: "offseason",
      week: null,
      rosterSeason: year,
      statsSeason: year - 1,
    };
  }

  const week = Math.floor((now.getTime() - week1Start.getTime()) / (7 * DAY_MS)) + 1;
  if (week > NFL_REGULAR_SEASON_WEEKS) {
    return { season: year, phase: "postseason", week: null, rosterSeason: year, statsSeason: year };
  }
  return {
    season: year,
    phase: "regular",
    week,
    rosterSeason: year,
    statsSeason: week >= NFL_CURRENT_STATS_START_WEEK ? year : year - 1,
  };
}

module.exports = {
  NFL_SLOTS,
  NFL_PLAYER_SLOTS,
  NFL_SLOT_LABELS,
  NFL_DEFENSIVE_POSITIONS,
  NFL_OFFENSIVE_SKILL_POSITIONS,
  NFL_SLOT_ELIGIBILITY,
  NFL_ALL_TIME_START_SEASON,
  NFL_CURRENT_STATS_START_WEEK,
  NFL_REGULAR_SEASON_WEEKS,
  normalizeNflPosition,
  isEligibleForSlot,
  eligibleSlotsFor,
  createEmptyNflRoster,
  isSlotFilled,
  getOpenSlots,
  isNflRosterComplete,
  validateNflPlayerPick,
  validateTeamDefensePick,
  nflKickoff,
  getNflSeasonContext,
};
