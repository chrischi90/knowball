"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Wheel } from "@/components/Wheel";
import { PlayerList } from "@/components/PlayerList";
import { RevealResult } from "@/components/RevealResult";
import type { NBATeam } from "@/lib/nba-api";
import { createEmptyRoster, POSITIONS } from "@/lib/game-types";
import type { Roster, GameMode } from "@/lib/game-types";
import type { TeamFitDiagnostics } from "@/lib/game-types";

const DEV_PREFILL = false;
// const DEV_ROSTER: Roster = {
//   PG: { position: "PG", playerId: "201939",  playerName: "Stephen Curry (GSW)",   teamId: "1610612744", naturalPosition: "PG" }, // Golden State Warriors
//   SG: { position: "SG", playerId: "1630162", playerName: "Anthony Edwards (MIN)",  teamId: "1610612750", naturalPosition: "SG" }, // Minnesota Timberwolves
//   SF: { position: "SF", playerId: "202695",  playerName: "Kawhi Leonard (SAS)",    teamId: "1610612759", naturalPosition: "SF" }, // San Antonio Spurs
//   PF: { position: "PF", playerId: "2544",    playerName: "LeBron James (MIA)",     teamId: "1610612748", naturalPosition: "SF" }, // Miami Heat
//   C:  { position: "C",  playerId: "203999",   playerName: "Nikola Jokic (DEN)",     teamId: "1610612743", naturalPosition: "C"  }, // Denver Nuggets
// };

const DEV_ROSTER_MIN: Roster = {
  PG: { position: "PG", playerId: "201144", playerName: "Mike Conley (MIN)", teamId: "1610612750", naturalPosition: "PG" },
  SG: { position: "SG", playerId: "1630162", playerName: "Anthony Edwards (MIN)", teamId: "1610612750", naturalPosition: "SG" },
  SF: { position: "SF", playerId: "1630183", playerName: "Jaden McDaniels (MIN)", teamId: "1610612750", naturalPosition: "SF" },
  PF: { position: "PF", playerId: "203944", playerName: "Julius Randle (MIN)", teamId: "1610612750", naturalPosition: "PF" },
  C: { position: "C", playerId: "203497", playerName: "Rudy Gobert (MIN)", teamId: "1610612750", naturalPosition: "C" },
};

const DEV_ROSTER: Roster = DEV_ROSTER_MIN;

type SeasonResultData = {
  wins: number;
  losses: number;
  teamPower: number;
  regularSeasonWinProbability?: number;
  ratingWinProbability?: number;
  pythagoreanWinProbability?: number;
  hybridBlendWeight?: number;
  expectedWinsRating?: number;
  expectedWinsPythagorean?: number;
  expectedWinsBlended?: number;
  estimatedPointsFor?: number;
  estimatedPointsAgainst?: number;
  matchupEstimatedPointsFor?: number;
  matchupEstimatedPointsAgainst?: number;
  fitDiagnostics?: TeamFitDiagnostics;
  baseTalent?: number;
  meshAdjustedTalent?: number;
  playerScores?: { playerName: string; position: string; pts: number; reb: number; ast: number; score: number }[];
  madePlayoffs: boolean;
  playoffSeed?: number | null;
  playoffResult: string | null;
  rounds: { name: string; wins: number; losses: number }[];
  milestones: string[];
  mvp: { playerName: string; position: string; pts: number; reb: number; ast: number; stl: number; blk: number } | null;
  badges: string[];
  weaknessBadges?: string[];
};

