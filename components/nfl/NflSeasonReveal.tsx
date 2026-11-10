"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { NflRoster, NflTeam } from "@/lib/nfl-types";
import { FINAL_ROUND_NAME } from "@/lib/nfl-sim";
import {
  SLOT_SHORT_LABELS,
  UNIT_LABELS,
  quarterLabel,
  unitBarPct,
  unitGrade,
  type NflSeasonResponse,
} from "@/lib/nfl-client";
import { buildShareUrl, encodeNflSoloShareData } from "@/lib/share-utils";
import { NflRosterList } from "./NflRosterList";
import { NflBoxScore } from "./NflBoxScore";

type Props = {
  result: NflSeasonResponse;
  roster: NflRoster;
  teams: NflTeam[];
  onPlayAgain: () => void;
};

function record(w: number, l: number, t: number) {
  return t ? `${w}-${l}-${t}` : `${w}-${l}`;
}

export function playoffHeadline(r: NflSeasonResponse["playoffResult"]): { text: string; tone: string } {
  if (r === "Champion") return { text: `🏆 ${FINAL_ROUND_NAME} Champions!`, tone: "text-yellow-300" };
  if (r === FINAL_ROUND_NAME) return { text: `Lost in the ${FINAL_ROUND_NAME}`, tone: "text-orange-300" };
  if (r === "Conference Championship") return { text: "Lost in the Conference Championship", tone: "text-orange-300" };
  if (r === "Divisional") return { text: "Lost in the Divisional Round", tone: "text-zinc-200" };
  if (r === "Wild Card") return { text: "Lost in the Wild Card Round", tone: "text-zinc-200" };
  return { text: "Missed the playoffs", tone: "text-red-400" };
}

