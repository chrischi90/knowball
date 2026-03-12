/**
 * In-memory game state store. Keyed by gameId.
 */

const POSITIONS = ["PG", "SG", "SF", "PF", "C"];

function createEmptyRosterJS() {
  const roster = {};
  POSITIONS.forEach((p) => {
    roster[p] = { position: p, playerId: null, playerName: null, teamId: null, naturalPosition: null };
  });
  return roster;
}

function generateGameId() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

/** @type {Map<string, GameState>} */
const games = new Map();

/**
 * @returns {GameState}
 */
function createGame() {
  const gameId = generateGameId();
  const state = {
    gameId,
    phase: "lobby",
    gameMode: "all_time",
    firstDrafter: 1,
    player1: null,
    player2: null,
    currentTurn: 1,
    wheelTeamId: null,
    wheelTeamName: null,
    rosters: { 1: createEmptyRosterJS(), 2: createEmptyRosterJS() },
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
  if (!roster[position] || roster[position].playerId) return null;

  roster[position] = { position, playerId, playerName, teamId: teamId ?? null, naturalPosition: naturalPosition ?? null };
  game.takenPlayerIds.push(playerId);
  game.wheelTeamId = null;
  game.wheelTeamName = null;
  game.currentTurn = playerNumber === 1 ? 2 : 1;

  const p1Full =
    POSITIONS.every((p) => game.rosters[1][p].playerId) ?? false;
  const p2Full =
    POSITIONS.every((p) => game.rosters[2][p].playerId) ?? false;
  if (p1Full && p2Full) {
    game.phase = "simulation";
  }
  return game;
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
  game.rosters = { 1: createEmptyRosterJS(), 2: createEmptyRosterJS() };
  game.takenPlayerIds = [];
  game.simulationResult = null;
  game.firstDrafter = null;
  return game;
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
  setSimulationResult,
  rematchGame,
  POSITIONS,
};
