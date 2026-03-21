"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Roster } from "@/lib/game-types";
import { POSITIONS } from "@/lib/game-types";
import type { TeamFitDiagnostics } from "@/lib/game-types";
import { buildShareUrl, encodeSoloShareData } from "@/lib/share-utils";

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
  playerScores?: PlayerScore[];
  madePlayoffs: boolean;
  playoffResult: string | null;
  rounds: { name: string; wins: number; losses: number }[];
  milestones: string[];
  mvp: MvpData | null;
  badges: string[];
  weaknessBadges?: string[];
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

function meshScoreColorClass(value: number): string {
  if (value >= 1.06) return "text-emerald-500";
  if (value >= 1.01) return "text-green-400";
  if (value >= 0.97) return "text-white";
  if (value >= 0.93) return "text-yellow-300";
  return "text-red-400";
}

function usageBalanceColorClass(value: number): string {
  if (value >= 75) return "text-emerald-500";
  if (value >= 62) return "text-green-400";
  if (value >= 48) return "text-white";
  if (value >= 38) return "text-yellow-300";
  return "text-red-400";
}

function spacingFitColorClass(value: number): string {
  if (value >= 70) return "text-emerald-500";
  if (value >= 58) return "text-green-400";
  if (value >= 45) return "text-white";
  if (value >= 35) return "text-yellow-300";
  return "text-red-400";
}

function playmakingFitColorClass(value: number): string {
  if (value >= 70) return "text-emerald-500";
  if (value >= 58) return "text-green-400";
  if (value >= 45) return "text-white";
  if (value >= 35) return "text-yellow-300";
  return "text-red-400";
}

function defenseFitColorClass(value: number): string {
  if (value >= 70) return "text-emerald-500";
  if (value >= 58) return "text-green-400";
  if (value >= 45) return "text-white";
  if (value >= 35) return "text-yellow-300";
  return "text-red-400";
}

function usagePenaltyColorClass(value: number): string {
  if (value <= 5) return "text-emerald-500";
  if (value <= 8) return "text-green-400";
  if (value <= 12) return "text-white";
  if (value <= 17) return "text-yellow-300";
  return "text-red-400";
}

function buildTweetText(result: SeasonResultData, roster: Roster): string {
  const isChampion = result.playoffResult === "Champion";
  const madeFinals = result.playoffResult === "NBA Finals";
  const headline = isChampion
    ? "🏆 NBA Champion!"
    : madeFinals
    ? "Made the Finals!"
    : result.madePlayoffs
    ? "Made the Playoffs!"
    : "Missed the Playoffs";

  const rosterLines = POSITIONS.map((pos) => {
    const name = roster[pos].playerName || "—";
    return `${pos.padEnd(3)} ${name}`;
  }).join("\n");

  return `Can you draft a squad to beat mine?\n\n${rosterLines}\n\nSeason: ${result.wins}-${result.losses}\n${headline}`;
}

type ShareModalProps = {
  result: SeasonResultData;
  roster: Roster;
  headline: string;
  headlineColor: string;
  onClose: () => void;
};

