"use client";

import { useEffect, useState } from "react";
import type { NBAPlayer } from "@/lib/nba-api";
import type { Roster } from "@/lib/game-types";
import type { GameMode } from "@/lib/game-types";
import { POSITIONS } from "@/lib/game-types";

type PlayerListProps = {
  teamId: string;
  teamName: string;
  takenPlayerIds: string[];
  currentRoster: Roster;
  gameMode?: GameMode;
  onPick: (playerId: string, playerName: string, position: string, teamId: string) => void;
  onRespin?: () => void;
};

export function PlayerList({
  teamId,
  teamName,
  takenPlayerIds,
  currentRoster,
  gameMode = "all_time",
  onPick,
  onRespin,
}: PlayerListProps) {
  const [players, setPlayers] = useState<NBAPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlayer, setSelectedPlayer] = useState<NBAPlayer | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setLoading(true);
    setSelectedPlayer(null);
    setSelectedPosition(null);
    setSearchQuery("");
    setIsDropdownOpen(false);
    setActiveIndex(0);
    const activeOnly = gameMode === "active_only";
    fetch(`/api/teams/${teamId}/players?active_only=${activeOnly}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.players) setPlayers(data.players);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [teamId, gameMode]);

  const availablePositions = POSITIONS.filter(
    (p) => !currentRoster[p].playerId
  );
  const canConfirm =
    selectedPlayer &&
    selectedPosition &&
    !takenPlayerIds.includes(selectedPlayer.id);

  const availablePlayers = players.filter((p) => !takenPlayerIds.includes(p.id));
  
  // Filter players by search query
  const filteredPlayers = availablePlayers.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  // Check if query exactly matches a player name
  const exactMatch = filteredPlayers.find((p) =>
    p.name.toLowerCase() === searchQuery.trim().toLowerCase()
  );

  const handleConfirm = () => {
    if (!selectedPlayer || !selectedPosition) return;
    onPick(selectedPlayer.id, selectedPlayer.name, selectedPosition, teamId);
    setSelectedPlayer(null);
    setSelectedPosition(null);
    setSearchQuery("");
  };
  
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setActiveIndex(0);
    // Show dropdown if query is 3+ chars and has matches
    if (value.length >= 3 && availablePlayers.some((p) => p.name.toLowerCase().includes(value.toLowerCase()))) {
      setIsDropdownOpen(true);
    } else {
      setIsDropdownOpen(false);
    }
    // Auto-select if exact match
    if (exactMatch) {
      setSelectedPlayer(exactMatch);
    } else {
      setSelectedPlayer(null);
    }
  };
  
  const handleSearchFocus = () => {
    if (searchQuery.length >= 3 && filteredPlayers.length > 0) {
      setIsDropdownOpen(true);
    }
  };
  
  const handleSearchBlur = () => {
    setIsDropdownOpen(false);
  };
  
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isDropdownOpen || filteredPlayers.length === 0) return;
    
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % filteredPlayers.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + filteredPlayers.length) % filteredPlayers.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      setSelectedPlayer(filteredPlayers[activeIndex]);
      setSearchQuery(filteredPlayers[activeIndex].name);
      setIsDropdownOpen(false);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsDropdownOpen(false);
    }
  };
  
  const handleSuggestionClick = (player: NBAPlayer) => {
    setSelectedPlayer(player);
    setSearchQuery(player.name);
    setIsDropdownOpen(false);
  };

  if (loading) {
    return (
      <div className="rounded-lg bg-zinc-900 p-6 text-center text-zinc-400">
        Loading players for {teamName}…
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-zinc-900 p-4">
      <h3 className="font-semibold text-orange-400 mb-3">
        Pick a player from {teamName}
      </h3>
      {players.length === 0 && (
        <div className="mb-4 rounded-md border border-amber-700/50 bg-amber-900/30 p-3 text-sm text-amber-200">
          <p>
            No players were returned for this team right now. This is usually an
            upstream NBA data fetch issue; try spinning again or retry in a few
            seconds.
          </p>
          {onRespin && (
            <button
              type="button"
              onClick={onRespin}
              className="mt-3 w-full py-2.5 rounded-md bg-amber-700 hover:bg-amber-600 text-white font-medium transition"
            >
              Spin Again
            </button>
          )}
        </div>
      )}
      
      {/* Search Input */}
      <div className="relative mb-4">
        <input
          type="text"
          placeholder="Type player name (3+ chars)…"
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          onFocus={handleSearchFocus}
          onBlur={handleSearchBlur}
          onKeyDown={handleKeyDown}
          className="w-full py-3 px-4 rounded-md bg-zinc-800 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500 transition"
        />
        
        {/* Dropdown Suggestions */}
        {isDropdownOpen && filteredPlayers.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-800 rounded-md border border-zinc-700 max-h-48 overflow-y-auto z-50">
            {filteredPlayers.map((player, idx) => (
              <button
                key={player.id}
                type="button"
                onClick={() => handleSuggestionClick(player)}
                className={`w-full text-left py-3 px-4 transition ${
                  idx === activeIndex
                    ? "bg-orange-600 text-white"
                    : "text-zinc-100 hover:bg-zinc-700"
                }`}
              >
                <div className="font-medium">{player.name}</div>
                {player.position && (
                  <div className="text-xs opacity-80">{player.position}</div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      
      {/* Selected player info */}
      {selectedPlayer && (
        <div className="mb-4 p-3 rounded-md bg-zinc-800 border border-orange-500 text-white text-sm">
          Selected: <span className="font-medium">{selectedPlayer.name}</span>
        </div>
      )}
      {availablePositions.length > 0 && (
        <div className="mb-4">
          <p className="text-zinc-400 text-sm mb-2">Assign to position:</p>
          <div className="flex flex-wrap gap-2">
            {availablePositions.map((pos) => (
              <button
                key={pos}
                type="button"
                onClick={() => setSelectedPosition(pos)}
                className={`py-2 px-4 rounded-lg text-sm font-medium transition touch-manipulation ${
                  selectedPosition === pos
                    ? "bg-orange-600 text-white"
                    : "bg-zinc-800 hover:bg-zinc-700 text-white"
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
          className="w-full py-3.5 rounded-lg bg-green-600 hover:bg-green-500 font-semibold touch-manipulation min-h-[48px]"
        >
          Confirm: {selectedPlayer.name} → {selectedPosition}
        </button>
      )}
    </div>
  );
}
