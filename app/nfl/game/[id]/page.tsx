"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSocket } from "@/lib/socket";
import { persistMultiplayerSession, readMultiplayerSession } from "@/lib/multiplayer-session";
import { Wheel } from "@/components/Wheel";
import { NflPlayerPicker } from "@/components/nfl/NflPlayerPicker";
import { NflRosterList } from "@/components/nfl/NflRosterList";
import { NflGameResult } from "@/components/nfl/NflGameResult";
import { NFL_ALL_TIME_START_SEASON, type NflPlayer, type NflPlayerSlot, type NflTeam } from "@/lib/nfl-types";
import { toWheelTeams, type NflGameMode, type NflGameState } from "@/lib/nfl-client";
import { NFL_TEAM_COLORS } from "@/lib/nfl-team-colors";

type Ack = { game?: NflGameState & { sport?: string }; error?: string; playerNumber?: number; reconnectToken?: string };

function Toggle({ options, value, onChange, disabled }: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const second = value === options[1].value;
  return (
    <div className={`relative flex rounded-full border border-zinc-700 p-1 mb-6${disabled ? " opacity-70" : ""}`}>
      <div className={`pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-orange-600 transition-transform duration-200 ease-in-out${second ? " translate-x-full" : ""}`} />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          disabled={disabled}
          className={`relative z-10 flex-1 py-1.5 px-4 text-sm font-medium transition-colors ${value === o.value ? "text-white" : "text-zinc-400"} ${disabled ? "cursor-default" : ""}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function NflGamePage() {
  const params = useParams();
  const router = useRouter();
  const gameId = params.id as string;
  const [game, setGame] = useState<NflGameState | null>(null);
  const [playerNumber, setPlayerNumber] = useState<1 | 2 | null>(null);
  const [teams, setTeams] = useState<NflTeam[]>([]);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [showLeave, setShowLeave] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [remoteSpinTarget, setRemoteSpinTarget] = useState<number | null>(null);
  const wheelTeams = useMemo(() => toWheelTeams(teams), [teams]);

  useEffect(() => {
    if (playerNumber !== null) persistMultiplayerSession(gameId, { playerNumber });
  }, [playerNumber, gameId]);

  useEffect(() => {
    fetch("/api/nfl/teams")
      .then((r) => r.json())
      .then((d) => {
        if (!d.teams) return setError("Failed to load teams");
        setTeams(d.teams);
        getSocket().emit("cache_teams", { gameId, teams: d.teams });
      })
      .catch(() => setError("Failed to load teams"));
  }, [gameId]);

  useEffect(() => {
    if (game?.phase === "completed") setSimulating(false);
  }, [game?.phase]);

  // A basketball game opened at an NFL URL goes back to the basketball page.
  const accept = useCallback(
    (state: (NflGameState & { sport?: string }) | null | undefined) => {
      if (!state) return;
      if (state.sport !== "nfl") {
        router.replace(`/game/${gameId}`);
        return;
      }
      setGame(state);
    },
    [gameId, router]
  );

  useEffect(() => {
    const socket = getSocket();
    const onState = (state: NflGameState) => {
      accept(state);
      setPlayerNumber((prev) => {
        if (state.player1?.socketId === socket.id) return 1;
        if (state.player2?.socketId === socket.id) return 2;
        return prev;
      });
    };
    const onSimStarted = () => setSimulating(true);
    const onSpinStarted = ({ targetDisplayRotation }: { targetDisplayRotation: number }) => setRemoteSpinTarget(targetDisplayRotation);
    socket.on("game_state", onState);
    socket.on("simulation_started", onSimStarted);
    socket.on("spin_started", onSpinStarted);

    const rejoin = () => {
      if (!gameId || gameId.length !== 8) return;
      socket.emit("get_state", { gameId }, (state: NflGameState | null) => {
        if (state) {
          accept(state);
          if (state.player1?.socketId === socket.id) setPlayerNumber(1);
          else if (state.player2?.socketId === socket.id) setPlayerNumber(2);
          return;
        }
        const { playerNumber: claimPlayerNumber, reconnectToken: claimReconnectToken } = readMultiplayerSession(gameId);
        socket.emit("join_game", { gameId, claimPlayerNumber, claimReconnectToken }, (res: Ack) => {
          if (res.game) {
            accept(res.game);
            if (res.playerNumber) setPlayerNumber(res.playerNumber as 1 | 2);
            persistMultiplayerSession(gameId, { playerNumber: res.playerNumber, reconnectToken: res.reconnectToken });
          } else if (res.error && res.error !== "Game not found") {
            setError(res.error);
          }
        });
      });
    };
    socket.on("connect", rejoin);
    if (gameId && gameId.length === 8) rejoin();
    return () => {
      socket.off("game_state", onState);
      socket.off("simulation_started", onSimStarted);
      socket.off("spin_started", onSpinStarted);
      socket.off("connect", rejoin);
    };
  }, [gameId, accept]);

  const emit = useCallback(
    (event: string, payload: Record<string, unknown>) => {
      getSocket().emit(event, { gameId, ...payload }, (res: Ack) => {
        if (res?.error) setError(res.error);
        else setError("");
        if (res?.game) accept(res.game);
      });
    },
    [gameId, accept]
  );

  const handlePickPlayer = (slot: NflPlayerSlot, player: NflPlayer) => {
    if (!game?.wheelTeamId) return;
    emit("pick", { playerId: player.id, playerName: player.name, position: slot, teamId: game.wheelTeamId, naturalPosition: player.position });
  };

  const handleRunSimulation = async () => {
    if (!game) return;
    setSimulating(true);
    const socket = getSocket();
    socket.emit("simulation_started", { gameId });
    try {
      const res = await fetch("/api/nfl/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roster1: game.rosters[1], roster2: game.rosters[2], gameMode: game.gameMode, names: ["Player 1", "Player 2"] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Simulation failed");
      socket.emit("simulation_result", { gameId, result: data });
    } catch (e) {
      setSimulating(false);
      setError(e instanceof Error ? e.message : "Simulation failed");
    }
  };

  const handleRematch = () => {
    getSocket().emit("rematch", { gameId }, (res: Ack) => {
      if (res.error) setError(res.error);
      if (res.game) {
        accept(res.game);
        const id = getSocket().id;
        if (res.game.player1?.socketId === id) setPlayerNumber(1);
        else if (res.game.player2?.socketId === id) setPlayerNumber(2);
      }
    });
  };

  const handleLeave = () => {
    getSocket().emit("leave_game", { gameId });
    router.push("/");
  };

  const handleCopyCode = async () => {
    const message = `Play football against me at knowball.gg! Room code: ${gameId}`;
    try {
      await navigator.clipboard.writeText(message);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = message;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } finally {
        document.body.removeChild(ta);
      }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  if (simulating) {
    return (
      <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-4">
        <div className="text-center">
          <div className="mb-6 flex justify-center">
            <img src="/Loading.gif" alt="" style={{ width: 120, height: 120 }} />
          </div>
          <p className="font-funnel-display text-3xl font-semibold mb-3 animate-pulse">Simulating game…</p>
          <p className="text-zinc-400 text-lg">Playing it out drive by drive</p>
        </div>
      </main>
    );
  }

  if (!game) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-4 bg-black text-white">
        <p className="text-zinc-400">Connecting to game…</p>
        {error && <p className="mt-2 text-red-400 text-sm">{error}</p>}
        <button type="button" onClick={handleLeave} className="mt-6 text-zinc-500 hover:text-white">Back to lobby</button>
      </main>
    );
  }

  const myNumber = playerNumber;
  const other = myNumber === 1 ? 2 : 1;
  const isMyTurn = game.phase === "drafting" && myNumber === game.currentTurn && !game.wheelTeamId;
  const isActiveTurn = game.phase === "drafting" && myNumber === game.currentTurn;
  const showPick = game.phase === "drafting" && game.wheelTeamId && game.currentTurn === myNumber && myNumber;
  const gameMode: NflGameMode = game.gameMode ?? "all_time";

  return (
    <main className="min-h-screen bg-black text-white p-4 pb-8">
      {showLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" role="dialog" aria-modal="true" aria-labelledby="leave-title">
          <div className="rounded-lg bg-zinc-900 border border-zinc-700 p-6 w-full max-w-sm shadow-xl">
            <h2 id="leave-title" className="font-funnel-display text-xl font-semibold mb-4">Are you sure you want to leave this game?</h2>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setShowLeave(false)} className="px-4 py-2.5 rounded-md bg-zinc-700 hover:bg-zinc-600 font-medium transition">No</button>
              <button type="button" onClick={handleLeave} className="px-4 py-2.5 rounded-md bg-red-600 hover:bg-red-500 font-medium transition">Leave</button>
            </div>
          </div>
        </div>
      )}
      <div className="max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-4">
          <span className="font-funnel-display text-lg font-medium">Knowball</span>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-300">🏈 Football</span>
            {game.phase !== "lobby" && (
              <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-300">
                {gameMode === "all_time" ? "All-Time" : "Active Only"}
              </span>
            )}
            <span className="text-zinc-500 text-xs">Game: {gameId}</span>
          </div>
        </div>

        {error && <div className="mb-4 p-3 rounded-md bg-red-900/50 text-red-200 text-sm">{error}</div>}

        {game.phase === "lobby" && (
          <div className="rounded-lg bg-zinc-900 p-6 mb-6">
            {!game.player2 ? (
              <>
                <p className="text-zinc-300 mb-4">Share this code with the other player:</p>
                <div className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/80 px-4 py-3 mb-4">
                  <strong className="font-funnel-display text-xl tracking-widest">{gameId}</strong>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="inline-flex items-center justify-center h-8 w-8 rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition shrink-0"
                    aria-label="Copy game code to clipboard"
                    title={copied ? "Copied!" : "Copy to clipboard"}
                  >
                    {copied ? "✓" : "⧉"}
                  </button>
                </div>
                <p className="text-zinc-400 text-sm">Waiting for player 2…</p>
              </>
            ) : (
              <>
                <h3 className="font-funnel-display text-lg font-semibold mb-3">Game Mode</h3>
                <p className="text-zinc-400 text-sm mb-4 leading-relaxed">
                  <span className="font-bold">NOTE:</span> In All-Time mode, stats come only from a player&apos;s time with the
                  drafted team, and you pick which season of a team defense to lock in. Players are available from{" "}
                  {NFL_ALL_TIME_START_SEASON}–present. Each team&apos;s defense can only be taken by one player.
                </p>
                <Toggle
                  options={[{ value: "all_time", label: "All-Time" }, { value: "active_only", label: "Active Only" }]}
                  value={gameMode}
                  disabled={myNumber !== 1}
                  onChange={(v) => {
                    setGame((g) => (g ? { ...g, gameMode: v as NflGameMode } : g));
                    emit("set_game_mode", { gameMode: v });
                  }}
                />
                <h3 className="font-funnel-display text-lg font-semibold mb-3">Draft Order</h3>
                <Toggle
                  options={[{ value: "1", label: "Player 1" }, { value: "2", label: "Player 2" }]}
                  value={String(game.firstDrafter ?? 1)}
                  disabled={myNumber !== 1}
                  onChange={(v) => {
                    setGame((g) => (g ? { ...g, firstDrafter: Number(v) as 1 | 2 } : g));
                    emit("set_first_drafter", { playerNumber: Number(v) });
                  }}
                />
                {myNumber !== 1 && (
                  <p className="text-center font-funnel-display text-orange-500 text-sm mt-4 mb-2 animate-pulse">Waiting for Player 1 to start...</p>
                )}
                {myNumber === 1 && (
                  <button type="button" onClick={() => emit("start_draft", {})} className="w-full py-3.5 rounded-lg bg-orange-600 hover:bg-orange-500 font-semibold">
                    Start Draft
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {game.phase === "drafting" && wheelTeams.length > 0 && (
          <div className="mb-6">
            <Wheel
              teams={wheelTeams}
              teamColors={NFL_TEAM_COLORS}
              currentTeamId={game.wheelTeamId}
              isMyTurn={isMyTurn}
              isActiveTurn={isActiveTurn}
              gameId={gameId}
              myNumber={myNumber}
              currentTurn={game.currentTurn}
              onSpin={(r) => emit("spin", r)}
              remoteSpinTarget={isMyTurn ? null : remoteSpinTarget}
              onSpinBroadcast={(targetDisplayRotation) => getSocket().emit("spin_started", { gameId, targetDisplayRotation })}
            />
          </div>
        )}

        {showPick && game.wheelTeamId && myNumber && (
          <div className="mb-6">
            <NflPlayerPicker
              teamId={game.wheelTeamId}
              teamName={game.wheelTeamName || ""}
              takenPlayerIds={game.takenPlayerIds}
              roster={game.rosters[myNumber]}
              gameMode={gameMode}
              opponentDefenseTeamId={game.rosters[other].TEAM_DEF.teamId}
              onPickPlayer={handlePickPlayer}
              onLockDefense={(season) => emit("lock_defense", { season })}
              onRespin={() => emit("respin", {})}
            />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
          {([1, 2] as const).map((pn) => (
            <div key={pn} className={`rounded-lg p-4 ${myNumber === pn ? "bg-zinc-800 ring-2 ring-orange-500" : "bg-zinc-900"}`}>
              <h3 className="font-funnel-display font-semibold text-zinc-300 mb-2 flex items-center gap-2">
                Player {pn}
                {myNumber === pn && <span className="text-xs bg-orange-600 px-2 py-0.5 rounded">You</span>}
              </h3>
              <NflRosterList roster={game.rosters[pn]} teams={teams} />
            </div>
          ))}
        </div>

        {game.phase === "simulation" && (
          <div className="mt-6">
            <button type="button" onClick={handleRunSimulation} className="w-full py-3.5 rounded-lg bg-green-600 hover:bg-green-500 font-semibold">
              Run Simulation
            </button>
          </div>
        )}

        {game.phase === "completed" && game.simulationResult && (
          <NflGameResult
            result={game.simulationResult}
            roster1={game.rosters[1]}
            roster2={game.rosters[2]}
            teams={teams}
            myNumber={myNumber}
            onRematch={handleRematch}
          />
        )}

        <div className="mt-6">
          <button type="button" onClick={() => setShowLeave(true)} className="w-full py-3.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-semibold transition">
            Quit Game
          </button>
        </div>
      </div>
    </main>
  );
}
