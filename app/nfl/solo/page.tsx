"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Wheel } from "@/components/Wheel";
import { NflPlayerPicker } from "@/components/nfl/NflPlayerPicker";
import { NflRosterList } from "@/components/nfl/NflRosterList";
import { NflSeasonReveal } from "@/components/nfl/NflSeasonReveal";
import {
  NFL_ALL_TIME_START_SEASON,
  createEmptyNflRoster,
  getOpenSlots,
  isNflRosterComplete,
  type NflPlayer,
  type NflPlayerSlot,
  type NflRoster,
  type NflTeam,
} from "@/lib/nfl-types";
import { toWheelTeams, type NflGameMode, type NflSeasonResponse } from "@/lib/nfl-client";
import { NFL_TEAM_COLORS } from "@/lib/nfl-team-colors";

function LeaveModal({ onCancel, onLeave }: { onCancel: () => void; onLeave: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" role="dialog" aria-modal="true" aria-labelledby="leave-title">
      <div className="rounded-lg bg-zinc-900 border border-zinc-700 p-6 w-full max-w-sm shadow-xl">
        <h2 id="leave-title" className="font-funnel-display text-xl font-semibold mb-4">Are you sure you want to leave this game?</h2>
        <div className="flex gap-3 justify-end">
          <button type="button" onClick={onCancel} className="px-4 py-2.5 rounded-md bg-zinc-700 hover:bg-zinc-600 font-medium transition">No</button>
          <button type="button" onClick={onLeave} className="px-4 py-2.5 rounded-md bg-red-600 hover:bg-red-500 font-medium transition">Yes, leave</button>
        </div>
      </div>
    </div>
  );
}

