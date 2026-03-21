"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { buildShareUrl, encode2PShareData } from "@/lib/share-utils";
import type { TeamFitDiagnostics } from "@/lib/game-types";

type PlayerStat = { pts: number; reb: number; ast: number; stl: number; blk: number } | null;

type SimulationResultProps = {
  result: {
    winner: 1 | 2 | null;
    team1Score: number;
    team2Score: number;
    team1WinProbability?: number;
    team2WinProbability?: number;
    team1RatingWinProbability?: number;
    team2RatingWinProbability?: number;
    team1PythagoreanWinProbability?: number;
    team2PythagoreanWinProbability?: number;
    team1BlendedWinProbability?: number;
    team2BlendedWinProbability?: number;
    hybridBlendWeight?: number;
    team1EstimatedPointsFor?: number;
    team1EstimatedPointsAgainst?: number;
    team2EstimatedPointsFor?: number;
    team2EstimatedPointsAgainst?: number;
    team1Diagnostics?: TeamFitDiagnostics;
    team2Diagnostics?: TeamFitDiagnostics;
    playerStats1?: Record<string, PlayerStat>;
    playerStats2?: Record<string, PlayerStat>;
  };
  roster1: Record<string, { playerId: string | null; playerName: string | null }>;
  roster2: Record<string, { playerId: string | null; playerName: string | null }>;
  gameId: string;
  onRematch: () => void;
};

const POSITIONS = ["PG", "SG", "SF", "PF", "C"] as const;

function getPlayerHeadshot(playerId: string): string {
  return `https://cdn.nba.com/headshots/nba/latest/1040x760/${playerId}.png`;
}

function buildTweetText2P(result: SimulationResultProps["result"]): string {
  const winnerText =
    result.winner === 1
      ? "Player 1 Wins!"
      : result.winner === 2
        ? "Player 2 Wins!"
        : "It's a Tie!";
  return `Which team is better? 🏀\n\nPlayer 1: ${result.team1Score} — Player 2: ${result.team2Score}\n${winnerText}`;
}

type ShareModal2PProps = {
  result: SimulationResultProps["result"];
  roster1: SimulationResultProps["roster1"];
  roster2: SimulationResultProps["roster2"];
  winnerText: string;
  onClose: () => void;
};

