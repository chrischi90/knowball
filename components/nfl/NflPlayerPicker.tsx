"use client";

import { useEffect, useMemo, useState } from "react";
import {
  NFL_PLAYER_SLOTS,
  NFL_SLOT_LABELS,
  eligibleSlotsFor,
  isSlotFilled,
  nameMatchRank,
  type NflPlayer,
  type NflPlayerSlot,
  type NflRoster,
  type NflSeasonContext,
  type NflTeamSeason,
} from "@/lib/nfl-types";
import type { NflGameMode } from "@/lib/nfl-client";

const MIN_QUERY = 2;

/** "283.4 YDS · 2.1 TD · 0.7 INT" (per game), or the rookie's Madden rating. */
function statLine(p: NflPlayer): string | null {
  if (p.summary) return p.summary.stats.map((s) => `${s.value} ${s.label}`).join(" · ") + " /g";
  if (p.maddenOverall) return `Madden ${p.maddenOverall} OVR`;
  return null;
}

type Props = {
  teamId: string;
  teamName: string;
  takenPlayerIds: string[];
  roster: NflRoster;
  gameMode: NflGameMode;
  /** 2-player: the team whose defense the opponent already locked (any season). */
  opponentDefenseTeamId?: string | null;
  onPickPlayer: (slot: NflPlayerSlot, player: NflPlayer) => void;
  onLockDefense: (season: number) => void;
  onRespin?: () => void;
  /** Solo season: the defense's franchise decides which division your team plays in. */
  defenseSetsDivision?: boolean;
};

/**
 * Pick a player (type their name — knowing the roster is the game) or lock the landed team's
 * defense. Only slots the player is eligible for are offered.
 */
