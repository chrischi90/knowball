"use client";

import { useRouter } from "next/navigation";
import type { NflRoster, NflTeam } from "@/lib/nfl-types";
import { UNIT_LABELS, quarterLabel, unitGrade, type NflSimulationResponse } from "@/lib/nfl-client";
import { buildShareUrl, encodeNfl2PShareData } from "@/lib/share-utils";
import { NflRosterList } from "./NflRosterList";

type Props = {
  result: NflSimulationResponse;
  roster1: NflRoster;
  roster2: NflRoster;
  teams: NflTeam[];
  myNumber: 1 | 2 | null;
  onRematch: () => void;
};

export function NflGameResult({ result, roster1, roster2, teams, myNumber, onRematch }: Props) {
  const router = useRouter();
  const { winner, team1Score, team2Score } = result;
  const winnerText = winner === null ? "It's a tie!" : `Player ${winner} wins!`;
  const youText = myNumber && winner ? (winner === myNumber ? "You won 🎉" : "You lost") : null;
  const p1 = Math.round(result.team1WinProbability * 100);
  const p2 = Math.round(result.team2WinProbability * 100);
  const upset = winner !== null && ((winner === 1 && p1 < 40) || (winner === 2 && p2 < 40));

  const handleShare = () => {
    const url = buildShareUrl("2p", encodeNfl2PShareData(roster1, roster2, result));
    const text = `Which team is better? 🏈\n\nPlayer 1: ${team1Score} — Player 2: ${team2Score}${result.overtime ? " (OT)" : ""}\n${winnerText}`;
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  return (
    <div className="mt-8 space-y-5">
      <section className="rounded-lg bg-zinc-900 p-6 border-2 border-orange-500/50 text-center">
        <h2 className="text-3xl font-bold text-orange-400">{winnerText}</h2>
        {youText && <p className="text-zinc-300 mt-1">{youText}</p>}
        <div className="grid grid-cols-2 gap-8 my-6">
          {[
            { label: "Player 1", score: team1Score, won: winner === 1 },
            { label: "Player 2", score: team2Score, won: winner === 2 },
          ].map((t) => (
            <div key={t.label}>
              <p className="text-zinc-400 text-sm mb-1">{t.label}</p>
              <p className={`text-5xl font-bold tabular-nums ${t.won ? "text-green-400" : "text-white"}`}>{t.score}</p>
            </div>
          ))}
        </div>
        {result.overtime && <p className="text-sm text-zinc-300 mb-3">Decided in overtime</p>}
        <div>
          <p className="text-xs uppercase tracking-wider text-zinc-400 mb-1.5">Pre-game odds{upset ? " · Upset!" : ""}</p>
          <div className="flex h-2 rounded-full overflow-hidden bg-zinc-800">
            <div className="bg-orange-500" style={{ width: `${p1}%` }} />
            <div className="bg-sky-500" style={{ width: `${p2}%` }} />
          </div>
          <div className="flex justify-between text-xs text-zinc-300 mt-1 tabular-nums">
            <span>P1 {p1}%</span>
            <span>P2 {p2}%</span>
          </div>
        </div>
      </section>

      {result.keyMoments.length > 0 && (
        <section className="rounded-lg bg-zinc-900 p-4">
          <h3 className="font-funnel-display text-lg font-semibold mb-3">Key moments</h3>
          <ol className="space-y-2">
            {result.keyMoments.map((m, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="text-zinc-500 w-7 shrink-0">{quarterLabel(m.quarter)}</span>
                <span className="flex-1 text-zinc-100">{m.text}</span>
                <span className="text-zinc-500 tabular-nums shrink-0">{m.score[0]}-{m.score[1]}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="rounded-lg bg-zinc-900 p-4">
        <h3 className="font-funnel-display text-lg font-semibold mb-3">How they matched up</h3>
        <div className="grid grid-cols-[1fr_auto_1fr] gap-x-3 gap-y-1.5 text-sm">
          <span className="text-xs text-zinc-500">Player 1</span>
          <span />
          <span className="text-xs text-zinc-500 text-right">Player 2</span>
          {UNIT_LABELS.map(({ key, label }) => {
            const a = unitGrade(result.team1.units[key]);
            const b = unitGrade(result.team2.units[key]);
            return (
              <div key={key} className="contents">
                <span className={a.tone}>{a.label}</span>
                <span className="text-zinc-400 text-center">{label}</span>
                <span className={`${b.tone} text-right`}>{b.label}</span>
              </div>
            );
          })}
          <span className="text-zinc-300 tabular-nums">{result.teamStats[1].turnovers}</span>
          <span className="text-zinc-400 text-center">Turnovers</span>
          <span className="text-zinc-300 tabular-nums text-right">{result.teamStats[2].turnovers}</span>
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { label: "Player 1", roster: roster1 },
          { label: "Player 2", roster: roster2 },
        ].map((r) => (
          <div key={r.label} className="rounded-lg bg-zinc-900 p-4">
            <h3 className="text-sm font-medium text-orange-400 mb-2">{r.label} roster</h3>
            <NflRosterList roster={r.roster} teams={teams} />
          </div>
        ))}
      </section>

      <div className="space-y-3">
        <button type="button" onClick={onRematch} className="w-full py-3 rounded-lg bg-orange-600 hover:bg-orange-500 font-semibold transition">
          Rematch
        </button>
        <div className="flex gap-3">
          <button type="button" onClick={handleShare} className="flex-1 py-3 rounded-lg bg-sky-600 hover:bg-sky-500 font-semibold transition">
            Share
          </button>
          <button type="button" onClick={() => router.push("/")} className="flex-1 py-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 font-semibold transition">
            New Game
          </button>
        </div>
      </div>
    </div>
  );
}
