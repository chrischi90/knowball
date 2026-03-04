"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Roster } from "@/lib/game-types";
import { POSITIONS } from "@/lib/game-types";

type MvpData = {
  playerName: string;
  position: string;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
};

type PlayerScore = {
  playerName: string;
  position: string;
  pts: number;
  reb: number;
  ast: number;
  score: number;
};

type SeasonResultData = {
  wins: number;
  losses: number;
  teamPower: number;
  playerScores?: PlayerScore[];
  madePlayoffs: boolean;
  playoffResult: string | null;
  rounds: { name: string; wins: number; losses: number }[];
  milestones: string[];
  mvp: MvpData | null;
  badges: string[];
};

type Props = {
  result: SeasonResultData;
  roster: Roster;
  onPlayAgain: () => void;
};

function getPlayerHeadshot(playerId: string): string {
  return `https://cdn.nba.com/headshots/nba/latest/1040x760/${playerId}.png`;
}

// Each box reveals at this step number
const STEP_RECORD = 1;
const STEP_BADGES = 2;
const STEP_MVP = 3;
const STEP_PLAYER_STATS = 4;
const STEP_POSTSEASON = 5;
const STEP_ACTIONS = 6;
const REVEAL_DELAY_MS = 700;

function RevealBox({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`transition-all duration-500 ease-out ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3 pointer-events-none"
      }`}
    >
      {children}
    </div>
  );
}

