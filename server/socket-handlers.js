const {
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
} = require("./game-store.js");

function getPlayerNumber(game, socketId) {
  if (game.player1?.socketId === socketId) return 1;
  if (game.player2?.socketId === socketId) return 2;
  return null;
}

// Prefer socket.data.playerNumber (set on join) over socket ID lookup.
// This survives socket ID mismatches (reconnects, same-browser testing, etc.)
function getPlayerNum(socket, game) {
  return socket.data.playerNumber ?? getPlayerNumber(game, socket.id);
}

function broadcastGameState(io, gameId, game) {
  const room = io.sockets.adapter.rooms.get(gameId);
  if (room) {
    room.forEach((sid) => {
      io.to(sid).emit("game_state", game);
    });
  }
}

function registerSocketHandlers(io) {
  io.on("connection", (socket) => {
    socket.on("create_game", (callback) => {
      try {
        const game = createGame();
        socket.join(game.gameId);
        const updated = joinGame(game.gameId, socket.id, 1);
        socket.data.playerNumber = 1;
        socket.data.gameId = game.gameId;
        if (typeof callback === "function")
          callback({ gameId: game.gameId, game: updated || game });
        broadcastGameState(io, game.gameId, updated || game);
      } catch (e) {
        if (typeof callback === "function")
          callback({ error: e.message || "Failed to create game" });
      }
    });

    socket.on("get_state", ({ gameId }, callback) => {
      const game = getGame(gameId);
      if (!game) {
        if (typeof callback === "function") callback(null);
        return;
      }
      const inRoom = socket.rooms.has(gameId);
      if (inRoom && typeof callback === "function") callback(game);
    });

    socket.on("join_game", ({ gameId }, callback) => {
      try {
        const game = getGame(gameId);
        if (!game) {
          if (typeof callback === "function")
            callback({ error: "Game not found" });
          return;
        }
        if (game.player1 && game.player2) {
          if (typeof callback === "function")
            callback({ error: "Game is full" });
          return;
        }
        const playerNumber = game.player1 ? 2 : 1;
        const updated = joinGame(gameId, socket.id, playerNumber);
        if (!updated) {
          if (typeof callback === "function")
            callback({ error: "Could not join game" });
          return;
        }
        socket.join(gameId);
        socket.data.playerNumber = playerNumber;
        socket.data.gameId = gameId;
        if (typeof callback === "function")
          callback({ game, playerNumber });
        broadcastGameState(io, gameId, updated);
      } catch (e) {
        if (typeof callback === "function")
          callback({ error: e.message || "Failed to join" });
      }
    });

    socket.on("set_game_mode", ({ gameId, gameMode }, callback) => {
      const game = getGame(gameId);
      if (!game || game.phase !== "lobby") {
        if (typeof callback === "function")
          callback({ error: "Game not in lobby" });
        return;
      }
      if (getPlayerNum(socket, game) !== 1) {
        if (typeof callback === "function")
          callback({ error: "Only player 1 can set game mode" });
        return;
      }
      const updated = setGameMode(gameId, gameMode);
      if (!updated) {
        if (typeof callback === "function")
          callback({ error: "Could not set game mode" });
        return;
      }
      if (typeof callback === "function") callback({ game: updated });
      broadcastGameState(io, gameId, updated);
    });

    socket.on("set_first_drafter", ({ gameId, playerNumber }, callback) => {
      const game = getGame(gameId);
      if (!game || game.phase !== "lobby") {
        if (typeof callback === "function")
          callback({ error: "Game not in lobby" });
        return;
      }
      if (getPlayerNum(socket, game) !== 1) {
        if (typeof callback === "function")
          callback({ error: "Only player 1 can set draft order" });
        return;
      }
      const updated = setFirstDrafter(gameId, playerNumber);
      if (!updated) {
        if (typeof callback === "function")
          callback({ error: "Could not set draft order" });
        return;
      }
      if (typeof callback === "function") callback({ game: updated });
      broadcastGameState(io, gameId, updated);
    });

    socket.on("start_draft", (callback) => {
      const gameId = Array.from(socket.rooms).find(
        (r) => r !== socket.id && r.length === 8
      );
      if (!gameId) {
        if (typeof callback === "function") callback({ error: "Not in a game" });
        return;
      }
      const game = getGame(gameId);
      if (!game || getPlayerNum(socket, game) !== 1) {
        if (typeof callback === "function")
          callback({ error: "Only player 1 can start" });
        return;
      }
      const updated = startDraft(gameId);
      if (!updated) {
        if (typeof callback === "function")
          callback({ error: "Could not start draft" });
        return;
      }
      if (typeof callback === "function") callback({ game: updated });
      broadcastGameState(io, gameId, updated);
    });

    socket.on("spin", (result, callback) => {
      const gameId = Array.from(socket.rooms).find(
        (r) => r !== socket.id && r.length === 8
      );
      if (!gameId) {
        if (typeof callback === "function") callback({ error: "Not in a game" });
        return;
      }
      const game = getGame(gameId);
      const pn = getPlayerNum(socket, game);
      if (!game || game.phase !== "drafting" || game.currentTurn !== pn) {
        if (typeof callback === "function")
          callback({ error: "Not your turn or invalid phase" });
        return;
      }
      if (game.wheelTeamId) {
        if (typeof callback === "function")
          callback({ error: "Pick a player first" });
        return;
      }
      // Client sends the result from the wheel spin
      const { teamId, teamName } = result;
      if (!teamId || !teamName) {
        if (typeof callback === "function")
          callback({ error: "Invalid spin result" });
        return;
      }
      const updated = spinWheel(gameId, teamId, teamName);
      if (!updated) {
        if (typeof callback === "function")
          callback({ error: "Could not spin" });
        return;
      }
      // Broadcast to other players so they see the result
      socket.to(gameId).emit("wheel_result", {
        teamId,
        teamName,
      });
      if (typeof callback === "function")
        callback({
          game: updated,
        });
      broadcastGameState(io, gameId, updated);
    });

    socket.on("respin", (_, callback) => {
      const gameId = Array.from(socket.rooms).find(
        (r) => r !== socket.id && r.length === 8
      );
      if (!gameId) {
        if (typeof callback === "function") callback({ error: "Not in a game" });
        return;
      }
      const game = getGame(gameId);
      const pn = getPlayerNum(socket, game);
      if (!game || game.phase !== "drafting" || game.currentTurn !== pn) {
        if (typeof callback === "function")
          callback({ error: "Not your turn or invalid phase" });
        return;
      }
      const updated = clearWheelTeam(gameId);
      if (!updated) {
        if (typeof callback === "function") callback({ error: "Could not respin" });
        return;
      }
      if (typeof callback === "function") callback({ game: updated });
      broadcastGameState(io, gameId, updated);
    });

    socket.on("cache_teams", ({ gameId, teams }) => {
      const game = getGame(gameId);
      if (game) game._teamsCache = teams;
    });

    socket.on(
      "pick",
      ({ playerId, playerName, position, teamId }, callback) => {
        const gameId = Array.from(socket.rooms).find(
          (r) => r !== socket.id && r.length === 8
        );
        if (!gameId) {
          if (typeof callback === "function")
            callback({ error: "Not in a game" });
          return;
        }
        const game = getGame(gameId);
        const pn = getPlayerNum(socket, game);
        if (!game || game.phase !== "drafting" || game.currentTurn !== pn) {
          if (typeof callback === "function")
            callback({ error: "Not your turn" });
          return;
        }
        if (!POSITIONS.includes(position)) {
          if (typeof callback === "function")
            callback({ error: "Invalid position" });
          return;
        }
        const updated = pickPlayer(
          gameId,
          pn,
          playerId,
          playerName,
          position,
          teamId
        );
        if (!updated) {
          if (typeof callback === "function")
            callback({ error: "Invalid pick (player taken or slot filled)" });
          return;
        }
        if (typeof callback === "function") callback({ game: updated });
        broadcastGameState(io, gameId, updated);
      }
    );

    socket.on("simulation_result", ({ gameId, result }) => {
      const game = getGame(gameId);
      if (!game) return;
      const updated = setSimulationResult(gameId, result);
      if (updated) broadcastGameState(io, gameId, updated);
    });

    socket.on("rematch", ({ gameId }, callback) => {
      const game = getGame(gameId);
      if (!game) {
        if (typeof callback === "function")
          callback({ error: "Game not found" });
        return;
      }
      const updated = rematchGame(gameId);
      if (!updated) {
        if (typeof callback === "function")
          callback({ error: "Could not start rematch" });
        return;
      }
      if (typeof callback === "function") callback({ game: updated });
      broadcastGameState(io, gameId, updated);
    });
  });
}

module.exports = { registerSocketHandlers };
