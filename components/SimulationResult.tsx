"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import type { Roster } from "@/lib/game-types";
import type { PlayerStats } from "@/lib/nba-api";

type SimulationResultProps = {
  result: {
    winner: 1 | 2 | null;
    team1Score: number;
    team2Score: number;
  };
  roster1: Roster;
  roster2: Roster;
  gameId: string;
  onRematch: () => void;
};

const POSITIONS = ["PG", "SG", "SF", "PF", "C"] as const;

function getPlayerHeadshot(playerId: string): string {
  return `https://cdn.nba.com/headshots/nba/latest/1040x760/${playerId}.png`;
}

export function SimulationResult({
  result,
  roster1,
  roster2,
  gameId,
  onRematch,
}: SimulationResultProps) {
  const router = useRouter();
  const { winner, team1Score, team2Score } = result;
  const [playerStats, setPlayerStats] = useState<Record<string, PlayerStats | null>>({});
  const [loading, setLoading] = useState(true);

  const winnerText =
    winner === 1
      ? "🏆 Player 1 Wins!"
      : winner === 2
        ? "🏆 Player 2 Wins!"
        : "🤝 It's a Tie!";

  // Fetch stats for all players
  useEffect(() => {
    const allPlayerIds = [
      ...POSITIONS.map((p) => roster1[p].playerId),
      ...POSITIONS.map((p) => roster2[p].playerId),
    ].filter((id): id is string => id != null);

    Promise.all(
      allPlayerIds.map(async (id) => {
        try {
          const res = await fetch(`/api/players/${id}/stats`);
          if (res.ok) return { id, stats: await res.json() };
          return { id, stats: null };
        } catch {
          return { id, stats: null };
        }
      })
    ).then((results) => {
      const statsMap: Record<string, PlayerStats | null> = {};
      results.forEach(({ id, stats }) => {
        statsMap[id] = stats;
      });
      setPlayerStats(statsMap);
      setLoading(false);
    });
  }, [roster1, roster2]);

  const handleNewGame = () => {
    router.push("/");
  };

  return (
    <div className="mt-8 rounded-xl bg-slate-800 p-6 border-2 border-orange-500/50">
      <h2 className="text-3xl font-bold text-center text-orange-400 mb-2">
        {winnerText}
      </h2>
      
      {/* Score Display */}
      <div className="grid grid-cols-2 gap-8 mb-8 text-center">
        <div>
          <p className="text-slate-400 text-sm mb-2">Player 1</p>
          <p className="text-5xl font-bold text-white">{team1Score}</p>
        </div>
        <div>
          <p className="text-slate-400 text-sm mb-2">Player 2</p>
          <p className="text-5xl font-bold text-white">{team2Score}</p>
        </div>
      </div>

      {/* Player Stats */}
      <div className="grid grid-cols-2 gap-6 mb-8">
        {/* Player 1 Roster */}
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-orange-400 mb-3">Player 1 Roster</h3>
          {POSITIONS.map((pos) => {
            const player = roster1[pos];
            if (!player.playerId) return null;
            const stats = playerStats[player.playerId];
            
            return (
              <div key={pos} className="bg-slate-700/50 rounded-lg p-3 flex items-center gap-3">
                <img
                  src={getPlayerHeadshot(player.playerId)}
                  alt={player.playerName || "Player"}
                  className="w-12 h-12 rounded-full bg-slate-600 object-cover object-top"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48'%3E%3Crect width='48' height='48' fill='%23475569'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23cbd5e1' font-size='20'%3E%3F%3C/text%3E%3C/svg%3E";
                  }}
                />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-white text-sm truncate">{player.playerName}</p>
                  <p className="text-xs text-slate-400">{pos}</p>
                </div>
                {loading ? (
                  <div className="text-xs text-slate-500">Loading...</div>
                ) : stats ? (
                  <div className="text-xs text-slate-300 text-right">
                    <div>{stats.pts.toFixed(1)} PPG</div>
                    <div>{stats.reb.toFixed(1)} REB</div>
                    <div>{stats.ast.toFixed(1)} AST</div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">No stats</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Player 2 Roster */}
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-orange-400 mb-3">Player 2 Roster</h3>
          {POSITIONS.map((pos) => {
            const player = roster2[pos];
            if (!player.playerId) return null;
            const stats = playerStats[player.playerId];
            
            return (
              <div key={pos} className="bg-slate-700/50 rounded-lg p-3 flex items-center gap-3">
                <img
                  src={getPlayerHeadshot(player.playerId)}
                  alt={player.playerName || "Player"}
                  className="w-12 h-12 rounded-full bg-slate-600 object-cover object-top"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48'%3E%3Crect width='48' height='48' fill='%23475569'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23cbd5e1' font-size='20'%3E%3F%3C/text%3E%3C/svg%3E";
                  }}
                />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-white text-sm truncate">{player.playerName}</p>
                  <p className="text-xs text-slate-400">{pos}</p>
                </div>
                {loading ? (
                  <div className="text-xs text-slate-500">Loading...</div>
                ) : stats ? (
                  <div className="text-xs text-slate-300 text-right">
                    <div>{stats.pts.toFixed(1)} PPG</div>
                    <div>{stats.reb.toFixed(1)} REB</div>
                    <div>{stats.ast.toFixed(1)} AST</div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">No stats</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-4">
        <button
          type="button"
          onClick={onRematch}
          className="py-3 rounded-lg bg-orange-600 hover:bg-orange-500 font-semibold text-white transition"
        >
          🔄 Rematch
        </button>
        <button
          type="button"
          onClick={handleNewGame}
          className="py-3 rounded-lg bg-slate-600 hover:bg-slate-500 font-semibold text-white transition"
        >
          🏠 New Game
        </button>
      </div>
    </div>
  );
}
