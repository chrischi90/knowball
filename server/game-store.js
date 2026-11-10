/**
 * In-memory game state store. Keyed by gameId.
 */

const nflRules = require("../lib/nfl-rules.js");

const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
const SPORTS = ["nba", "nfl"];

function createEmptyRosterJS() {
  const roster = {};
  POSITIONS.forEach((p) => {
    roster[p] = { position: p, playerId: null, playerName: null, teamId: null, naturalPosition: null };
  });
  return roster;
}

function createEmptyRosterFor(sport) {
  return sport === "nfl" ? nflRules.createEmptyNflRoster() : createEmptyRosterJS();
}

function isRosterFull(sport, roster) {
  if (sport === "nfl") return nflRules.isNflRosterComplete(roster);
  return POSITIONS.every((p) => roster[p].playerId);
}

function generateGameId() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

/** @type {Map<string, GameState>} */
const games = new Map();

/**
 * @returns {GameState}
 */
function createGame(sport = "nba") {
  const gameId = generateGameId();
  const resolvedSport = SPORTS.includes(sport) ? sport : "nba";
  const state = {
    gameId,
    sport: resolvedSport,
    phase: "lobby",
    gameMode: "all_time",
    firstDrafter: 1,
    player1: null,
    player2: null,
    currentTurn: 1,
    wheelTeamId: null,
    wheelTeamName: null,
    rosters: { 1: createEmptyRosterFor(resolvedSport), 2: createEmptyRosterFor(resolvedSport) },
    takenPlayerIds: [],
    simulationResult: null,
  };
  games.set(gameId, state);
  return state;
}

function getGame(gameId) {
  return games.get(gameId) || null;
}

function joinGame(gameId, socketId, playerNumber) {
  const game = games.get(gameId);
  if (!game || game.phase !== "lobby") return null;
  if (playerNumber === 1) {
    if (game.player1) return null;
    game.player1 = { socketId };
  } else {
    if (game.player2) return null;
    game.player2 = { socketId };
  }
  return game;
}

function setGameMode(gameId, gameMode) {
  const game = games.get(gameId);
  if (!game || game.phase !== "lobby") return null;
  if (gameMode !== "all_time" && gameMode !== "active_only") return null;
  game.gameMode = gameMode;
  return game;
}

function setFirstDrafter(gameId, playerNumber) {
  const game = games.get(gameId);
  if (!game || game.phase !== "lobby") return null;
  if (playerNumber !== 1 && playerNumber !== 2) return null;
  game.firstDrafter = playerNumber;
  return game;
}

function startDraft(gameId) {
  const game = games.get(gameId);
  if (!game || game.phase !== "lobby" || !game.player1 || !game.player2)
    return null;
  game.phase = "drafting";
  game.currentTurn = game.firstDrafter || 1;
  return game;
}

function spinWheel(gameId, teamId, teamName) {
  const game = games.get(gameId);
  if (!game || game.phase !== "drafting") return null;
  game.wheelTeamId = teamId;
  game.wheelTeamName = teamName;
  return game;
}

function pickPlayer(gameId, playerNumber, playerId, playerName, position, teamId, naturalPosition) {
  const game = games.get(gameId);
  if (!game || game.phase !== "drafting") return null;
  if (game.currentTurn !== playerNumber) return null;
  if (game.takenPlayerIds.includes(playerId)) return null;
  const roster = game.rosters[playerNumber];
  if (game.sport === "nfl") {
    const err = nflRules.validateNflPlayerPick({
      roster,
      slot: position,
      player: { id: playerId, position: nflRules.normalizeNflPosition(naturalPosition) },
      takenPlayerIds: game.takenPlayerIds,
    });
    if (err) return null;
    roster[position] = { slot: position, playerId, playerName, teamId: teamId ?? null, naturalPosition: naturalPosition ?? null };
  } else {
    if (!roster[position] || roster[position].playerId) return null;
    roster[position] = { position, playerId, playerName, teamId: teamId ?? null, naturalPosition: naturalPosition ?? null };
  }
  game.takenPlayerIds.push(playerId);
  return finishTurn(game, playerNumber);
}

function finishTurn(game, playerNumber) {
  game.wheelTeamId = null;
  game.wheelTeamName = null;
  game.currentTurn = playerNumber === 1 ? 2 : 1;
  if (isRosterFull(game.sport, game.rosters[1]) && isRosterFull(game.sport, game.rosters[2])) {
    game.phase = "simulation";
  }
  return game;
}

/**
 * NFL: lock the landed team's defense into TEAM_DEF. Returns { game } or { error }.
 * active_only must use the current stats season; all_time may pick any season from
 * NFL_ALL_TIME_START_SEASON to the current one (the sim rejects seasons with no data).
 * In 2-player games, a team's defense can only be locked by one player (any season).
 */
function lockDefense(gameId, playerNumber, season, now = new Date()) {
  const game = games.get(gameId);
  if (!game || game.sport !== "nfl" || game.phase !== "drafting") return { error: "Invalid game" };
  if (game.currentTurn !== playerNumber) return { error: "Not your turn" };
  const ctx = nflRules.getNflSeasonContext(now);
  const available = [];
  for (let s = nflRules.NFL_ALL_TIME_START_SEASON; s <= ctx.season; s++) available.push(s);
  const error = nflRules.validateTeamDefensePick({
    roster: game.rosters[playerNumber],
    opponentRoster: game.rosters[playerNumber === 1 ? 2 : 1],
    teamId: game.wheelTeamId,
    wheelTeamId: game.wheelTeamId,
    season,
    gameMode: game.gameMode,
    activeSeason: ctx.statsSeason,
    availableSeasons: available,
  });
  if (error) return { error };
  game.rosters[playerNumber].TEAM_DEF = {
    slot: "TEAM_DEF",
    teamId: game.wheelTeamId,
    teamName: game.wheelTeamName,
    season,
  };
  return { game: finishTurn(game, playerNumber) };
}

function setSimulationResult(gameId, result) {
  const game = games.get(gameId);
  if (!game) return null;
  game.simulationResult = result;
  game.phase = "completed";
  return game;
}

function clearWheelTeam(gameId) {
  const game = games.get(gameId);
  if (!game || game.phase !== "drafting") return null;
  game.wheelTeamId = null;
  game.wheelTeamName = null;
  return game;
}

function rematchGame(gameId) {
  const game = games.get(gameId);
  if (!game || !game.player1 || !game.player2) return null;
  // Reset game state but keep players (keep gameMode)
  game.phase = "lobby";
  game.currentTurn = 1;
  game.wheelTeamId = null;
  game.gameMode = game.gameMode || "all_time";
  game.wheelTeamName = null;
  game.rosters = { 1: createEmptyRosterFor(game.sport), 2: createEmptyRosterFor(game.sport) };
  game.takenPlayerIds = [];
  game.simulationResult = null;
  game.firstDrafter = null;
  return game;
}

function deleteGame(gameId) {
  games.delete(gameId);
}

function getGameCount() {
  return games.size;
}

module.exports = {
  createGame,
  getGame,
  joinGame,
  setGameMode,
  setFirstDrafter,
  startDraft,
  spinWheel,
  clearWheelTeam,
  pickPlayer,
  lockDefense,
  setSimulationResult,
  rematchGame,
  deleteGame,
  getGameCount,
  POSITIONS,
};