export function NflPlayerPicker({
  teamId,
  teamName,
  takenPlayerIds,
  roster,
  gameMode,
  opponentDefenseTeamId,
  onPickPlayer,
  onLockDefense,
  onRespin,
  defenseSetsDivision = false,
}: Props) {
  const [players, setPlayers] = useState<NflPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selected, setSelected] = useState<NflPlayer | null>(null);
  const [slot, setSlot] = useState<NflPlayerSlot | null>(null);
  const [context, setContext] = useState<NflSeasonContext | null>(null);
  const [defenseSeasons, setDefenseSeasons] = useState<NflTeamSeason[]>([]);
  const [defenseSeason, setDefenseSeason] = useState<number | null>(null);

  const defenseOpen = !isSlotFilled(roster, "TEAM_DEF");
  const defenseBlocked = opponentDefenseTeamId === teamId;

  useEffect(() => {
    setLoading(true);
    setLoadError(false);
    setQuery("");
    setSelected(null);
    setSlot(null);
    setOpen(false);
    fetch(`/api/nfl/teams/${teamId}/players?game_mode=${gameMode}`)
      .then((r) => r.json())
      .then((d) => setPlayers(Array.isArray(d.players) ? d.players : []))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [teamId, gameMode]);

  useEffect(() => {
    if (!defenseOpen || defenseBlocked) return;
    if (gameMode === "active_only") {
      fetch("/api/nfl/season-context")
        .then((r) => r.json())
        .then((d) => d?.statsSeason && setContext(d))
        .catch(() => undefined);
    } else {
      setDefenseSeason(null);
      fetch(`/api/nfl/teams/${teamId}/defense/seasons`)
        .then((r) => r.json())
        .then((d) => {
          const seasons: NflTeamSeason[] = Array.isArray(d.seasons) ? d.seasons : [];
          setDefenseSeasons(seasons);
          // Default to the franchise's best defensive season.
          setDefenseSeason((seasons.find((x) => x.best) ?? seasons[0])?.season ?? null);
        })
        .catch(() => setDefenseSeasons([]));
    }
  }, [teamId, gameMode, defenseOpen, defenseBlocked]);

  const openSlots = NFL_PLAYER_SLOTS.filter((s) => !isSlotFilled(roster, s));
  const available = useMemo(() => players.filter((p) => !takenPlayerIds.includes(p.id)), [players, takenPlayerIds]);
  const slotsFor = (p: NflPlayer) => eligibleSlotsFor(p.position).filter((s) => openSlots.includes(s));
  // Only players who fit one of your open slots.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < MIN_QUERY) return [];
    // Best name matches first; among equals, the more established player (more games).
    return available
      .map((p) => ({ p, rank: nameMatchRank(p.name, q) }))
      .filter(({ p, rank }) => rank >= 0 && slotsFor(p).length > 0)
      .sort((a, b) => a.rank - b.rank || (b.p.summary?.gp ?? 0) - (a.p.summary?.gp ?? 0) || a.p.name.localeCompare(b.p.name))
      .slice(0, 25)
      .map(({ p }) => p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, query, openSlots.join(",")]);
  const selectedSlots = selected ? slotsFor(selected) : [];

  // Respin only when there's genuinely nothing to do with this team.
  const anyEligiblePlayer = available.some((p) => slotsFor(p).length > 0);
  const canLockDefense = defenseOpen && !defenseBlocked;
  const stuck = !loading && !anyEligiblePlayer && !canLockDefense;

  const choose = (p: NflPlayer) => {
    setSelected(p);
    setQuery(p.name);
    setOpen(false);
    const s = slotsFor(p);
    setSlot(s.length === 1 ? s[0] : null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(matches[activeIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  if (loading) {
    return <div className="rounded-lg bg-zinc-900 p-6 text-center text-zinc-400">Loading {teamName}…</div>;
  }

  const activeSeason = context?.statsSeason ?? null;

  return (
    <div className="rounded-lg bg-zinc-900 p-4 space-y-4">
      <h3 className="font-semibold text-orange-400">Pick from the {teamName}</h3>

      {(loadError || stuck) && (
        <div className="rounded-md border border-amber-700/50 bg-amber-900/30 p-3 text-sm text-amber-200">
          <p>
            {loadError
              ? "Couldn't load this team's players. Try spinning again."
              : `Nobody on the ${teamName} fits your open slots${defenseOpen ? ", and their defense is taken" : ""}.`}
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

      {!stuck && openSlots.length > 0 && (
        <div>
          <div className="relative">
            <input
              type="text"
              placeholder="Type a player's name…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
                setOpen(e.target.value.trim().length >= MIN_QUERY);
                if (selected && e.target.value !== selected.name) {
                  setSelected(null);
                  setSlot(null);
                }
              }}
              onFocus={() => query.trim().length >= MIN_QUERY && setOpen(true)}
              onBlur={() => setOpen(false)}
              onKeyDown={onKeyDown}
              className="w-full py-3 px-4 rounded-md bg-zinc-800 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
            {open && matches.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-800 rounded-md border border-zinc-700 max-h-56 overflow-y-auto z-50">
                {matches.map((p, i) => {
                  const line = statLine(p);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        choose(p);
                      }}
                      className={`w-full text-left py-2.5 px-4 transition ${i === activeIndex ? "bg-orange-600 text-white" : "text-zinc-100 hover:bg-zinc-700"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{p.name}</span>
                        <span className="flex items-center gap-1.5 text-xs opacity-80">
                          {p.isRookie && <span className="rounded bg-sky-700/70 px-1.5 py-0.5 text-sky-100">Rookie</span>}
                          {p.position}
                        </span>
                      </div>
                      {line && <div className="text-xs opacity-75 tabular-nums mt-0.5">{line}</div>}
                    </button>
                  );
                })}
              </div>
            )}
            {open && query.trim().length >= MIN_QUERY && matches.length === 0 && (
              <p className="mt-2 text-xs text-zinc-500">
                No {teamName}{gameMode === "active_only" ? " (current roster)" : ""} player by that name fits your open slots.
              </p>
            )}
          </div>

          {selected && (
            <div className="mt-3 space-y-3">
              <div className="p-3 rounded-md bg-zinc-800 border border-orange-500 text-sm">
                <span className="font-medium text-white">{selected.name}</span>
                <span className="text-zinc-400"> · {selected.position}</span>
                {statLine(selected) && <div className="text-xs text-zinc-400 tabular-nums mt-0.5">{statLine(selected)}</div>}
                {selected.isRookie && (
                  <span className="ml-2 text-xs text-sky-300">Rookie — stats projected until week 10</span>
                )}
              </div>
              {selectedSlots.length === 0 ? (
                <p className="text-sm text-zinc-400">You don&apos;t have an open slot for a {selected.position}.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {selectedSlots.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSlot(s)}
                      className={`py-2 px-4 rounded-lg text-sm font-medium transition touch-manipulation ${slot === s ? "bg-orange-600 text-white" : "bg-zinc-800 hover:bg-zinc-700 text-white"}`}
                    >
                      {NFL_SLOT_LABELS[s]}
                    </button>
                  ))}
                </div>
              )}
              {slot && (
                <button
                  type="button"
                  onClick={() => onPickPlayer(slot, selected)}
                  className="w-full py-3.5 rounded-lg bg-green-600 hover:bg-green-500 font-semibold touch-manipulation min-h-[48px]"
                >
                  Confirm: {selected.name} → {NFL_SLOT_LABELS[slot]}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {defenseOpen && !stuck && (
        <div className="border-t border-zinc-800 pt-4">
          <p className="text-sm text-zinc-400 mb-2">
            Or lock in the <span className="text-white font-medium">{teamName}</span> as your team defense
            {defenseSetsDivision && <span className="block text-xs text-zinc-500 mt-0.5">Your team will play in their division.</span>}
          </p>
          {gameMode === "all_time" && !defenseBlocked && (
            <p className="text-xs text-zinc-500 mb-2">★ = best defense in franchise history (per game, vs. that season&apos;s league)</p>
          )}
          {defenseBlocked ? (
            <p className="text-sm text-zinc-500">Your opponent already locked the {teamName} defense.</p>
          ) : gameMode === "active_only" ? (
            <button
              type="button"
              disabled={!activeSeason}
              onClick={() => activeSeason && onLockDefense(activeSeason)}
              className="w-full py-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 font-semibold transition"
            >
              {activeSeason ? `Lock ${activeSeason} ${teamName} defense` : "Loading…"}
            </button>
          ) : (
            <div className="flex gap-2">
              <select
                value={defenseSeason ?? ""}
                onChange={(e) => setDefenseSeason(Number(e.target.value))}
                className="flex-1 min-w-0 py-3 px-3 rounded-lg bg-zinc-800 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                aria-label="Defense season"
              >
                {defenseSeasons.map((s) => (
                  <option key={s.season} value={s.season}>
                    {s.best ? "★ " : ""}{s.season} · {s.wins}-{s.losses}{s.ties ? `-${s.ties}` : ""} · {s.pointsAllowedPerGame} PA · {s.takeawaysPerGame} TO
                    {s.sacksPerGame != null ? ` · ${s.sacksPerGame} SK` : ""}
                    {s.teamName !== teamName ? ` (${s.teamName})` : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={defenseSeason == null}
                onClick={() => defenseSeason != null && onLockDefense(defenseSeason)}
                className="py-3 px-4 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 font-semibold transition shrink-0"
              >
                Lock defense
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
