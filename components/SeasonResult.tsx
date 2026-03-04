"use client";

import { useRouter } from "next/navigation";
import type { Roster } from "@/lib/game-types";
import { POSITIONS } from "@/lib/game-types";

type SeasonResultData = {
  wins: number;
  losses: number;
  teamPower: number;
  madePlayoffs: boolean;
  playoffResult: string | null;
  rounds: { name: string; wins: number; losses: number }[];
  milestones: string[];
};

type Props = {
  result: SeasonResultData;
  roster: Roster;
  onPlayAgain: () => void;
};

export function SeasonResult({ result, roster, onPlayAgain }: Props) {
  const router = useRouter();
  const { wins, losses, madePlayoffs, playoffResult, rounds, milestones } = result;

  const isChampion = playoffResult === "Champion";
  const madeFinals = playoffResult === "NBA Finals";

  const headline = isChampion
    ? "🏆 NBA Champion!"
    : madeFinals
      ? "Made the Finals!"
      : madePlayoffs
        ? "Made the Playoffs!"
        : "Missed the Playoffs";

  const headlineColor = isChampion
    ? "text-yellow-400"
    : madeFinals
      ? "text-orange-400"
      : madePlayoffs
        ? "text-green-400"
        : "text-zinc-400";

  return (
    <main className="min-h-screen bg-black text-white p-4">
      <div className="max-w-lg mx-auto pt-6 pb-12">
        {/* Headline */}
        <p className={`text-center text-2xl font-bold mb-4 ${headlineColor}`}>
          {headline}
        </p>

        {/* Record */}
        <div className="text-center mb-6">
          <div className="flex items-baseline justify-center gap-3">
            <span className="text-7xl font-bold text-green-400">{wins}</span>
            <span className="text-4xl text-zinc-500">–</span>
            <span className="text-7xl font-bold text-red-400">{losses}</span>
          </div>
          <p className="text-zinc-500 text-sm mt-1">Regular Season Record</p>
        </div>

        {/* Milestone banners */}
        {milestones.length > 0 && (
          <div className="space-y-2 mb-6">
            {milestones.map((m) => (
              <div
                key={m}
                className="rounded-lg bg-zinc-900 border border-zinc-700 px-4 py-2 text-center text-sm text-zinc-300"
              >
                {m}
              </div>
            ))}
          </div>
        )}

        {/* Playoff bracket */}
        {madePlayoffs && rounds.length > 0 && (
          <div className="rounded-lg bg-zinc-900 p-4 mb-4">
            <h2 className="text-sm font-medium text-zinc-400 mb-3">Playoff Run</h2>
            <ul className="space-y-2">
              {rounds.map((r) => {
                const won = r.wins === 4;
                return (
                  <li key={r.name} className="flex justify-between items-center text-sm">
                    <span className="text-zinc-300">{r.name}</span>
                    <span className={`font-mono font-semibold ${won ? "text-green-400" : "text-red-400"}`}>
                      {r.wins}–{r.losses} {won ? "W" : "L"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Roster recap */}
        <div className="rounded-lg bg-zinc-900 p-4 mb-6">
          <h2 className="text-sm font-medium text-zinc-400 mb-3">Your Roster</h2>
          <ul className="space-y-1 text-sm">
            {POSITIONS.map((pos) => (
              <li key={pos} className="flex justify-between gap-2">
                <span className="text-zinc-500 w-8">{pos}</span>
                <span className="text-white">{roster[pos].playerName || "—"}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-zinc-600 mt-3">Team Power: {result.teamPower}</p>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <button
            type="button"
            onClick={onPlayAgain}
            className="w-full py-3.5 rounded-lg bg-orange-600 hover:bg-orange-500 font-semibold transition"
          >
            Draft Again
          </button>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="w-full py-3.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 font-semibold transition"
          >
            Home
          </button>
        </div>
      </div>
    </main>
  );
}
