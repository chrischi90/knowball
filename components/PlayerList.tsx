"use client";

import { useEffect, useState } from "react";
import type { NBAPlayer } from "@/lib/nba-api";
import type { Roster } from "@/lib/game-types";
import { POSITIONS } from "@/lib/game-types";

type PlayerListProps = {
  teamId: string;
  teamName: string;
  takenPlayerIds: string[];
  currentRoster: Roster;
  onPick: (playerId: string, playerName: string, position: string) => void;
};

export function PlayerList({
  teamId,
  teamName,
  takenPlayerIds,
  currentRoster,
  onPick,
}: PlayerListProps) {
  const [players, setPlayers] = useState<NBAPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlayer, setSelectedPlayer] = useState<NBAPlayer | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setSelectedPlayer(null);
    setSelectedPosition(null);
    fetch(`/api/teams/${teamId}/players`)
      .then((r) => r.json())
      .then((data) => {
        if (data.players) setPlayers(data.players);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [teamId]);

  const availablePositions = POSITIONS.filter(
    (p) => !currentRoster[p].playerId
  );
  const canConfirm =
    selectedPlayer &&
    selectedPosition &&
    !takenPlayerIds.includes(selectedPlayer.id);

  const handleConfirm = () => {
    if (!selectedPlayer || !selectedPosition) return;
    onPick(selectedPlayer.id, selectedPlayer.name, selectedPosition);
    setSelectedPlayer(null);
    setSelectedPosition(null);
  };

  if (loading) {
    return (
      <div className="rounded-xl bg-slate-800 p-6 text-center text-slate-400">
        Loading players for {teamName}…
      </div>
    );
  }

  const availablePlayers = players.filter((p) => !takenPlayerIds.includes(p.id));

  return (
    <div className="rounded-xl bg-slate-800 p-4">
      <h3 className="font-semibold text-orange-400 mb-3">
        Pick a player from {teamName}
      </h3>
      <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto mb-4">
        {availablePlayers.map((player) => (
          <button
            key={player.id}
            type="button"
            onClick={() => setSelectedPlayer(player)}
            className={`py-3 px-3 rounded-lg text-left text-sm transition touch-manipulation min-h-[44px] ${
              selectedPlayer?.id === player.id
                ? "bg-orange-600 text-white"
                : "bg-slate-700 hover:bg-slate-600 text-white"
            }`}
          >
            {player.name}
            {player.position && (
              <span className="block text-xs opacity-80">{player.position}</span>
            )}
          </button>
        ))}
      </div>
      {availablePositions.length > 0 && (
        <div className="mb-4">
          <p className="text-slate-400 text-sm mb-2">Assign to position:</p>
          <div className="flex flex-wrap gap-2">
            {availablePositions.map((pos) => (
              <button
                key={pos}
                type="button"
                onClick={() => setSelectedPosition(pos)}
                className={`py-2 px-4 rounded-lg text-sm font-medium transition touch-manipulation ${
                  selectedPosition === pos
                    ? "bg-orange-600 text-white"
                    : "bg-slate-700 hover:bg-slate-600 text-white"
                }`}
              >
                {pos}
              </button>
            ))}
          </div>
        </div>
      )}
      {canConfirm && (
        <button
          type="button"
          onClick={handleConfirm}
          className="w-full py-4 rounded-xl bg-green-600 hover:bg-green-500 font-semibold touch-manipulation min-h-[48px]"
        >
          Confirm: {selectedPlayer.name} → {selectedPosition}
        </button>
      )}
    </div>
  );
}
