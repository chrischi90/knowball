/**
 * Server-side roster loading for NFL simulations. Stats are always fetched here (never taken
 * from the client), so results can't be spoofed, and eligibility is re-checked server-side.
 */
import {
  NflServiceError,
  fetchNflPlayerStats,
  fetchNflTeamDefense,
  isValidNflPlayerId,
  isValidNflTeamId,
  type NflGameMode,
} from "@/lib/nfl-api";
import {
  NFL_PLAYER_SLOTS,
  NFL_SLOT_LABELS,
  isEligibleForSlot,
  type NflPlayerSlot,
  type NflPlayerStats,
  type NflRoster,
} from "@/lib/nfl-types";
import { buildTeamProfile, type NflSimRoster, type TeamProfile } from "@/lib/nfl-sim";

export class RosterError extends Error {}

/** Structural validation of a client-sent roster. Returns an error message or null. */
export function validateRosterShape(roster: unknown): string | null {
  if (!roster || typeof roster !== "object") return "roster required";
  const r = roster as Partial<NflRoster>;
  for (const slot of NFL_PLAYER_SLOTS) {
    const s = r[slot];
    if (!s || !isValidNflPlayerId(s.playerId) || !isValidNflTeamId(s.teamId)) {
      return `${NFL_SLOT_LABELS[slot]} is not filled`;
    }
  }
  const def = r.TEAM_DEF;
  if (!def || !isValidNflTeamId(def.teamId) || !Number.isInteger(def.season)) return "Team Defense is not filled";
  return null;
}

/** Replacement-level stand-in for a rostered player with no stats anywhere. */
function replacementStats(playerId: string, teamId: string): NflPlayerStats {
  return {
    playerId, teamId, position: "QB", gp: 0, gs: 0, seasons: [], statsTeamId: teamId,
    passing: null, rushing: null, receiving: null, defense: null,
    league: { passing: null, rushing: null, receiving: null, defense: null },
    source: "projection",
  };
}

export async function loadTeamProfile(
  roster: NflRoster,
  gameMode: NflGameMode,
  name: string,
  ctx?: { requestId?: string }
): Promise<{ profile: TeamProfile; simRoster: NflSimRoster }> {
  const players = await Promise.all(
    NFL_PLAYER_SLOTS.map(async (slot: NflPlayerSlot) => {
      const s = roster[slot];
      try {
        const stats = await fetchNflPlayerStats(s.playerId!, s.teamId!, gameMode, ctx);
        if (!isEligibleForSlot(slot, stats.position)) {
          throw new RosterError(`${s.playerName ?? "Player"} (${stats.position}) can't play ${NFL_SLOT_LABELS[slot]}`);
        }
        return { slot, player: { name: s.playerName ?? "Unknown", stats } };
      } catch (e) {
        if (e instanceof NflServiceError && e.status === 404) {
          return { slot, player: { name: s.playerName ?? "Unknown", stats: replacementStats(s.playerId!, s.teamId!) } };
        }
        throw e;
      }
    })
  );
  const defense = await fetchNflTeamDefense(roster.TEAM_DEF.teamId!, roster.TEAM_DEF.season!, ctx).catch((e) => {
    if (e instanceof NflServiceError && e.status === 404) {
      throw new RosterError(`No defense data for ${roster.TEAM_DEF.teamName ?? roster.TEAM_DEF.teamId} ${roster.TEAM_DEF.season}`);
    }
    throw e;
  });

  const simRoster = { name, TEAM_DEF: defense } as NflSimRoster;
  for (const { slot, player } of players) simRoster[slot] = player;
  return { profile: buildTeamProfile(simRoster), simRoster };
}

/** Compact, UI-friendly view of a team profile (raw units: 0 = league average, ~1 = elite). */
export function summarizeProfile(p: TeamProfile) {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    name: p.name,
    units: {
      passing: r2(p.pass),
      rushing: r2(p.rush),
      ballSecurity: r2(p.secure),
      passDefense: r2(p.passDef),
      runDefense: r2(p.runDef),
      takeaways: r2(p.takeaway),
      passRush: r2(p.passRush),
    },
    passShare: r2(p.passShare),
    players: p.players.map((pl) => ({ ...pl, value: r2(pl.value) })),
  };
}

/** Best-rated individual player (MVP callout). */
export function mvpOf(p: TeamProfile) {
  return p.players
    .filter((pl) => pl.slot !== "TEAM_DEF")
    .reduce((best, pl) => (pl.value > best.value ? pl : best));
}