export default function NflSoloPage() {
  const router = useRouter();
  const [teams, setTeams] = useState<NflTeam[]>([]);
  const [phase, setPhase] = useState<"drafting" | "simulation" | "revealing">("drafting");
  const [roster, setRoster] = useState<NflRoster>(createEmptyNflRoster());
  const [wheelTeamId, setWheelTeamId] = useState<string | null>(null);
  const [wheelTeamName, setWheelTeamName] = useState<string | null>(null);
  const [takenPlayerIds, setTakenPlayerIds] = useState<string[]>([]);
  const [gameMode, setGameMode] = useState<NflGameMode>("all_time");
  const [hasSpun, setHasSpun] = useState(false);
  const [showLeave, setShowLeave] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [week, setWeek] = useState(0);
  const [result, setResult] = useState<NflSeasonResponse | null>(null);
  const [error, setError] = useState("");
  const weekTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const wheelTeams = useMemo(() => toWheelTeams(teams), [teams]);

  useEffect(() => {
    fetch("/api/nfl/teams")
      .then((r) => r.json())
      .then((d) => (d.teams ? setTeams(d.teams) : setError("Failed to load teams")))
      .catch(() => setError("Failed to load teams"));
  }, []);

  // Week ticker while the season simulates.
  useEffect(() => {
    if (!simulating) return;
    setWeek(0);
    weekTimer.current = setInterval(() => setWeek((w) => Math.min(w + 1, 22)), 90);
    return () => {
      if (weekTimer.current) clearInterval(weekTimer.current);
    };
  }, [simulating]);

  const clearWheel = useCallback(() => {
    setWheelTeamId(null);
    setWheelTeamName(null);
  }, []);

  const afterPick = (next: NflRoster) => {
    setRoster(next);
    clearWheel();
    if (isNflRosterComplete(next)) setPhase("simulation");
  };

  const handlePickPlayer = (slot: NflPlayerSlot, player: NflPlayer) => {
    if (!wheelTeamId) return;
    afterPick({
      ...roster,
      [slot]: { slot, playerId: player.id, playerName: player.name, teamId: wheelTeamId, naturalPosition: player.position },
    });
    setTakenPlayerIds((prev) => [...prev, player.id]);
  };

  const handleLockDefense = (season: number) => {
    if (!wheelTeamId) return;
    afterPick({ ...roster, TEAM_DEF: { slot: "TEAM_DEF", teamId: wheelTeamId, teamName: wheelTeamName, season } });
  };

  const handleSimulate = async () => {
    setSimulating(true);
    setError("");
    try {
      const res = await fetch("/api/nfl/season", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roster, gameMode, name: "Your Team" }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Simulation failed");
      setResult(data);
      setPhase("revealing");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Simulation failed. Please try again.");
    } finally {
      setSimulating(false);
    }
  };

  const handlePlayAgain = () => {
    setRoster(createEmptyNflRoster());
    setTakenPlayerIds([]);
    clearWheel();
    setResult(null);
    setHasSpun(false);
    setPhase("drafting");
    setError("");
  };

  if (phase === "revealing" && result) {
    return <NflSeasonReveal result={result} roster={roster} teams={teams} onPlayAgain={handlePlayAgain} />;
  }

  if (simulating) {
    const label = week <= 18 ? `Week ${Math.max(week, 1)} of 18` : "Playoffs";
    return (
      <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-4">
        <div className="text-center">
          <div className="mb-6 flex justify-center">
            <img src="/Loading.gif" alt="" style={{ width: 120, height: 120 }} />
          </div>
          <p className="font-funnel-display text-3xl font-semibold mb-3 animate-pulse">Simulating your season…</p>
          <p className="text-zinc-400 text-lg tabular-nums">{label}</p>
        </div>
      </main>
    );
  }

  const header = (
    <div className="flex items-center justify-between mb-4 pt-2">
      <span className="font-funnel-display text-lg font-medium">Knowball</span>
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-300">🏈 Football</span>
        {hasSpun && (
          <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-300">
            {gameMode === "all_time" ? "All-Time" : "Active Only"}
          </span>
        )}
      </div>
    </div>
  );

  if (phase === "simulation") {
    return (
      <main className="min-h-screen bg-black text-white p-4">
        {showLeave && <LeaveModal onCancel={() => setShowLeave(false)} onLeave={() => router.push("/")} />}
        <div className="max-w-lg mx-auto">
          {header}
          <div className="mb-6 rounded-lg bg-zinc-900 p-4">
            <h2 className="font-funnel-display text-xl font-semibold mb-1">Your Roster</h2>
            <p className="text-zinc-400 text-sm mb-4">Draft complete. Ready to play a 17-game season.</p>
            <NflRosterList roster={roster} teams={teams} />
          </div>
          {error && <p className="mb-4 text-red-400 text-sm text-center">{error}</p>}
          <button type="button" onClick={handleSimulate} className="w-full py-4 rounded-lg bg-green-600 hover:bg-green-500 font-funnel-display font-semibold text-xl transition">
            Simulate Season
          </button>
          <button type="button" onClick={() => setShowLeave(true)} className="w-full mt-3 py-3.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-semibold transition">
            Quit Game
          </button>
        </div>
      </main>
    );
  }

  const picksRemaining = getOpenSlots(roster).length;

  return (
    <main className="min-h-screen bg-black text-white p-4">
      {showLeave && <LeaveModal onCancel={() => setShowLeave(false)} onLeave={() => router.push("/")} />}
      <div className="max-w-lg mx-auto">
        {header}

        {/* Game mode — collapses once the user spins */}
        <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out${hasSpun ? " grid-rows-[0fr] opacity-0 pointer-events-none" : " grid-rows-[1fr] opacity-100"}`}>
          <div className="overflow-hidden">
            <div className="mb-6 rounded-lg bg-zinc-900 p-4">
              <h3 className="font-funnel-display text-lg font-semibold mb-3">Game Mode</h3>
              <p className="text-zinc-400 text-sm mb-4">Draft from all players (including retired) or current rosters only.</p>
              <p className="text-zinc-400 text-sm mb-4 leading-relaxed">
                <span className="font-bold">NOTE:</span> In All-Time mode, a player&apos;s stats come only from their time with the
                drafted team, and you pick which season of a team&apos;s defense to lock in. Players are available from{" "}
                {NFL_ALL_TIME_START_SEASON}–present.
              </p>
              <div className="relative flex rounded-full border border-zinc-700 p-1">
                <div className={`pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-orange-600 transition-transform duration-200 ease-in-out${gameMode === "active_only" ? " translate-x-full" : ""}`} />
                <button type="button" onClick={() => setGameMode("all_time")} className={`relative z-10 flex-1 py-1.5 px-4 text-sm font-medium transition-colors ${gameMode === "all_time" ? "text-white" : "text-zinc-400"}`}>
                  All-Time
                </button>
                <button type="button" onClick={() => setGameMode("active_only")} className={`relative z-10 flex-1 py-1.5 px-4 text-sm font-medium transition-colors ${gameMode === "active_only" ? "text-white" : "text-zinc-400"}`}>
                  Active Only
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mb-6">
          <Wheel
            teams={wheelTeams}
            teamColors={NFL_TEAM_COLORS}
            currentTeamId={wheelTeamId}
            isMyTurn={!wheelTeamId}
            isActiveTurn={!wheelTeamId}
            gameId="solo"
            myNumber={1}
            currentTurn={1}
            onSpin={(r) => {
              setWheelTeamId(r.teamId);
              setWheelTeamName(r.teamName);
            }}
            onSpinStart={() => setHasSpun(true)}
          />
        </div>

        {wheelTeamId && wheelTeamName && (
          <div className="mb-6">
            <NflPlayerPicker
              teamId={wheelTeamId}
              teamName={wheelTeamName}
              takenPlayerIds={takenPlayerIds}
              roster={roster}
              gameMode={gameMode}
              onPickPlayer={handlePickPlayer}
              onLockDefense={handleLockDefense}
              onRespin={clearWheel}
            />
          </div>
        )}

        <div className="mb-6 rounded-lg bg-zinc-900 p-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-sm font-medium text-zinc-400">Your Roster</h2>
            <span className="text-xs text-zinc-500">{picksRemaining} pick{picksRemaining !== 1 ? "s" : ""} remaining</span>
          </div>
          <NflRosterList roster={roster} teams={teams} />
        </div>

        {error && <p className="mt-4 text-red-400 text-sm text-center">{error}</p>}

        <button type="button" onClick={() => setShowLeave(true)} className="w-full mt-6 py-3.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-semibold transition">
          Quit Game
        </button>
      </div>
    </main>
  );
}