export function RevealResult({ result, roster, onPlayAgain }: Props) {
  const router = useRouter();
  const [revealStep, setRevealStep] = useState(0);

  const { wins, losses, teamPower, playerScores, madePlayoffs, playoffResult, rounds, badges, mvp } = result;

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

  useEffect(() => {
    // Increment revealStep every REVEAL_DELAY_MS until STEP_ACTIONS
    if (revealStep >= STEP_ACTIONS) return;
    const timer = setTimeout(() => setRevealStep((s) => s + 1), REVEAL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [revealStep]);

  // Top 2 stats for MVP callout (by value)
  const mvpStats = mvp
    ? [
        { label: "PPG", value: mvp.pts },
        { label: "RPG", value: mvp.reb },
        { label: "APG", value: mvp.ast },
        { label: "SPG", value: mvp.stl },
        { label: "BPG", value: mvp.blk },
      ]
        .sort((a, b) => b.value - a.value)
        .slice(0, 3)
    : [];

  return (
    <main className="min-h-screen bg-black text-white p-4">
      <div className="max-w-lg mx-auto pb-12">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 pt-2">
          <span className="text-zinc-400 text-sm">Solo Draft</span>
          <span className="font-funnel-display text-white text-lg font-medium">Knowball</span>
        </div>

        {/* Your Roster — always visible */}
        <div className="mb-4 rounded-lg bg-zinc-900 p-4">
          <h2 className="text-sm font-medium text-zinc-400 mb-3">Your Roster</h2>
          <ul className="space-y-1 text-sm">
            {POSITIONS.map((pos) => (
              <li key={pos} className="flex justify-between gap-2">
                <span className="text-zinc-500 w-8">{pos}</span>
                <span className="text-white">{roster[pos].playerName || "—"}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Box 1: Regular Season Record */}
        <div className="mb-4">
          <RevealBox visible={revealStep >= STEP_RECORD}>
            <div className="rounded-lg bg-zinc-900 p-5 text-center">
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
                Regular Season
              </p>
              <div className="flex items-baseline justify-center gap-3">
                <span className="text-6xl font-bold text-green-400">{wins}</span>
                <span className="text-3xl text-zinc-500">–</span>
                <span className="text-6xl font-bold text-red-400">{losses}</span>
              </div>
              <p className="text-xs text-zinc-600 mt-3">Team Power: {teamPower}</p>
            </div>
          </RevealBox>
        </div>

        {/* Box 2: Badges */}
        <div className="mb-4">
          <RevealBox visible={revealStep >= STEP_BADGES}>
            <div className="rounded-lg bg-zinc-900 p-4">
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
                Team Badges
              </p>
              {badges.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {badges.map((badge) => (
                    <span
                      key={badge}
                      className="px-3 py-1.5 rounded-full bg-orange-600/20 border border-orange-600/40 text-orange-300 text-sm font-medium"
                    >
                      {badge}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-zinc-500 text-sm">No standout traits detected.</p>
              )}
            </div>
          </RevealBox>
        </div>

        {/* Box 3: Team MVP */}
        <div className="mb-4">
          <RevealBox visible={revealStep >= STEP_MVP}>
            <div className="rounded-lg bg-zinc-900 p-4">
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
                Team MVP
              </p>
              {mvp ? (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-funnel-display text-lg font-semibold text-white">{mvp.playerName}</p>
                    <p className="text-zinc-500 text-sm">{mvp.position}</p>
                  </div>
                  <div className="flex gap-4">
                    {mvpStats.map(({ label, value }) => (
                      <div key={label} className="text-center">
                        <p className="text-white font-semibold tabular-nums">{value.toFixed(1)}</p>
                        <p className="text-zinc-500 text-xs">{label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-zinc-500 text-sm">No MVP data available.</p>
              )}
            </div>
          </RevealBox>
        </div>

        {/* Box 4: Player Breakdown */}
        {playerScores && playerScores.length > 0 && (
          <div className="mb-4">
            <RevealBox visible={revealStep >= STEP_PLAYER_STATS}>
              <div className="rounded-lg bg-zinc-900 p-4">
                <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
                  Player Stats
                </p>
                <ul className="space-y-2">
                  {playerScores.map((p) => {
                    const playerId = roster[p.position as keyof Roster]?.playerId;
                    return (
                      <li key={p.position} className="flex items-center justify-between text-sm gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {playerId ? (
                            <img
                              src={getPlayerHeadshot(playerId)}
                              alt={p.playerName}
                              className="w-9 h-9 rounded-full bg-zinc-700 object-cover object-top shrink-0"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src =
                                  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Crect width='36' height='36' fill='%233f3f46'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23e4e4e7' font-size='16'%3E%3F%3C/text%3E%3C/svg%3E";
                              }}
                            />
                          ) : (
                            <span className="text-zinc-500 w-7 shrink-0">{p.position}</span>
                          )}
                          <div className="min-w-0">
                            <span className="text-white truncate block">{p.playerName}</span>
                            <span className="text-zinc-500 text-xs">{p.position}</span>
                          </div>
                        </div>
                        <div className="flex gap-3 shrink-0 text-zinc-400 tabular-nums">
                          <span>{p.pts.toFixed(1)} pts</span>
                          <span>{p.reb.toFixed(1)} reb</span>
                          <span>{p.ast.toFixed(1)} ast</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </RevealBox>
          </div>
        )}

        {/* Box 5: Postseason */}
        <div className="mb-6">
          <RevealBox visible={revealStep >= STEP_POSTSEASON}>
            <div className="rounded-lg bg-zinc-900 p-4">
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
                Postseason
              </p>
              {madePlayoffs && rounds.length > 0 ? (
                <>
                  <p className={`font-funnel-display text-lg font-semibold mb-3 ${headlineColor}`}>
                    {headline}
                  </p>
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
                </>
              ) : (
                <div className="flex items-center min-h-[60px]">
                  <p className={`font-funnel-display text-lg font-semibold ${headlineColor}`}>
                    {headline}
                  </p>
                </div>
              )}
            </div>
          </RevealBox>
        </div>

        {/* Actions — appear after all boxes revealed */}
        <RevealBox visible={revealStep >= STEP_ACTIONS}>
          <div className="space-y-3">
            <button
              type="button"
              onClick={onPlayAgain}
              className="w-full py-3.5 rounded-lg bg-orange-600 hover:bg-orange-500 font-funnel-display font-semibold transition"
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
        </RevealBox>
      </div>
    </main>
  );
}