export default function SoloPage() {
  const router = useRouter();
  const [teams, setTeams] = useState<NBATeam[]>([]);
  const [phase, setPhase] = useState<"drafting" | "simulation" | "revealing">(DEV_PREFILL ? "simulation" : "drafting");
  const [roster, setRoster] = useState<Roster>(DEV_PREFILL ? DEV_ROSTER : createEmptyRoster());
  const [wheelTeamId, setWheelTeamId] = useState<string | null>(null);
  const [wheelTeamName, setWheelTeamName] = useState<string | null>(null);
  const [takenPlayerIds, setTakenPlayerIds] = useState<string[]>([]);
  const [gameMode, setGameMode] = useState<GameMode>("all_time");
  const [hasSpun, setHasSpun] = useState(DEV_PREFILL);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [gameCount, setGameCount] = useState(0);
  const [seasonResult, setSeasonResult] = useState<SeasonResultData | null>(null);
  const [error, setError] = useState("");
  const gameCountIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/teams")
      .then((r) => r.json())
      .then((data) => { if (data.teams) setTeams(data.teams); })
      .catch(() => setError("Failed to load teams"));
  }, []);

  // Animate game counter while simulating
  useEffect(() => {
    if (simulating) {
      setGameCount(0);
      gameCountIntervalRef.current = setInterval(() => {
        setGameCount((prev) => {
          if (prev >= 82) {
            if (gameCountIntervalRef.current) clearInterval(gameCountIntervalRef.current);
            return 82;
          }
          return prev + 1;
        });
      }, 40);
    } else {
      if (gameCountIntervalRef.current) {
        clearInterval(gameCountIntervalRef.current);
        gameCountIntervalRef.current = null;
      }
    }
    return () => {
      if (gameCountIntervalRef.current) clearInterval(gameCountIntervalRef.current);
    };
  }, [simulating]);

  const handleSpinStart = useCallback(() => {
    setHasSpun(true);
  }, []);

  const handleSpin = useCallback((result: { teamIndex: number; teamId: string; teamName: string }) => {
    setWheelTeamId(result.teamId);
    setWheelTeamName(result.teamName);
  }, []);

  const handleRespin = useCallback(() => {
    setWheelTeamId(null);
    setWheelTeamName(null);
  }, []);

  const handlePick = useCallback((playerId: string, playerName: string, position: string, teamId: string, naturalPosition: string) => {
    const abbrev = teams.find((t) => t.id === teamId)?.abbreviation;
    const displayName = abbrev ? `${playerName} (${abbrev})` : playerName;
    setRoster((prev) => {
      const newRoster = { ...prev, [position]: { position, playerId, playerName: displayName, teamId, naturalPosition } };
      const isFull = POSITIONS.every((p) => newRoster[p].playerId !== null);
      if (isFull) setPhase("simulation");
      return newRoster;
    });
    setTakenPlayerIds((prev) => [...prev, playerId]);
    setWheelTeamId(null);
    setWheelTeamName(null);
  }, [teams]);

  const handleSimulateSeason = async () => {
    setSimulating(true);
    setError("");
    try {
      const res = await fetch("/api/season", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roster, gameMode }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setSimulating(false);
        return;
      }
      setSeasonResult(data);
      setPhase("revealing");
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

  if (phase === "revealing" && seasonResult) {
    return (
      <RevealResult
        result={seasonResult}
        roster={roster}
        onPlayAgain={handlePlayAgain}
      />
    );
  }

  // Loading screen during simulation
  if (simulating) {
    return (
      <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-4">
        <div className="text-center">
          <div className="mb-6 flex justify-center">
            <img src="/Loading.gif" alt="Loading..." style={{ width: 120, height: 120 }} />
          </div>
          <p className="font-funnel-display text-3xl font-semibold text-white mb-3 animate-pulse">
            Simulating your season…
          </p>
          <p className="text-zinc-400 text-lg tabular-nums">
            Game {gameCount} of 82
          </p>
        </div>
      </main>
    );
  }

  // Pre-simulation phase screen
  if (phase === "simulation") {
    return (
      <main className="min-h-screen bg-black text-white p-4">
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

          <div className="mb-6 rounded-lg bg-zinc-900 p-4">
            <h2 className="font-funnel-display text-xl font-semibold text-white mb-1">Your Roster</h2>
            <p className="text-zinc-400 text-sm mb-4">Draft complete. Ready to simulate your season.</p>
            <ul className="space-y-2">
              {POSITIONS.map((pos) => (
                <li key={pos} className="flex justify-between items-center gap-2 py-1 border-b border-zinc-800 last:border-0">
                  <span className="text-zinc-500 w-8 text-sm">{pos}</span>
                  <span className="text-white font-medium text-sm">{roster[pos].playerName || "—"}</span>
                </li>
              ))}
            </ul>
          </div>

          {error && (
            <p className="mb-4 text-red-400 text-sm text-center">{error}</p>
          )}

          <button
            type="button"
            onClick={handleSimulateSeason}
            className="w-full py-4 rounded-lg bg-green-600 hover:bg-green-500 font-funnel-display font-semibold text-xl transition"
          >
            Simulate Season
          </button>
        </div>
      </main>
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
          {hasSpun ? (
            <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-300">
              {gameMode === "all_time" ? "All-Time" : "Active Only"}
            </span>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={() => setShowLeaveModal(true)}
            className="font-funnel-display text-white text-lg font-medium hover:text-zinc-300 transition"
          >
            Knowball
          </button>
        </div>

        {/* Game mode toggle — animates closed (upward drawer) once the user has spun */}
        <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out${hasSpun ? " grid-rows-[0fr] opacity-0 pointer-events-none" : " grid-rows-[1fr] opacity-100"}`}>
          <div className="overflow-hidden">
            <div className="mb-6 rounded-lg bg-zinc-900 p-4">
              <h3 className="font-funnel-display text-lg font-semibold text-white mb-3">Game Mode</h3>
              <p className="text-zinc-400 text-sm mb-4">
                Choose whether to draft from all players (including retired) or active players only.
              </p>
              <p className="text-zinc-400 text-sm mb-4 leading-relaxed">
                <span className="font-bold">NOTE:</span> In All-Time mode, a player&apos;s stats are based only on their time with the drafted team — not their full career. Players are only available from 1980-present.
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
            </div>
          </div>
        </div>

        {/* Wheel */}
        <div className="mb-6">
          <Wheel
            teams={teams}
            currentTeamId={wheelTeamId}
            isMyTurn={!wheelTeamId}
            isActiveTurn={!wheelTeamId}
            gameId="solo"
            myNumber={1}
            currentTurn={1}
            onSpin={handleSpin}
            onSpinStart={handleSpinStart}
          />
        </div>

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
              onRespin={handleRespin}
            />
          </div>
        )}

        {/* Roster */}
        <div className="mb-6 rounded-lg bg-zinc-900 p-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-sm font-medium text-zinc-400">Your Roster</h2>
            <span className="text-xs text-zinc-500">{picksRemaining} pick{picksRemaining !== 1 ? "s" : ""} remaining</span>
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

        {error && (
          <p className="mt-4 text-red-400 text-sm text-center">{error}</p>
        )}
      </div>
    </main>
  );
}
