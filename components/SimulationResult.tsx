"use client";

import { useRouter } from "next/navigation";

type PlayerStat = { pts: number; reb: number; ast: number; stl: number; blk: number } | null;

type SimulationResultProps = {
  result: {
    winner: 1 | 2 | null;
    team1Score: number;
    team2Score: number;
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

export function SimulationResult({
  result,
  roster1,
  roster2,
  gameId: _gameId,
  onRematch,
}: SimulationResultProps) {
  const router = useRouter();
  const { winner, team1Score, team2Score, playerStats1, playerStats2 } = result;

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

      {/* Player Stats */}
      <div className="grid grid-cols-2 gap-6 mb-8">
        {renderRoster(roster1, playerStats1, "Player 1 Roster")}
        {renderRoster(roster2, playerStats2, "Player 2 Roster")}
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-4">
        <button
          type="button"
          onClick={onRematch}
          className="py-2.5 rounded-md bg-orange-600 hover:bg-orange-500 font-semibold text-white transition"
        >
          Rematch
        </button>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="py-2.5 rounded-md bg-zinc-700 hover:bg-zinc-600 font-semibold text-white transition"
        >
          New Game
        </button>
      </div>
    </div>
  );
}
