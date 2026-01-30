"use client";

import type { Roster } from "@/lib/game-types";
import { POSITIONS } from "@/lib/game-types";

type RosterGridProps = {
  roster1: Roster;
  roster2: Roster;
  playerNumber: 1 | 2 | null;
};

function RosterCard({
  label,
  roster,
  isYou,
}: {
  label: string;
  roster: Roster;
  isYou: boolean;
}) {
  return (
    <div className={`rounded-xl p-4 ${isYou ? "bg-slate-700 ring-2 ring-orange-500" : "bg-slate-800"}`}>
      <h3 className="font-semibold text-slate-300 mb-2 flex items-center gap-2">
        {label}
        {isYou && (
          <span className="text-xs bg-orange-600 px-2 py-0.5 rounded">You</span>
        )}
      </h3>
      <ul className="space-y-1 text-sm">
        {POSITIONS.map((pos) => (
          <li key={pos} className="flex justify-between gap-2">
            <span className="text-slate-500 w-8">{pos}</span>
            <span className="text-white truncate">
              {roster[pos].playerName || "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RosterGrid({ roster1, roster2, playerNumber }: RosterGridProps) {
  return (
    <div className="grid grid-cols-2 gap-4 mt-6">
      <RosterCard
        label="Player 1"
        roster={roster1}
        isYou={playerNumber === 1}
      />
      <RosterCard
        label="Player 2"
        roster={roster2}
        isYou={playerNumber === 2}
      />
    </div>
  );
}
