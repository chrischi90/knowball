/**
 * Base URL for the Python NBA data service. Default: http://localhost:8000
 */
const NBA_SERVICE_URL =
  process.env.NBA_SERVICE_URL || "http://localhost:8000";

type FetchContext = {
  requestId?: string;
};

function requestHeaders(ctx?: FetchContext): HeadersInit | undefined {
  if (!ctx?.requestId) return undefined;
  return { "x-request-id": ctx.requestId };
}

export async function fetchTeams(ctx?: FetchContext): Promise<{ teams: NBATeam[] }> {
  const res = await fetch(`${NBA_SERVICE_URL}/teams`, {
    next: { revalidate: 3600 },
    signal: AbortSignal.timeout(10_000),
    headers: requestHeaders(ctx),
  });
  if (!res.ok) throw new Error("Failed to fetch teams");
  return res.json();
}

export async function fetchTeamPlayers(
  teamId: string,
  options?: { activeOnly?: boolean },
  ctx?: FetchContext
): Promise<{ players: NBAPlayer[] }> {
  const params = new URLSearchParams();
  if (options?.activeOnly) params.set("active_only", "true");
  const qs = params.toString();
  const url = `${NBA_SERVICE_URL}/teams/${teamId}/players${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    next: { revalidate: 86400 },
    signal: AbortSignal.timeout(10_000),
    headers: requestHeaders(ctx),
  });
  if (!res.ok) throw new Error("Failed to fetch team players");
  return res.json();
}

export async function fetchPlayerStats(
  playerId: string,
  teamId?: string | null,
  playerName?: string | null,
  gameMode?: string | null,
  ctx?: FetchContext
): Promise<PlayerStats | null> {
  const params = new URLSearchParams();
  if (teamId) params.set("team_id", teamId);
  if (playerName) params.set("player_name", playerName);
  if (gameMode) params.set("game_mode", gameMode);
  const qs = params.toString();
  const url = `${NBA_SERVICE_URL}/players/${playerId}/stats${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    next: { revalidate: 604800 },
    signal: AbortSignal.timeout(10_000),
    headers: requestHeaders(ctx),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Failed to fetch player stats");
  return res.json();
}

export type NBATeam = {
  id: string;
  full_name: string;
  abbreviation: string;
  nickname: string;
  city: string;
};

export type NBAPlayer = {
  id: string;
  name: string;
  position: string;
  jersey?: string;
};

export type PlayerStats = {
  player_id: string;
  gp: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  stocks?: number;
  mpg?: number;
  fgm?: number;
  fga?: number;
  fg3m?: number;
  fg3a?: number;
  ftm?: number;
  fta?: number;
  tov?: number;
  pf?: number;
  fg_pct?: number;
  fg3_pct?: number;
  ft_pct?: number;
  per?: number | null;
  ts_pct?: number | null;
  three_par?: number | null;
  ftr?: number | null;
  orb_pct?: number | null;
  drb_pct?: number | null;
  trb_pct?: number | null;
  ast_pct?: number | null;
  stl_pct?: number | null;
  blk_pct?: number | null;
  tov_pct?: number | null;
  usg_pct?: number | null;
  ows?: number | null;
  dws?: number | null;
  ws?: number | null;
  ws48?: number | null;
  obpm?: number | null;
  dbpm?: number | null;
  bpm?: number | null;
  vorp?: number | null;
};
