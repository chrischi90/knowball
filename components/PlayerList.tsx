"use client";

import { useEffect, useState } from "react";
import type { NBAPlayer } from "@/lib/nba-api";
import type { Roster } from "@/lib/game-types";
import type { GameMode } from "@/lib/game-types";
import { POSITIONS } from "@/lib/game-types";
import { nameMatchRank } from "@/lib/nfl-types";

const MIN_QUERY = 2;

function statLine(p: NBAPlayer): string | null {
  return p.pts == null ? null : `${p.pts} PTS · ${p.reb ?? 0} REB · ${p.ast ?? 0} AST`;
}

type PlayerListProps = {
  teamId: string;
  teamName: string;
  takenPlayerIds: string[];
  currentRoster: Roster;
  gameMode?: GameMode;
  onPick: (playerId: string, playerName: string, position: string, teamId: string, naturalPosition: string) => void;
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
  
  // A player "fits" when his natural position is one of your open slots. Out-of-position picks
  // are still allowed (with the usual rating penalty); fits are just listed first and tagged.
  const fitsOpenSlot = (p: NBAPlayer) => availablePositions.includes(p.position as (typeof POSITIONS)[number]);

  // Filter by search query; fits first, then best name matches, then higher scorers.
  const filteredPlayers = availablePlayers
    .map((p) => ({ p, rank: nameMatchRank(p.name, searchQuery), fit: fitsOpenSlot(p) ? 0 : 1 }))
    .filter(({ rank }) => rank >= 0)
    .sort((a, b) => a.fit - b.fit || a.rank - b.rank || (b.p.pts ?? 0) - (a.p.pts ?? 0) || a.p.name.localeCompare(b.p.name))
    .map(({ p }) => p);
  
  // Check if query exactly matches a player name
  const exactMatch = filteredPlayers.find((p) =>
    p.name.toLowerCase() === searchQuery.trim().toLowerCase()
  );

  const handleConfirm = () => {
    if (!selectedPlayer || !selectedPosition) return;
    onPick(selectedPlayer.id, selectedPlayer.name, selectedPosition, teamId, selectedPlayer.position ?? "SF");
    setSelectedPlayer(null);
    setSelectedPosition(null);
    setSearchQuery("");
  };
  
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setActiveIndex(0);
    // Show dropdown once the query is MIN_QUERY+ chars and has matches
    if (value.length >= MIN_QUERY && availablePlayers.some((p) => p.name.toLowerCase().includes(value.toLowerCase()))) {
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
    if (searchQuery.length >= MIN_QUERY && filteredPlayers.length > 0) {
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
          placeholder="Type player name…"
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
                onMouseDown={(e) => {
                  e.preventDefault(); // prevent input blur before click registers
                  handleSuggestionClick(player);
                }}
                className={`w-full text-left py-3 px-4 transition ${
                  idx === activeIndex
                    ? "bg-orange-600 text-white"
                    : "text-zinc-100 hover:bg-zinc-700"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{player.name}</span>
                  {fitsOpenSlot(player) && (
                    <span className="shrink-0 rounded bg-green-700/70 px-1.5 py-0.5 text-[0.775rem] font-semibold text-green-100">
                      Fits {player.position}
                    </span>
                  )}
                </div>
                {(player.position || statLine(player)) && (
                  <div className="text-xs opacity-80 tabular-nums">
                    {[player.position, statLine(player)].filter(Boolean).join(" · ")}
                  </div>
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
          {statLine(selectedPlayer) && <span className="text-zinc-400 tabular-nums"> · {statLine(selectedPlayer)}</span>}
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
                {selectedPlayer?.position === pos && <span aria-label="natural position"> ✓</span>}
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
