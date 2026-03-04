"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Wheel } from "@/components/Wheel";
import { PlayerList } from "@/components/PlayerList";
import { SeasonResult } from "@/components/SeasonResult";
import type { NBATeam } from "@/lib/nba-api";
import { createEmptyRoster, POSITIONS } from "@/lib/game-types";
import type { Roster, GameMode } from "@/lib/game-types";

type SeasonResultData = {
  wins: number;
  losses: number;
  teamPower: number;
  madePlayoffs: boolean;
  playoffResult: string | null;
  rounds: { name: string; wins: number; losses: number }[];
  milestones: string[];
};

export default function SoloPage() {
  const router = useRouter();
  const [teams, setTeams] = useState<NBATeam[]>([]);
  const [phase, setPhase] = useState<"drafting" | "result">("drafting");
  const [roster, setRoster] = useState<Roster>(createEmptyRoster());
  const [wheelTeamId, setWheelTeamId] = useState<string | null>(null);
  const [wheelTeamName, setWheelTeamName] = useState<string | null>(null);
  const [takenPlayerIds, setTakenPlayerIds] = useState<string[]>([]);
  const [gameMode, setGameMode] = useState<GameMode>("all_time");
  const [hasSpun, setHasSpun] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [seasonResult, setSeasonResult] = useState<SeasonResultData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/teams")
      .then((r) => r.json())
      .then((data) => { if (data.teams) setTeams(data.teams); })
      .catch(() => setError("Failed to load teams"));
  }, []);

  const rosterFull = POSITIONS.every((p) => roster[p].playerId !== null);

  const handleSpinStart = useCallback(() => {
    setHasSpun(true);
  }, []);

  const handleSpin = useCallback((result: { teamIndex: number; teamId: string; teamName: string }) => {
    setWheelTeamId(result.teamId);
    setWheelTeamName(result.teamName);
  }, []);

  const handlePick = useCallback((playerId: string, playerName: string, position: string) => {
    setRoster((prev) => ({
      ...prev,
      [position]: { position, playerId, playerName },
    }));
    setTakenPlayerIds((prev) => [...prev, playerId]);
    setWheelTeamId(null);
    setWheelTeamName(null);
  }, []);

  const handleSimulateSeason = async () => {
    setSimulating(true);
    setError("");
    try {
      const res = await fetch("/api/season", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roster }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      setSeasonResult(data);
      setPhase("result");
    } catch {
      setError("Simulation failed. Please try again.");
    } finally {
      setSimulating(false);
    }
  };

  const handlePlayAgain = () => {
    setRoster(createEmptyRoster());
    setTakenPlayerIds([]);
    setWheelTeamId(null);
    setWheelTeamName(null);
    setSeasonResult(null);
    setHasSpun(false);
    setPhase("drafting");
    setError("");
  };

  if (phase === "result" && seasonResult) {
    return (
      <SeasonResult
        result={seasonResult}
        roster={roster}
        onPlayAgain={handlePlayAgain}
      />
    );
  }

  const picksRemaining = POSITIONS.filter((p) => !roster[p].playerId).length;

  return (
    <main className="min-h-screen bg-black text-white p-4">
      {/* Leave confirmation modal */}
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
                Yes, leave
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 pt-2">
          <span className="text-zinc-400 text-sm">Solo Draft</span>
          <button
            type="button"
            onClick={() => setShowLeaveModal(true)}
            className="font-funnel-display text-white text-lg font-medium hover:text-zinc-300 transition"
          >
            Knowball
          </button>
        </div>

        {/* Game mode toggle — hidden once the user has spun */}
        {!hasSpun && <div className="mb-6 rounded-lg bg-zinc-900 p-4">
          <h3 className="font-funnel-display text-lg font-semibold text-white mb-3">Game Mode</h3>
          <p className="text-zinc-400 text-sm mb-4">
            Choose whether to draft from all players (including retired) or active players only.
          </p>
          <p className="text-zinc-400 text-sm mb-4 leading-relaxed">
            <span className="font-bold">NOTE:</span> In All-Time mode, a player&apos;s stats are based only on their time with the drafted team — not their full career.
          </p>
          <div className="relative flex rounded-full border border-zinc-700 p-1">
            <div className={`pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-orange-600 transition-transform duration-200 ease-in-out${gameMode === "active_only" ? " translate-x-full" : ""}`} />
            <button
              type="button"
              onClick={() => setGameMode("all_time")}
              className={`relative z-10 flex-1 py-1.5 px-4 text-sm font-medium transition-colors duration-200 ${gameMode === "all_time" ? "text-white" : "text-zinc-400"}`}
            >
              All-Time
            </button>
            <button
              type="button"
              onClick={() => setGameMode("active_only")}
              className={`relative z-10 flex-1 py-1.5 px-4 text-sm font-medium transition-colors duration-200 ${gameMode === "active_only" ? "text-white" : "text-zinc-400"}`}
            >
              Active Only
            </button>
          </div>
        </div>}

        {/* Wheel */}
        {!rosterFull && (
          <div className="mb-6">
            <Wheel
              teams={teams}
              currentTeamId={wheelTeamId}
              isMyTurn={!wheelTeamId}
              gameId="solo"
              myNumber={1}
              currentTurn={1}
              onSpin={handleSpin}
              onSpinStart={handleSpinStart}
            />
          </div>
        )}

        {/* Player picker after spin */}
        {wheelTeamId && wheelTeamName && (
          <div className="mb-6">
            <PlayerList
              teamId={wheelTeamId}
              teamName={wheelTeamName}
              takenPlayerIds={takenPlayerIds}
              currentRoster={roster}
              gameMode={gameMode}
              onPick={handlePick}
            />
          </div>
        )}

        {/* Roster */}
        <div className="mb-6 rounded-lg bg-zinc-900 p-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-sm font-medium text-zinc-400">Your Roster</h2>
            {!rosterFull && (
              <span className="text-xs text-zinc-500">{picksRemaining} pick{picksRemaining !== 1 ? "s" : ""} remaining</span>
            )}
          </div>
          <ul className="space-y-1 text-sm">
            {POSITIONS.map((pos) => (
              <li key={pos} className="flex justify-between gap-2">
                <span className="text-zinc-500 w-8">{pos}</span>
                <span className={roster[pos].playerId ? "text-white" : "text-zinc-600"}>
                  {roster[pos].playerName || "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Simulate season button */}
        {rosterFull && (
          <div className="mt-6">
            <button
              type="button"
              onClick={handleSimulateSeason}
              disabled={simulating}
              className="w-full py-4 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 font-semibold text-lg transition"
            >
              {simulating ? "Simulating Season…" : "Simulate Season"}
            </button>
          </div>
        )}

        {error && (
          <p className="mt-4 text-red-400 text-sm text-center">{error}</p>
        )}
      </div>
    </main>
  );
}
