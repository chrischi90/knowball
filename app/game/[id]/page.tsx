"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { getSocket } from "@/lib/socket";
import type { GameState, GameMode } from "@/lib/game-types";
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
  const [copied, setCopied] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);

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

  const handleSetGameMode = useCallback((gameMode: GameMode) => {
    setGame((g) => g ? { ...g, gameMode } : null);
    const socket = getSocket();
    socket.emit("set_game_mode", { gameId, gameMode }, (res: { game?: GameState; error?: string }) => {
      if (res.game) setGame(res.game);
      if (res.error) setError(res.error);
    });
  }, [gameId]);

  const handleSetFirstDrafter = useCallback((playerNumber: 1 | 2) => {
    setGame((g) => g ? { ...g, firstDrafter: playerNumber } : null);
    const socket = getSocket();
    socket.emit("set_first_drafter", { gameId, playerNumber }, (res: { game?: GameState; error?: string }) => {
      if (res.game) setGame(res.game);
      if (res.error) setError(res.error);
    });
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

  const handleRespin = useCallback(() => {
    const socket = getSocket();
    socket.emit("respin", null, (res: { game?: GameState; error?: string }) => {
      if (res.error) setError(res.error);
      if (res.game) setGame(res.game);
    });
  }, []);

  const handlePick = useCallback((playerId: string, playerName: string, position: string, teamId: string) => {
    const abbrev = teams.find((t) => t.id === teamId)?.abbreviation;
    const displayName = abbrev ? `${playerName} (${abbrev})` : playerName;
    const socket = getSocket();
    socket.emit(
      "pick",
      { playerId, playerName: displayName, position, teamId },
      (res: { game?: GameState; error?: string }) => {
        if (res.error) setError(res.error);
        if (res.game) setGame(res.game);
      }
    );
  }, [teams]);

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

  const handleCopyCode = useCallback(async () => {
    if (!gameId) return;
    try {
      await navigator.clipboard.writeText(gameId);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = gameId;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand("copy");
      } finally {
        document.body.removeChild(ta);
      }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }, [gameId]);

  if (!gameId) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 bg-black text-white">
        <p>Invalid game.</p>
      </main>
    );
  }

  if (!game) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-4 bg-black text-white">
        <p className="text-zinc-400">Connecting to game…</p>
        {error && <p className="mt-2 text-red-400 text-sm">{error}</p>}
        <button
          type="button"
          onClick={() => router.push("/")}
          className="mt-6 text-zinc-500 hover:text-white"
        >
          Back to lobby
        </button>
      </main>
    );
  }

  const isPlayer1 = playerNumber === 1;
  const myNumber = playerNumber;
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
    <main className="min-h-screen bg-black text-white p-4 pb-8">
      {showLeaveModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
          aria-modal="true"
          role="dialog"
          aria-labelledby="leave-modal-title"
        >
          <div className="rounded-lg bg-zinc-900 border border-zinc-700 p-6 w-full max-w-sm shadow-xl">
            <h2 id="leave-modal-title" className="font-funnel-display text-xl font-semibold text-white mb-4">
              Are you sure you want to leave this game?
            </h2>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowLeaveModal(false)}
                className="px-4 py-2.5 rounded-md bg-zinc-700 hover:bg-zinc-600 text-white font-medium transition"
              >
                No
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowLeaveModal(false);
                  router.push("/");
                }}
                className="px-4 py-2.5 rounded-md bg-red-600 hover:bg-red-500 text-white font-medium transition"
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-4">
          <span className="text-zinc-400 text-sm">Game: {gameId}</span>
          {myNumber && (
            <button
              type="button"
              onClick={() => setShowLeaveModal(true)}
              className="font-funnel-display text-white text-lg font-medium hover:text-zinc-300 transition text-left"
            >
              Knowball
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-md bg-red-900/50 text-red-200 text-sm">
            {error}
          </div>
        )}

        {game.phase === "lobby" && (
          <div className="rounded-lg bg-zinc-900 p-6 mb-6">
            {!game.player2 ? (
              <>
                <p className="text-zinc-300 mb-4">
                  Share this code with the other player:
                </p>
                <div className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/80 px-4 py-3 mb-4">
                  <strong className="font-funnel-display text-xl tracking-widest">{gameId}</strong>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="inline-flex items-center justify-center h-8 w-8 rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition focus:outline-none focus:ring-2 focus:ring-orange-500 shrink-0"
                    aria-label="Copy game code to clipboard"
                    title={copied ? "Copied!" : "Copy to clipboard"}
                  >
                    {copied ? (
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2M8 5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V5Z"
                        />
                      </svg>
                    )}
                  </button>
                </div>
                <p className="text-zinc-400 text-sm">Waiting for player 2…</p>
              </>
            ) : (
              <>
                <h3 className="font-funnel-display text-lg font-semibold text-white mb-3">Game Mode</h3>
                <p className="text-zinc-400 text-sm mb-4">
                  Choose whether to draft from all players (including retired) or active players only.
                </p>
                <p className="text-zinc-400 text-sm mb-4 leading-relaxed">
                  <span className="font-bold">NOTE:</span> In All-Time mode, a player&apos;s stats are based only on their time with the drafted team — not their full career.
                </p>
                <div className={`relative flex rounded-full border border-zinc-700 p-1 mb-6${myNumber !== 1 ? " opacity-70" : ""}`}>
                  <div className={`pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-orange-600 transition-transform duration-200 ease-in-out${(game.gameMode ?? "all_time") === "active_only" ? " translate-x-full" : ""}`} />
                  <button
                    type="button"
                    onClick={() => handleSetGameMode("all_time")}
                    disabled={myNumber !== 1}
                    className={`relative z-10 flex-1 py-1.5 px-4 text-sm font-medium transition-colors duration-200 ${(game.gameMode ?? "all_time") === "all_time" ? "text-white" : "text-zinc-400"} ${myNumber !== 1 ? "cursor-default" : ""}`}
                  >
                    All-Time
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSetGameMode("active_only")}
                    disabled={myNumber !== 1}
                    className={`relative z-10 flex-1 py-1.5 px-4 text-sm font-medium transition-colors duration-200 ${(game.gameMode ?? "all_time") === "active_only" ? "text-white" : "text-zinc-400"} ${myNumber !== 1 ? "cursor-default" : ""}`}
                  >
                    Active Only
                  </button>
                </div>
                <h3 className="font-funnel-display text-lg font-semibold text-white mb-3">Draft Order</h3>
                <p className="text-zinc-400 text-sm mb-4">
                  Choose which player picks first.
                </p>
                <div className={`relative flex rounded-full border border-zinc-700 p-1 mb-6${myNumber !== 1 ? " opacity-70" : ""}`}>
                  <div className={`pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-orange-600 transition-transform duration-200 ease-in-out${(game.firstDrafter ?? 1) === 2 ? " translate-x-full" : ""}`} />
                  <button
                    type="button"
                    onClick={() => handleSetFirstDrafter(1)}
                    disabled={myNumber !== 1}
                    className={`relative z-10 flex-1 py-1.5 px-4 text-sm font-medium transition-colors duration-200 ${(game.firstDrafter ?? 1) === 1 ? "text-white" : "text-zinc-400"} ${myNumber !== 1 ? "cursor-default" : ""}`}
                  >
                    Player 1
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSetFirstDrafter(2)}
                    disabled={myNumber !== 1}
                    className={`relative z-10 flex-1 py-1.5 px-4 text-sm font-medium transition-colors duration-200 ${(game.firstDrafter ?? 1) === 2 ? "text-white" : "text-zinc-400"} ${myNumber !== 1 ? "cursor-default" : ""}`}
                  >
                    Player 2
                  </button>
                </div>

                {myNumber !== 1 && (
                  <p className="text-center font-funnel-display text-orange-500 text-sm mt-4 mb-2 animate-pulse">
                    Waiting for Player 1 to start...
                  </p>
                )}

                {canStart && (
                  <button
                    type="button"
                    onClick={handleStartDraft}
                    className="w-full py-3.5 rounded-lg bg-orange-600 hover:bg-orange-500 font-semibold"
                  >
                    Start Draft
                  </button>
                )}
              </>
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
              myNumber={myNumber}
              currentTurn={game.currentTurn}
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
              gameMode={game.gameMode ?? "all_time"}
              onPick={handlePick}
              onRespin={handleRespin}
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
              className="w-full py-3.5 rounded-lg bg-green-600 hover:bg-green-500 font-semibold"
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
