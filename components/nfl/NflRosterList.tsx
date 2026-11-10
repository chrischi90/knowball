"use client";

import { NFL_SLOTS, type NflRoster, type NflTeam } from "@/lib/nfl-types";
import { SLOT_SHORT_LABELS } from "@/lib/nfl-client";

type Props = {
  roster: NflRoster;
  teams?: NflTeam[];
  className?: string;
};

/** Read-only list of the 8 NFL slots. */
export function NflRosterList({ roster, teams = [], className = "" }: Props) {
  const abbr = (id: string | null) => teams.find((t) => t.id === id)?.abbreviation ?? id ?? "";
  return (
    <ul className={`space-y-1 text-sm ${className}`}>
      {NFL_SLOTS.map((slot) => {
        if (slot === "TEAM_DEF") {
          const d = roster.TEAM_DEF;
          return (
            <li key={slot} className="flex justify-between gap-2">
              <span className="text-zinc-500 w-10 shrink-0">{SLOT_SHORT_LABELS[slot]}</span>
              <span className={`truncate text-right ${d.teamId ? "text-white" : "text-zinc-600"}`}>
                {d.teamId ? `${d.season} ${d.teamName ?? abbr(d.teamId)} defense` : "—"}
              </span>
            </li>
          );
        }
        const s = roster[slot];
        return (
          <li key={slot} className="flex justify-between gap-2">
            <span className="text-zinc-500 w-10 shrink-0">{SLOT_SHORT_LABELS[slot]}</span>
            <span className={`truncate text-right ${s.playerId ? "text-white" : "text-zinc-600"}`}>
              {s.playerId ? (
                <>
                  {s.playerName}
                  <span className="text-zinc-500"> · {abbr(s.teamId)}</span>
                </>
              ) : (
                "—"
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