function ShareModal2P({ result, roster1, roster2, winnerText, onClose }: ShareModal2PProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const { winner, team1Score, team2Score } = result;

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

        <div className="text-center">
          <p className="font-funnel-display text-white text-lg font-semibold">Knowball</p>
          <p className="text-xs text-zinc-500 mt-0.5">2-Player Matchup</p>
        </div>

        {/* Scores */}
        <div className="grid grid-cols-2 gap-4 text-center">
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Player 1</p>
            <p className={`text-4xl font-bold ${winner === 1 ? "text-green-400" : winner === 2 ? "text-red-400" : "text-white"}`}>
              {team1Score}
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Player 2</p>
            <p className={`text-4xl font-bold ${winner === 2 ? "text-green-400" : winner === 1 ? "text-red-400" : "text-white"}`}>
              {team2Score}
            </p>
          </div>
        </div>

        <p className="text-center font-funnel-display font-semibold text-orange-400">{winnerText}</p>

        {/* Roster 1 */}
        <div>
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Player 1 Roster</p>
          <ul className="space-y-1 text-sm">
            {POSITIONS.map((pos) => (
              <li key={pos} className="flex justify-between gap-2">
                <span className="text-zinc-500 w-8">{pos}</span>
                <span className="text-white">{roster1[pos]?.playerName || "—"}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Roster 2 */}
        <div>
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Player 2 Roster</p>
          <ul className="space-y-1 text-sm">
            {POSITIONS.map((pos) => (
              <li key={pos} className="flex justify-between gap-2">
                <span className="text-zinc-500 w-8">{pos}</span>
                <span className="text-white">{roster2[pos]?.playerName || "—"}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-zinc-500 text-center pt-1">
          Twitter will automatically show your results card in the tweet
        </p>
      </div>
    </div>
  );
}

export function SimulationResult({
  result,
  roster1,
  roster2,
  onRematch,
}: SimulationResultProps) {
  const router = useRouter();
  const [showShareModal, setShowShareModal] = useState(false);
  const {
    winner,
    team1Score,
    team2Score,
    team1WinProbability,
    team2WinProbability,
    team1RatingWinProbability,
    team2RatingWinProbability,
    team1PythagoreanWinProbability,
    team2PythagoreanWinProbability,
    team1BlendedWinProbability,
    team2BlendedWinProbability,
    hybridBlendWeight,
    team1EstimatedPointsFor,
    team1EstimatedPointsAgainst,
    team2EstimatedPointsFor,
    team2EstimatedPointsAgainst,
    team1Diagnostics,
    team2Diagnostics,
    playerStats1,
    playerStats2,
  } = result;

  function handleShare() {
    const text = buildTweetText2P(result);
    const shareUrl = buildShareUrl("2p", encode2PShareData(roster1, roster2, result));
    const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`;
    window.open(tweetUrl, "_blank", "noopener,noreferrer");
    setShowShareModal(true);
  }

  const winnerText =
    winner === 1
      ? "Player 1 Wins!"
      : winner === 2
        ? "Player 2 Wins!"
        : "It's a Tie!";

  const renderRoster = (
    roster: SimulationResultProps["roster1"],
    statsMap: Record<string, PlayerStat> | undefined,
    label: string
  ) => (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-orange-400 mb-3">{label}</h3>
      {POSITIONS.map((pos) => {
        const player = roster[pos];
        if (!player.playerId) return null;
        const stats = statsMap?.[player.playerId];

        return (
          <div key={pos} className="bg-zinc-800/50 rounded-md p-3 flex items-center gap-3">
            <img
              src={getPlayerHeadshot(player.playerId)}
              alt={player.playerName || "Player"}
              className="w-12 h-12 rounded-full bg-zinc-700 object-cover object-top"
              onError={(e) => {
                (e.target as HTMLImageElement).src =
                  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48'%3E%3Crect width='48' height='48' fill='%233f3f46'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23e4e4e7' font-size='20'%3E%3F%3C/text%3E%3C/svg%3E";
              }}
            />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-white text-sm truncate">{player.playerName}</p>
              <p className="text-xs text-zinc-400">{pos}</p>
            </div>
            {stats ? (
              <div className="text-xs text-zinc-300 text-right">
                <div>{stats.pts.toFixed(1)} PPG</div>
                <div>{stats.reb.toFixed(1)} REB</div>
                <div>{stats.ast.toFixed(1)} AST</div>
              </div>
            ) : (
              <div className="text-xs text-zinc-500">No stats</div>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <>
    <div className="mt-8 rounded-lg bg-zinc-900 p-6 border-2 border-orange-500/50">
      <h2 className="text-3xl font-bold text-center text-orange-400 mb-2">
        {winnerText}
      </h2>

      {/* Score Display */}
      <div className="grid grid-cols-2 gap-8 mb-8 text-center">
        <div>
          <p className="text-zinc-400 text-sm mb-2">Player 1</p>
          <p className="text-5xl font-bold text-white">{team1Score}</p>
        </div>
        <div>
          <p className="text-zinc-400 text-sm mb-2">Player 2</p>
          <p className="text-5xl font-bold text-white">{team2Score}</p>
        </div>
      </div>

      {(typeof team1WinProbability === "number" && typeof team2WinProbability === "number") && (
        <div className="mb-6 rounded-md bg-zinc-800/50 p-3 text-center">
          <p className="text-xs uppercase tracking-wider text-zinc-400 mb-1">Win Odds</p>
          <p className="text-sm text-zinc-200">
            Player 1: {(team1WinProbability * 100).toFixed(1)}% | Player 2: {(team2WinProbability * 100).toFixed(1)}%
          </p>
          {(typeof team1RatingWinProbability === "number" ||
            typeof team1PythagoreanWinProbability === "number" ||
            typeof hybridBlendWeight === "number") && (
            <p className="text-xs text-zinc-400 mt-1">
              Blend: {typeof hybridBlendWeight === "number" ? Math.round(hybridBlendWeight * 100) : 50}% rating /{" "}
              {typeof hybridBlendWeight === "number" ? Math.round((1 - hybridBlendWeight) * 100) : 50}% pythagorean
            </p>
          )}
          {(typeof team1RatingWinProbability === "number" && typeof team2RatingWinProbability === "number") && (
            <p className="text-xs text-zinc-400 mt-1">
              Rating odds: {(team1RatingWinProbability * 100).toFixed(1)}% | {(team2RatingWinProbability * 100).toFixed(1)}%
            </p>
          )}
          {(typeof team1PythagoreanWinProbability === "number" &&
            typeof team2PythagoreanWinProbability === "number") && (
            <p className="text-xs text-zinc-400 mt-1">
              Pythagorean odds: {(team1PythagoreanWinProbability * 100).toFixed(1)}% | {(team2PythagoreanWinProbability * 100).toFixed(1)}%
            </p>
          )}
          {(typeof team1BlendedWinProbability === "number" && typeof team2BlendedWinProbability === "number") && (
            <p className="text-xs text-zinc-300 mt-1">
              Blended odds: {(team1BlendedWinProbability * 100).toFixed(1)}% | {(team2BlendedWinProbability * 100).toFixed(1)}%
            </p>
          )}
          {(typeof team1EstimatedPointsFor === "number" && typeof team2EstimatedPointsFor === "number") && (
            <p className="text-xs text-zinc-400 mt-1">
              Estimated PF/PA: P1 {team1EstimatedPointsFor.toFixed(1)}/{typeof team1EstimatedPointsAgainst === "number" ? team1EstimatedPointsAgainst.toFixed(1) : "-"}
              {" "}| P2 {team2EstimatedPointsFor.toFixed(1)}/{typeof team2EstimatedPointsAgainst === "number" ? team2EstimatedPointsAgainst.toFixed(1) : "-"}
            </p>
          )}
        </div>
      )}

      {(team1Diagnostics || team2Diagnostics) && (
        <div className="grid grid-cols-2 gap-3 mb-8">
          {[{ label: "Player 1 Fit", data: team1Diagnostics }, { label: "Player 2 Fit", data: team2Diagnostics }].map(
            ({ label, data }) => (
              <div key={label} className="rounded-md bg-zinc-800/50 p-3">
                <p className="text-xs uppercase tracking-wider text-zinc-400 mb-2">{label}</p>
                {data ? (
                  <div className="space-y-1 text-xs text-zinc-300">
                    <p>Mesh: {data.meshFactor.toFixed(3)}</p>
                    <p>Usage Balance: {data.usageBalance.toFixed(1)}</p>
                    <p>Spacing: {data.spacingFit.toFixed(1)}</p>
                    <p>Defense: {data.defenseFit.toFixed(1)}</p>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">No fit diagnostics</p>
                )}
              </div>
            )
          )}
        </div>
      )}

      {/* Player Stats */}
      <div className="grid grid-cols-2 gap-6 mb-8">
        {renderRoster(roster1, playerStats1, "Player 1 Roster")}
        {renderRoster(roster2, playerStats2, "Player 2 Roster")}
      </div>

      {/* Action Buttons */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={onRematch}
          className="w-full py-2.5 rounded-md bg-orange-600 hover:bg-orange-500 font-semibold text-white transition"
        >
          Rematch
        </button>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleShare}
            className="flex-1 py-2.5 rounded-md bg-sky-600 hover:bg-sky-500 font-semibold text-white transition flex items-center justify-center gap-2"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.738l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.91-5.622Zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            Share
          </button>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="flex-1 py-2.5 rounded-md bg-zinc-700 hover:bg-zinc-600 font-semibold text-white transition"
          >
            New Game
          </button>
        </div>
      </div>
    </div>

    {showShareModal && (
      <ShareModal2P
        result={result}
        roster1={roster1}
        roster2={roster2}
        winnerText={winnerText}
        onClose={() => setShowShareModal(false)}
      />
    )}
  </>
  );
}
