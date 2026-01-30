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
  teamId: string
): Promise<{ players: NBAPlayer[] }> {
  const res = await fetch(`${NBA_SERVICE_URL}/teams/${teamId}/players`);
  if (!res.ok) throw new Error("Failed to fetch team players");
  return res.json();
}

export async function fetchPlayerStats(
  playerId: string
): Promise<PlayerStats | null> {
  const res = await fetch(`${NBA_SERVICE_URL}/players/${playerId}/stats`);
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