export function NflSeasonReveal({ result, roster, teams, onPlayAgain }: Props) {
  const router = useRouter();
  const [showSchedule, setShowSchedule] = useState(false);
  const headline = playoffHeadline(result.playoffResult);
  // The headline already says how the playoffs went; chips add the extra flavor only.
  const milestones = result.milestones.filter((m) => !/playoffs|champions|Made the|^Unlucky!/i.test(m));
  const ppg = (v: number) => (v / 17).toFixed(1);

  const handleShare = () => {
    const url = buildShareUrl("solo", encodeNflSoloShareData(roster, result));
    const text = `My Knowball squad went ${record(result.wins, result.losses, result.ties)} 🏈\n${headline.text.replace("🏆 ", "")}\n\nThink you can build a better team?`;
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  return (
    <main className="min-h-screen bg-black text-white p-4 pb-10">
      <div className="max-w-lg mx-auto space-y-5">
        <div className="flex items-center justify-between pt-2">
          <span className="font-funnel-display text-lg font-medium">Knowball</span>
          <span className="text-zinc-400 text-sm">{result.season} season</span>
        </div>

        {/* Headline */}
        <section className="rounded-lg bg-zinc-900 border-2 border-orange-500/50 p-6 text-center">
          <p className="text-zinc-400 text-sm mb-1">{result.division}</p>
          <p className="font-funnel-display text-6xl font-bold tabular-nums">
            {record(result.wins, result.losses, result.ties)}
          </p>
          <p className={`mt-2 font-funnel-display text-xl font-semibold ${headline.tone}`}>{headline.text}</p>
          {result.unlucky && (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-amber-600/60 bg-amber-900/30 px-3 py-1 text-sm text-amber-200">
              😬 Unlucky! This roster was expected to win {result.expectedWins.toFixed(1)} games
            </p>
          )}
          {milestones.length > 0 && (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {milestones.map((m) => (
                <span key={m} className="rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-200">{m}</span>
              ))}
            </div>
          )}
          <div className="mt-5 grid grid-cols-3 gap-2 text-sm">
            <div>
              <p className="text-zinc-500 text-xs">Points / game</p>
              <p className="font-semibold tabular-nums">{ppg(result.pointsFor)}</p>
            </div>
            <div>
              <p className="text-zinc-500 text-xs">Allowed / game</p>
              <p className="font-semibold tabular-nums">{ppg(result.pointsAgainst)}</p>
            </div>
            <div>
              <p className="text-zinc-500 text-xs">Playoff seed</p>
              <p className="font-semibold">{result.playoffSeed ? `#${result.playoffSeed}${result.playoffBye ? " · bye" : ""}` : "—"}</p>
            </div>
          </div>
          <p className="mt-4 text-xs text-zinc-500">
            Your defense&apos;s franchise put you in the {result.division}, in place of the {result.replacedTeam}.
            Expected wins: {result.expectedWins}.
          </p>
        </section>

        {/* Playoff run */}
        {result.playoffGames.length > 0 && (
          <section className="rounded-lg bg-zinc-900 p-4">
            <h2 className="font-funnel-display text-lg font-semibold mb-3">Playoff run</h2>
            <ol className="space-y-3">
              {result.playoffGames.map((g) => (
                <li key={g.round} className={`rounded-md p-3 ${g.won ? "bg-green-950/40 border border-green-800/50" : "bg-red-950/40 border border-red-800/50"}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs uppercase tracking-wider text-zinc-400">{g.round}</span>
                    <span className={`font-semibold tabular-nums ${g.won ? "text-green-400" : "text-red-400"}`}>
                      {g.won ? "W" : "L"} {g.teamScore}-{g.opponentScore}{g.overtime ? " (OT)" : ""}
                    </span>
                  </div>
                  <p className="text-sm text-white mt-0.5">
                    {g.home === null ? "vs" : g.home ? "vs" : "@"} {g.opponentSeed ? `(${g.opponentSeed}) ` : ""}{g.opponent}
                  </p>
                  {g.keyMoments.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {g.keyMoments.map((m, i) => (
                        <li key={i} className="text-xs text-zinc-300 flex gap-2">
                          <span className="text-zinc-500 w-6 shrink-0">{quarterLabel(m.quarter)}</span>
                          <span>{m.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* Team breakdown */}
        <section className="rounded-lg bg-zinc-900 p-4">
          <h2 className="font-funnel-display text-lg font-semibold mb-1">Team breakdown</h2>
          <p className="text-xs text-zinc-500 mb-3">
            {result.statMvp ? (
              <>
                Season MVP: <span className="text-white">{result.statMvp.name}</span> · {result.statMvp.line}
              </>
            ) : (
              <>
                MVP: <span className="text-white">{result.mvp.name}</span> ({SLOT_SHORT_LABELS[result.mvp.slot as keyof typeof SLOT_SHORT_LABELS] ?? result.mvp.slot})
              </>
            )}
          </p>
          <ul className="space-y-2">
            {UNIT_LABELS.map(({ key, label }) => {
              const v = result.team.units[key];
              const g = unitGrade(v);
              return (
                <li key={key} className="text-sm">
                  <div className="flex justify-between mb-1">
                    <span className="text-zinc-300">{label}</span>
                    <span className={g.tone}>{g.label}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-zinc-800">
                    <div className="h-1.5 rounded-full bg-orange-500" style={{ width: `${unitBarPct(v)}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Season stats */}
        {result.seasonStats && (
          <section className="rounded-lg bg-zinc-900 p-4">
            <h2 className="font-funnel-display text-lg font-semibold mb-3">Season stats</h2>
            <NflBoxScore box={result.seasonStats} perGame={17} />
          </section>
        )}

        {/* Division */}
        <section className="rounded-lg bg-zinc-900 p-4">
          <h2 className="font-funnel-display text-lg font-semibold mb-3">{result.division}</h2>
          <ul className="space-y-1 text-sm">
            {result.divisionStandings.map((r, i) => (
              <li key={r.id} className={`flex justify-between ${r.isUser ? "text-orange-300 font-semibold" : "text-zinc-300"}`}>
                <span>{i + 1}. {r.isUser ? "Your team" : r.name}</span>
                <span className="tabular-nums">{record(r.wins, r.losses, r.ties)}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Schedule */}
        <section className="rounded-lg bg-zinc-900 p-4">
          <button type="button" onClick={() => setShowSchedule((v) => !v)} className="w-full flex justify-between items-center">
            <h2 className="font-funnel-display text-lg font-semibold">Regular season</h2>
            <span className="text-zinc-400 text-sm">{showSchedule ? "Hide" : "Show"} schedule</span>
          </button>
          {showSchedule && (
            <ul className="mt-3 space-y-1 text-sm">
              {Array.from({ length: 18 }, (_, i) => i + 1).map((week) => {
                if (week === result.byeWeek) {
                  return (
                    <li key={week} className="flex gap-3 text-zinc-500">
                      <span className="w-8">W{week}</span>
                      <span>Bye</span>
                    </li>
                  );
                }
                const g = result.games.find((x) => x.week === week);
                if (!g) return null;
                const tone = g.result === "W" ? "text-green-400" : g.result === "L" ? "text-red-400" : "text-zinc-300";
                return (
                  <li key={week} className="flex gap-3">
                    <span className="w-8 text-zinc-500">W{week}</span>
                    <span className="flex-1 truncate text-zinc-200">{g.home ? "vs" : "@"} {g.opponent}</span>
                    <span className={`tabular-nums ${tone}`}>
                      {g.result} {g.teamScore}-{g.opponentScore}{g.overtime ? " OT" : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Roster */}
        <section className="rounded-lg bg-zinc-900 p-4">
          <h2 className="font-funnel-display text-lg font-semibold mb-3">Your roster</h2>
          <NflRosterList roster={roster} teams={teams} />
        </section>

        <div className="space-y-3">
          <button type="button" onClick={onPlayAgain} className="w-full py-3.5 rounded-lg bg-orange-600 hover:bg-orange-500 font-semibold transition">
            Play Again
          </button>
          <div className="flex gap-3">
            <button type="button" onClick={handleShare} className="flex-1 py-3 rounded-lg bg-sky-600 hover:bg-sky-500 font-semibold transition">
              Share
            </button>
            <button type="button" onClick={() => router.push("/")} className="flex-1 py-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 font-semibold transition">
              Home
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
