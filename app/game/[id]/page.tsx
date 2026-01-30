"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { getSocket } from "@/lib/socket";
import type { GameState } from "@/lib/game-types";
import type { NBATeam } from "@/lib/nba-api";
import { Wheel } from "@/components/Wheel";
import { PlayerList } from "@/components/PlayerList";
import { RosterGrid } from "@/components/RosterGrid";
import { SimulationResult } from "@/components/SimulationResult";

export default function GamePage() {
  const params = useParams();
  const router = useRouter();
  const gameId = params.id as string;
  const [game, setGame] = useState<GameState | null>(null);
  const [playerNumber, setPlayerNumber] = useState<1 | 2 | null>(null);
  const [teams, setTeams] = useState<NBATeam[]>([]);
  const [teamsLoaded, setTeamsLoaded] = useState(false);
  const [error, setError] = useState("");

  // Load teams once for wheel
  useEffect(() => {
    fetch("/api/teams")
      .then((r) => r.json())
      .then((data) => {
        if (data.teams) {
          setTeams(data.teams);
          setTeamsLoaded(true);
          const socket = getSocket();
          socket.emit("cache_teams", { gameId, teams: data.teams });
        }
      })
      .catch(() => setError("Failed to load teams"));
  }, [gameId]);

  // Socket: game_state and wheel_result
  useEffect(() => {
    const socket = getSocket();
    const onState = (state: GameState) => setGame(state);
    const onWheel = () => {
      setGame((g) => (g ? { ...g } : null));
    };
    socket.on("game_state", onState);
    socket.on("wheel_result", onWheel);

    const inRoom = gameId && gameId.length === 8;
    if (inRoom && !game) {
      socket.emit("get_state", { gameId }, (state: GameState | null) => {
        if (state) {
          setGame(state);
          if (state.player1?.socketId === socket.id) setPlayerNumber(1);
          else if (state.player2?.socketId === socket.id) setPlayerNumber(2);
        } else {
          socket.emit("join_game", { gameId }, (res: { game?: GameState; playerNumber?: number; error?: string }) => {
            if (res.game) {
              setGame(res.game);
              if (res.playerNumber) setPlayerNumber(res.playerNumber as 1 | 2);
            } else if (res.error && res.error !== "Game not found") {
              setError(res.error);
            }
          });
        }
      });
    }

    return () => {
      socket.off("game_state", onState);
      socket.off("wheel_result", onWheel);
    };
  }, [gameId]);

  const handleStartDraft = useCallback(() => {
    const socket = getSocket();
    socket.emit("start_draft", (res: { game?: GameState; error?: string }) => {
      if (res.game) setGame(res.game);
      if (res.error) setError(res.error);
    });
  }, []);

  const handleSpin = useCallback((result: { teamIndex: number; teamId: string; teamName: string }) => {
    const socket = getSocket();
    socket.emit("spin", result, (res: { game?: GameState; error?: string }) => {
      if (res.error) setError(res.error);
      if (res.game) setGame(res.game);
    });
  }, []);

  const handlePick = useCallback((playerId: string, playerName: string, position: string) => {
    const socket = getSocket();
    socket.emit(
      "pick",
      { playerId, playerName, position },
      (res: { game?: GameState; error?: string }) => {
        if (res.error) setError(res.error);
        if (res.game) setGame(res.game);
      }
    );
  }, []);

  const handleRunSimulation = useCallback(async () => {
    if (!game) return;
    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roster1: game.rosters[1],
          roster2: game.rosters[2],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Simulation failed");
      const socket = getSocket();
      socket.emit("simulation_result", { gameId, result: data });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Simulation failed");
    }
  }, [game, gameId]);

  const handleRematch = useCallback(() => {
    const socket = getSocket();
    socket.emit("rematch", { gameId }, (res: { game?: GameState; error?: string }) => {
      if (res.error) setError(res.error);
      if (res.game) setGame(res.game);
    });
  }, [gameId]);

  if (!gameId) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 bg-slate-900 text-white">
        <p>Invalid game.</p>
      </main>
    );
  }

  if (!game) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-4 bg-slate-900 text-white">
        <p className="text-slate-400">Connecting to game…</p>
        {error && <p className="mt-2 text-red-400 text-sm">{error}</p>}
        <button
          type="button"
          onClick={() => router.push("/")}
          className="mt-6 text-slate-500 hover:text-white"
        >
          Back to lobby
        </button>
      </main>
    );
  }

  const isPlayer1 = game.player1?.socketId === getSocket().id;
  const isPlayer2 = game.player2?.socketId === getSocket().id;
  const myNumber = isPlayer1 ? 1 : isPlayer2 ? 2 : null;
  const canStart = game.phase === "lobby" && isPlayer1 && game.player1 && game.player2;
  const isMyTurn = game.phase === "drafting" && myNumber === game.currentTurn && !game.wheelTeamId;
  const showWheel = game.phase === "drafting" && teams.length > 0;
  const showPick = game.phase === "drafting" && game.wheelTeamId && game.currentTurn === myNumber;
  const bothFull =
    game.phase === "drafting" &&
    [1, 2].every((p) =>
      ["PG", "SG", "SF", "PF", "C"].every(
        (pos) => game.rosters[p as 1 | 2][pos as keyof typeof game.rosters[1]].playerId
      )
    );
  const showSimulate = game.phase === "simulation" || (bothFull && game.phase === "drafting");
  const completed = game.phase === "completed";

  return (
    <main className="min-h-screen bg-slate-900 text-white p-4 pb-8">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-4">
          <span className="text-slate-400 text-sm">Game: {gameId}</span>
          {myNumber && (
            <span className="text-orange-400 font-medium">You are Player {myNumber}</span>
          )}
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-900/50 text-red-200 text-sm">
            {error}
          </div>
        )}

        {game.phase === "lobby" && (
          <div className="rounded-xl bg-slate-800 p-6 mb-6">
            <p className="text-slate-300 mb-4">
              Share this code with the other player:{" "}
              <strong className="text-xl tracking-widest">{gameId}</strong>
            </p>
            <p className="text-slate-400 text-sm mb-4">
              {game.player2 ? "Both players connected." : "Waiting for player 2…"}
            </p>
            {canStart && (
              <button
                type="button"
                onClick={handleStartDraft}
                className="w-full py-4 rounded-xl bg-orange-600 hover:bg-orange-500 font-semibold"
              >
                Start Draft
              </button>
            )}
          </div>
        )}

        {showWheel && (
          <div className="mb-6">
            <Wheel
              teams={teams}
              currentTeamId={game.wheelTeamId}
              isMyTurn={isMyTurn}
              gameId={gameId}
              onSpin={handleSpin}
            />
          </div>
        )}

        {showPick && game.wheelTeamId && (
          <div className="mb-6">
            <PlayerList
              teamId={game.wheelTeamId}
              teamName={game.wheelTeamName || ""}
              takenPlayerIds={game.takenPlayerIds}
              currentRoster={game.rosters[myNumber!]}
              onPick={handlePick}
            />
          </div>
        )}

        <RosterGrid
          roster1={game.rosters[1]}
          roster2={game.rosters[2]}
          playerNumber={myNumber}
        />

        {showSimulate && game.phase === "simulation" && (
          <div className="mt-6">
            <button
              type="button"
              onClick={handleRunSimulation}
              className="w-full py-4 rounded-xl bg-green-600 hover:bg-green-500 font-semibold"
            >
              Run Simulation
            </button>
          </div>
        )}

        {completed && game.simulationResult && (
          <SimulationResult
            result={game.simulationResult}
            roster1={game.rosters[1]}
            roster2={game.rosters[2]}
            gameId={gameId}
            onRematch={handleRematch}
          />
        )}
      </div>
    </main>
  );
}
