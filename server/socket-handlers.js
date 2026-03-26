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

const reconnectTokens = new Map();

function generateReconnectToken() {
  return `${Math.random().toString(36).slice(2, 14)}${Math.random()
    .toString(36)
    .slice(2, 14)}`;
}

function getReconnectTokenRecord(gameId) {
  if (!reconnectTokens.has(gameId)) {
    reconnectTokens.set(gameId, { 1: null, 2: null });
  }
  return reconnectTokens.get(gameId);
}

function rotateReconnectToken(gameId, playerNumber) {
  const record = getReconnectTokenRecord(gameId);
  const reconnectToken = generateReconnectToken();
  record[playerNumber] = reconnectToken;
  return reconnectToken;
}

function getReconnectToken(gameId, playerNumber) {
  const record = getReconnectTokenRecord(gameId);
  return record[playerNumber] ?? null;
}

function isPlayerSocketActive(io, gameId, game, playerNumber) {
  const room = io.sockets.adapter.rooms.get(gameId);
  const socketId =
    playerNumber === 1 ? game.player1?.socketId : game.player2?.socketId;
  return Boolean(room && socketId && room.has(socketId));
}

function isGameRoomId(roomId) {
  return typeof roomId === "string" && roomId.length === 8;
}

function leaveOtherGameRooms(socket, keepGameId) {
  Array.from(socket.rooms).forEach((roomId) => {
    if (roomId === socket.id) return;
    if (!isGameRoomId(roomId)) return;
    if (keepGameId && roomId === keepGameId) return;
    socket.leave(roomId);
  });
}

// Prefer socket.data.playerNumber (set on join) over socket ID lookup.
// This survives socket ID mismatches (reconnects, same-browser testing, etc.)
function getPlayerNum(socket, game) {
  if (!game) return null;
  const dataNum = socket.data.playerNumber;
  if (
    socket.data.gameId === game.gameId &&
    (dataNum === 1 || dataNum === 2)
  ) {
    return dataNum;
  }
  return getPlayerNumber(game, socket.id);
}

