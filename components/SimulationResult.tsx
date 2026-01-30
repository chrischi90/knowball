"use client";

import type { Roster } from "@/lib/game-types";

type SimulationResultProps = {
  result: {
    winner: 1 | 2 | null;
    team1Score: number;
    team2Score: number;
    team1Stats?: Record<string, number>;
    team2Stats?: Record<string, number>;
  };
  roster1: Roster;
  roster2: Roster;
};

export function SimulationResult({
  result,
  roster1,
  roster2,
}: SimulationResultProps) {
  const { winner, team1Score, team2Score } = result;
  const winnerText =
    winner === 1
      ? "Player 1 wins!"
      : winner === 2
        ? "Player 2 wins!"
        : "It's a tie!";

  return (
    <div className="mt-8 rounded-xl bg-slate-800 p-6 border-2 border-orange-500/50">
      <h2 className="text-xl font-bold text-center text-orange-400 mb-4">
        Simulation Result
      </h2>
      <p className="text-2xl font-bold text-center text-white mb-6">
        {winnerText}
      </p>
      <div className="grid grid-cols-2 gap-4 text-center">
        <div>
          <p className="text-slate-400 text-sm">Player 1</p>
          <p className="text-3xl font-bold text-white">{team1Score}</p>
          <p className="text-xs text-slate-500 mt-1">
            {["PG", "SG", "SF", "PF", "C"]
              .map((p) => roster1[p].playerName)
              .filter(Boolean)
              .join(", ")}
          </p>
        </div>
        <div>
          <p className="text-slate-400 text-sm">Player 2</p>
          <p className="text-3xl font-bold text-white">{team2Score}</p>
          <p className="text-xs text-slate-500 mt-1">
            {["PG", "SG", "SF", "PF", "C"]
              .map((p) => roster2[p].playerName)
              .filter(Boolean)
              .join(", ")}
          </p>
        </div>
      </div>
    </div>
  );
}