function ShareModal({ result, roster, headline, headlineColor, onClose }: ShareModalProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm mx-4 rounded-xl bg-zinc-900 border border-zinc-700 p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 text-zinc-400 hover:text-white text-xl leading-none"
        >
          ×
        </button>

        <p className="font-funnel-display text-white text-lg font-semibold text-center">Knowball</p>

        {/* Roster */}
        <div>
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Your Roster</p>
          <ul className="space-y-1 text-sm">
            {POSITIONS.map((pos) => (
              <li key={pos} className="flex justify-between gap-2">
                <span className="text-zinc-500 w-8">{pos}</span>
                <span className="text-white">{roster[pos].playerName || "—"}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Record */}
        <div className="text-center">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">Regular Season</p>
          <div className="flex items-baseline justify-center gap-2">
            <span className="text-4xl font-bold text-green-400">{result.wins}</span>
            <span className="text-2xl text-zinc-500">–</span>
            <span className="text-4xl font-bold text-red-400">{result.losses}</span>
          </div>
        </div>

        {/* Postseason */}
        <div>
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Postseason</p>
          <p className={`font-funnel-display text-base font-semibold mb-2 ${headlineColor}`}>{headline}</p>
          {result.madePlayoffs && result.rounds.length > 0 && (
            <ul className="space-y-1 text-sm">
              {result.rounds.map((r) => {
                const won = r.wins === 4;
                return (
                  <li key={r.name} className="flex justify-between items-center">
                    <span className="text-zinc-300">{r.name}</span>
                    <span className={`font-mono font-semibold ${won ? "text-green-400" : "text-red-400"}`}>
                      {r.wins}–{r.losses} {won ? "W" : "L"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <p className="text-xs text-zinc-500 text-center pt-1">
          Twitter will automatically show your results card in the tweet
        </p>
      </div>
    </div>
  );
}

export function RevealResult({ result, roster, onPlayAgain }: Props) {
  const router = useRouter();
  const [revealStep, setRevealStep] = useState(0);
  const [showShareModal, setShowShareModal] = useState(false);

  const {
    wins,
    losses,
    teamPower,
    regularSeasonWinProbability,
    ratingWinProbability,
    pythagoreanWinProbability,
    hybridBlendWeight,
    expectedWinsRating,
    expectedWinsPythagorean,
    expectedWinsBlended,
    estimatedPointsFor,
    estimatedPointsAgainst,
    matchupEstimatedPointsFor,
    matchupEstimatedPointsAgainst,
    fitDiagnostics,
    playerScores,
    madePlayoffs,
    playoffResult,
    rounds,
    badges,
    weaknessBadges,
    mvp,
  } = result;

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

  function handleShare() {
    const text = buildTweetText(result, roster);
    const shareUrl = buildShareUrl("solo", encodeSoloShareData(roster, result));
    const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`;
    window.open(tweetUrl, "_blank", "noopener,noreferrer");
    setShowShareModal(true);
  }

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
              {typeof regularSeasonWinProbability === "number" && (
                <p className="text-xs text-zinc-600 mt-1">
                  Per-game win probability: {(regularSeasonWinProbability * 100).toFixed(1)}%
                </p>
              )}
              {(typeof ratingWinProbability === "number" ||
                typeof pythagoreanWinProbability === "number" ||
                typeof hybridBlendWeight === "number") && (
                <p className="text-xs text-zinc-600 mt-1">
                  Hybrid model:{" "}
                  {typeof hybridBlendWeight === "number" ? `${Math.round(hybridBlendWeight * 100)}%` : "50%"} rating /{" "}
                  {typeof hybridBlendWeight === "number"
                    ? `${Math.round((1 - hybridBlendWeight) * 100)}%`
                    : "50%"}{" "}
                  pythagorean
                </p>
              )}
              {(typeof expectedWinsRating === "number" ||
                typeof expectedWinsPythagorean === "number" ||
                typeof expectedWinsBlended === "number") && (
                <p className="text-xs text-zinc-600 mt-1">
                  Expected wins: {typeof expectedWinsBlended === "number" ? expectedWinsBlended.toFixed(1) : "-"}
                  {" "}(rating {typeof expectedWinsRating === "number" ? expectedWinsRating.toFixed(1) : "-"},
                  {" "}pyth {typeof expectedWinsPythagorean === "number" ? expectedWinsPythagorean.toFixed(1) : "-"})
                </p>
              )}
              {(typeof estimatedPointsFor === "number" || typeof estimatedPointsAgainst === "number") && (
                <p className="text-xs text-zinc-600 mt-1">
                  Estimated PF/PA: {typeof estimatedPointsFor === "number" ? estimatedPointsFor.toFixed(1) : "-"}/{" "}
                  {typeof estimatedPointsAgainst === "number" ? estimatedPointsAgainst.toFixed(1) : "-"}
                  {typeof matchupEstimatedPointsFor === "number" && typeof matchupEstimatedPointsAgainst === "number"
                    ? ` (matchup ${matchupEstimatedPointsFor.toFixed(1)}/${matchupEstimatedPointsAgainst.toFixed(1)})`
                    : ""}
                </p>
              )}
            </div>
          </RevealBox>
        </div>

        {/* Box 2: Badges */}
        <div className="mb-4 relative z-30">
          <RevealBox visible={revealStep >= STEP_BADGES}>
            <div className="relative z-30 rounded-lg bg-zinc-900 p-4">
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

              <div className="mt-4">
                <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                  Team Weaknesses
                </p>
                {weaknessBadges && weaknessBadges.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {weaknessBadges.map((badge) => (
                      <span
                        key={badge}
                        className="px-3 py-1.5 rounded-full bg-red-600/15 border border-red-500/40 text-red-300 text-sm font-medium"
                      >
                        {badge}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-zinc-500 text-sm">No major weaknesses detected.</p>
                )}
              </div>

              {fitDiagnostics && (
                <div className="mt-4 rounded-md bg-zinc-800/60 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                      Lineup Mesh
                    </p>
                    <div className="relative group z-40">
                      <button
                        type="button"
                        aria-label="Explain lineup mesh metrics"
                        className="h-5 w-5 rounded-full border border-zinc-500/60 text-zinc-300 text-[11px] leading-none hover:border-zinc-300 hover:text-white focus:outline-none focus:ring-2 focus:ring-orange-500/70"
                      >
                        i
                      </button>
                      <div
                        role="tooltip"
                        className="pointer-events-none absolute right-0 z-[120] mt-2 hidden w-80 rounded-md border border-zinc-700 bg-zinc-900 p-3 text-[11px] text-zinc-200 shadow-xl group-hover:block group-focus-within:block"
                      >
                        <p className="mb-2 text-zinc-100 font-medium">How to read these values</p>
                        <ul className="space-y-1.5 text-zinc-300">
                          <li>Mesh: around 1.00 is neutral, above 1.00 means strong fit, below 1.00 means chemistry drag.</li>
                          <li>Spacing Fit: 0-100, higher means better floor spacing and cleaner driving lanes.</li>
                          <li>Defense Fit: 0-100, higher means better defensive role coverage across the lineup.</li>
                          <li>Usage Balance: 0-100, higher means touches are shared more cleanly.</li>
                          <li>Playmaking Fit: 0-100, higher means enough creation and passing coverage.</li>
                          <li>Usage Penalty: lower is better. 0-5 low overlap, 6-10 moderate, above 10 heavy usage conflict.</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-zinc-300 tabular-nums">
                    <p>
                      Mesh:{" "}
                      <span className={`font-semibold ${meshScoreColorClass(fitDiagnostics.meshFactor)}`}>
                        {fitDiagnostics.meshFactor.toFixed(3)}
                      </span>
                    </p>
                    <p>
                      Usage Balance:{" "}
                      <span className={`font-semibold ${usageBalanceColorClass(fitDiagnostics.usageBalance)}`}>
                        {fitDiagnostics.usageBalance.toFixed(1)}
                      </span>
                    </p>
                    <p>
                      Spacing Fit:{" "}
                      <span className={`font-semibold ${spacingFitColorClass(fitDiagnostics.spacingFit)}`}>
                        {fitDiagnostics.spacingFit.toFixed(1)}
                      </span>
                    </p>
                    <p>
                      Playmaking Fit:{" "}
                      <span className={`font-semibold ${playmakingFitColorClass(fitDiagnostics.playmakingFit)}`}>
                        {fitDiagnostics.playmakingFit.toFixed(1)}
                      </span>
                    </p>
                    <p>
                      Defense Fit:{" "}
                      <span className={`font-semibold ${defenseFitColorClass(fitDiagnostics.defenseFit)}`}>
                        {fitDiagnostics.defenseFit.toFixed(1)}
                      </span>
                    </p>
                    <p>
                      Usage Penalty:{" "}
                      <span className={`font-semibold ${usagePenaltyColorClass(fitDiagnostics.usageOverloadPenalty)}`}>
                        {fitDiagnostics.usageOverloadPenalty.toFixed(1)}
                      </span>
                    </p>
                  </div>
                </div>
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
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleShare}
                className="flex-1 py-3.5 rounded-lg bg-sky-600 hover:bg-sky-500 font-semibold transition flex items-center justify-center gap-2"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.738l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.91-5.622Zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                Share
              </button>
              <button
                type="button"
                onClick={() => router.push("/")}
                className="flex-1 py-3.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 font-semibold transition"
              >
                Home
              </button>
            </div>
          </div>
        </RevealBox>
      </div>

      {showShareModal && (
        <ShareModal
          result={result}
          roster={roster}
          headline={headline}
          headlineColor={headlineColor}
          onClose={() => setShowShareModal(false)}
        />
      )}
    </main>
  );
}