function resolveGameForAction(socket, payloadGameId, callback) {
  const gameId = payloadGameId || socket.data.gameId || null;
  if (!gameId) {
    if (typeof callback === "function") callback({ error: "Missing game context" });
    return null;
  }
  const game = getGame(gameId);
  if (!game) {
    if (typeof callback === "function") callback({ error: "Game not found" });
    return null;
  }
  if (!socket.rooms.has(gameId)) {
    if (typeof callback === "function") callback({ error: "Not in this game" });
    return null;
  }
  const pn = getPlayerNum(socket, game);
  if (!pn) {
    if (typeof callback === "function") {
      callback({ error: "Player identity mismatch. Rejoin this game." });
    }
    return null;
  }
  return { gameId, game, pn };
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
        leaveOtherGameRooms(socket);
        const game = createGame();
        socket.join(game.gameId);
        const updated = joinGame(game.gameId, socket.id, 1);
        const reconnectToken = rotateReconnectToken(game.gameId, 1);
        socket.data.playerNumber = 1;
        socket.data.gameId = game.gameId;
        if (typeof callback === "function")
          callback({
            gameId: game.gameId,
            game: updated || game,
            playerNumber: 1,
            reconnectToken,
          });
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
      if (inRoom) {
        // Re-sync socket.data.playerNumber in case it was cleared (e.g. after
        // a hot-reload in dev or a brief reconnect that kept the socket in room)
        if (!socket.data.playerNumber) {
          const pNum = getPlayerNumber(game, socket.id);
          if (pNum) {
            socket.data.playerNumber = pNum;
            socket.data.gameId = gameId;
          }
        }
        if (typeof callback === "function") callback(game);
      } else if (typeof callback === "function") {
        callback(null);
      }
    });

    socket.on("join_game", ({ gameId, claimPlayerNumber, claimReconnectToken }, callback) => {
      try {
        const game = getGame(gameId);
        if (!game) {
          if (typeof callback === "function")
            callback({ error: "Game not found" });
          return;
        }
        if (game.player1 && game.player2) {
          // Full game: allow a reconnecting player to reclaim their slot using
          // the playerNumber plus a server-issued reconnect token.
          const claimNum = Number(claimPlayerNumber);
          const expectedToken =
            claimNum === 1 || claimNum === 2
              ? getReconnectToken(gameId, claimNum)
              : null;
          const playerSocketActive =
            claimNum === 1 || claimNum === 2
              ? isPlayerSocketActive(io, gameId, game, claimNum)
              : false;
          if (
            (claimNum === 1 || claimNum === 2) &&
            expectedToken &&
            claimReconnectToken === expectedToken &&
            !playerSocketActive
          ) {
            leaveOtherGameRooms(socket, gameId);
            socket.join(gameId);
            socket.data.playerNumber = claimNum;
            socket.data.gameId = gameId;
            if (claimNum === 1 && game.player1) game.player1.socketId = socket.id;
            if (claimNum === 2 && game.player2) game.player2.socketId = socket.id;
            const reconnectToken = rotateReconnectToken(gameId, claimNum);
            if (typeof callback === "function")
              callback({ game, playerNumber: claimNum, reconnectToken });
            broadcastGameState(io, gameId, game);
            return;
          }
          if (claimNum === 1 || claimNum === 2) {
            if (typeof callback === "function") {
              callback({ error: "Unable to reclaim player slot" });
            }
            return;
          }
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
        leaveOtherGameRooms(socket, gameId);
        socket.join(gameId);
        const reconnectToken = rotateReconnectToken(gameId, playerNumber);
        socket.data.playerNumber = playerNumber;
        socket.data.gameId = gameId;
        if (typeof callback === "function")
          callback({ game, playerNumber, reconnectToken });
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
      if (!socket.rooms.has(gameId)) {
        if (typeof callback === "function") callback({ error: "Not in this game" });
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
      if (!socket.rooms.has(gameId)) {
        if (typeof callback === "function") callback({ error: "Not in this game" });
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

    socket.on("start_draft", (payload, callback) => {
      const cb = typeof payload === "function" ? payload : callback;
      const payloadGameId =
        payload && typeof payload === "object" ? payload.gameId : null;
      const ctx = resolveGameForAction(socket, payloadGameId, cb);
      if (!ctx) return;
      const { gameId, game, pn } = ctx;
      if (pn !== 1) {
        if (typeof cb === "function") cb({ error: "Only player 1 can start" });
        return;
      }
      const updated = startDraft(gameId);
      if (!updated) {
        if (typeof cb === "function") cb({ error: "Could not start draft" });
        return;
      }
      if (typeof cb === "function") cb({ game: updated });
      broadcastGameState(io, gameId, updated);
    });

    socket.on("spin", (result, callback) => {
      const payloadGameId =
        result && typeof result === "object" ? result.gameId : null;
      const ctx = resolveGameForAction(socket, payloadGameId, callback);
      if (!ctx) return;
      const { gameId, game, pn } = ctx;
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

    socket.on("respin", (payload, callback) => {
      const payloadGameId =
        payload && typeof payload === "object" ? payload.gameId : null;
      const ctx = resolveGameForAction(socket, payloadGameId, callback);
      if (!ctx) return;
      const { gameId, game, pn } = ctx;
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

    socket.on("spin_started", ({ gameId: payloadGameId, targetDisplayRotation }) => {
      const game = getGame(payloadGameId);
      if (!game || game.phase !== "drafting") return;
      if (!socket.rooms.has(payloadGameId)) return;
      const pn = getPlayerNum(socket, game);
      if (!pn || game.currentTurn !== pn) return;
      socket.to(payloadGameId).emit("spin_started", { targetDisplayRotation });
    });

    socket.on("cache_teams", ({ gameId, teams }) => {
      const game = getGame(gameId);
      if (game) game._teamsCache = teams;
    });

    socket.on(
      "pick",
      (payload, callback) => {
        const {
          playerId,
          playerName,
          position,
          teamId,
          naturalPosition,
          gameId: payloadGameId,
        } = payload || {};
        const ctx = resolveGameForAction(socket, payloadGameId, callback);
        if (!ctx) return;
        const { gameId, game, pn } = ctx;
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
          teamId,
          naturalPosition
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

    socket.on("leave_game", ({ gameId }, callback) => {
      const targetGameId =
        typeof gameId === "string" && gameId.length === 8
          ? gameId
          : socket.data.gameId;
      if (targetGameId && socket.rooms.has(targetGameId)) {
        socket.leave(targetGameId);
      }
      if (socket.data.gameId === targetGameId) {
        delete socket.data.gameId;
        delete socket.data.playerNumber;
      }
      if (typeof callback === "function") callback({ ok: true });
    });

    socket.on("simulation_started", ({ gameId }) => {
      io.to(gameId).emit("simulation_started");
    });

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
      // Re-sync socket.data.playerNumber and game socket IDs for all sockets
      // currently in the room. This handles cases where a socket reconnected
      // mid-game (new socket ID, cleared socket.data) so player identity is
      // correctly preserved for the rematch.
      const room = io.sockets.adapter.rooms.get(gameId);
      if (room) {
        room.forEach((sid) => {
          const s = io.sockets.sockets.get(sid);
          if (!s) return;
          const pNum = s.data.playerNumber ?? getPlayerNumber(updated, sid);
          if (pNum === 1) {
            s.data.playerNumber = 1;
            if (updated.player1) updated.player1.socketId = sid;
          } else if (pNum === 2) {
            s.data.playerNumber = 2;
            if (updated.player2) updated.player2.socketId = sid;
          }
        });
      }
      if (typeof callback === "function") callback({ game: updated });
      broadcastGameState(io, gameId, updated);
    });
  });
}

module.exports = { registerSocketHandlers };
