/**
 * Client for the Python data service's NFL endpoints (/nfl/...). Same service and
 * NBA_SERVICE_URL as lib/nba-api.ts — NFL routes are mounted alongside NBA ones.
 */
import type {
  NflLeagueSeason,
  NflPlayer,
  NflPlayerStats,
  NflSeasonContext,
  NflTeam,
  NflTeamDefense,
  NflTeamSeason,
} from "@/lib/nfl-types";

const SERVICE_URL = process.env.NBA_SERVICE_URL || "http://localhost:8000";

export type NflGameMode = "all_time" | "active_only";

type FetchContext = { requestId?: string };

/** Thrown for non-OK service responses; routes map 404 → 404 and anything else → 502. */
export class NflServiceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const TEAM_ID_RE = /^[A-Z]{2,3}$/;
const PLAYER_ID_RE = /^[A-Za-z0-9-]{1,20}$/;

export function isValidNflTeamId(id: string | null | undefined): id is string {
  return !!id && TEAM_ID_RE.test(id);
}

export function isValidNflPlayerId(id: string | null | undefined): id is string {
  return !!id && PLAYER_ID_RE.test(id);
}

export function parseNflGameMode(value: string | null | undefined): NflGameMode | null {
  if (value == null || value === "") return "all_time";
  return value === "all_time" || value === "active_only" ? value : null;
}

async function get<T>(path: string, revalidate: number, ctx?: FetchContext): Promise<T> {
  const res = await fetch(`${SERVICE_URL}/nfl${path}`, {
    next: { revalidate },
    signal: AbortSignal.timeout(10_000),
    headers: ctx?.requestId ? { "x-request-id": ctx.requestId } : undefined,
  });
  if (!res.ok) {
    let detail = `NFL service error ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      // non-JSON error body
    }
    throw new NflServiceError(detail, res.status);
  }
  return res.json() as Promise<T>;
}

const HOUR = 3600;

export function fetchNflSeasonContext(ctx?: FetchContext) {
  return get<NflSeasonContext>("/season-context", 600, ctx);
}

export function fetchNflTeams(ctx?: FetchContext) {
  return get<{ teams: NflTeam[] }>("/teams", 24 * HOUR, ctx);
}

export function fetchNflTeamPlayers(teamId: string, gameMode: NflGameMode, ctx?: FetchContext) {
  // Current rosters change during the season; refresh hourly.
  return get<{ players: NflPlayer[] }>(
    `/teams/${teamId}/players?game_mode=${gameMode}`,
    HOUR,
    ctx
  );
}

export function fetchNflPlayerStats(
  playerId: string,
  teamId: string,
  gameMode: NflGameMode,
  ctx?: FetchContext
) {
  const qs = new URLSearchParams({ team_id: teamId, game_mode: gameMode });
  return get<NflPlayerStats>(`/players/${playerId}/stats?${qs}`, HOUR, ctx);
}

export function fetchNflDefenseSeasons(teamId: string, ctx?: FetchContext) {
  return get<{ seasons: NflTeamSeason[] }>(`/teams/${teamId}/defense/seasons`, 24 * HOUR, ctx);
}

export function fetchNflTeamDefense(teamId: string, season?: number, ctx?: FetchContext) {
  const qs = season != null ? `?season=${season}` : "";
  return get<NflTeamDefense>(`/teams/${teamId}/defense${qs}`, HOUR, ctx);
}

export function fetchNflLeagueSeason(season?: number, ctx?: FetchContext) {
  const qs = season != null ? `?season=${season}` : "";
  return get<NflLeagueSeason>(`/league/teams${qs}`, 24 * HOUR, ctx);
}
