const {
  createGame,
  getGame,
  joinGame,
  startDraft,
  spinWheel,
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
        if (typeof callback === "function")
          callback({ game, playerNumber });
        broadcastGameState(io, gameId, updated);
      } catch (e) {
        if (typeof callback === "function")
          callback({ error: e.message || "Failed to join" });
      }
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
      if (!game || getPlayerNumber(game, socket.id) !== 1) {
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
      const pn = getPlayerNumber(game, socket.id);
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

    socket.on("cache_teams", ({ gameId, teams }) => {
      const game = getGame(gameId);
      if (game) game._teamsCache = teams;
    });

    socket.on(
      "pick",
      ({ playerId, playerName, position }, callback) => {
        const gameId = Array.from(socket.rooms).find(
          (r) => r !== socket.id && r.length === 8
        );
        if (!gameId) {
          if (typeof callback === "function")
            callback({ error: "Not in a game" });
          return;
        }
        const game = getGame(gameId);
        const pn = getPlayerNumber(game, socket.id);
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
          position
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
