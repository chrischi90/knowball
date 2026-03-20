type PersistSessionOptions = {
  playerNumber?: number | null;
  reconnectToken?: string | null;
};

function getPlayerNumberKey(gameId: string) {
  return `knowball:${gameId}:player`;
}

function getReconnectTokenKey(gameId: string) {
  return `knowball:${gameId}:reconnect`;
}

export function persistMultiplayerSession(
  gameId: string,
  options: PersistSessionOptions
) {
  if (typeof window === "undefined") return;

  if (options.playerNumber !== undefined) {
    if (options.playerNumber === null) {
      sessionStorage.removeItem(getPlayerNumberKey(gameId));
    } else {
      sessionStorage.setItem(
        getPlayerNumberKey(gameId),
        options.playerNumber.toString()
      );
    }
  }

  if (options.reconnectToken !== undefined) {
    if (!options.reconnectToken) {
      sessionStorage.removeItem(getReconnectTokenKey(gameId));
    } else {
      sessionStorage.setItem(getReconnectTokenKey(gameId), options.reconnectToken);
    }
  }
}

export function readMultiplayerSession(gameId: string) {
  if (typeof window === "undefined") {
    return { playerNumber: undefined, reconnectToken: undefined };
  }

  const rawPlayerNumber = sessionStorage.getItem(getPlayerNumberKey(gameId));
  const playerNumber = rawPlayerNumber ? parseInt(rawPlayerNumber, 10) : undefined;
  const reconnectToken =
    sessionStorage.getItem(getReconnectTokenKey(gameId)) || undefined;

  return {
    playerNumber: Number.isFinite(playerNumber) ? playerNumber : undefined,
    reconnectToken,
  };
}