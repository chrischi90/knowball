/**
 * Base URL for the Python NBA data service. Default: http://localhost:8000
 */
const NBA_SERVICE_URL =
  process.env.NBA_SERVICE_URL || "http://localhost:8000";

export async function fetchTeams(): Promise<{ teams: NBATeam[] }> {
  const res = await fetch(`${NBA_SERVICE_URL}/teams`, {
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error("Failed to fetch teams");
  return res.json();
}

export async function fetchTeamPlayers(
  teamId: string,
  options?: { activeOnly?: boolean }
): Promise<{ players: NBAPlayer[] }> {
  const params = new URLSearchParams();
  if (options?.activeOnly) params.set("active_only", "true");
  const qs = params.toString();
  const url = `${NBA_SERVICE_URL}/teams/${teamId}/players${qs ? `?${qs}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch team players");
  return res.json();
}

export async function fetchPlayerStats(
  playerId: string,
  teamId?: string | null
): Promise<PlayerStats | null> {
  const url = teamId
    ? `${NBA_SERVICE_URL}/players/${playerId}/stats?team_id=${teamId}`
    : `${NBA_SERVICE_URL}/players/${playerId}/stats`;
  const res = await fetch(url);
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
};
