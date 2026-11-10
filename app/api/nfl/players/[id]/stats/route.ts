import {
  fetchNflPlayerStats,
  isValidNflPlayerId,
  isValidNflTeamId,
  parseNflGameMode,
} from "@/lib/nfl-api";
import { badRequest, proxyNfl } from "../../../_proxy";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!isValidNflPlayerId(id)) return badRequest("Invalid player ID");
  const search = new URL(req.url).searchParams;
  const teamId = search.get("team_id");
  if (!isValidNflTeamId(teamId)) return badRequest("team_id is required");
  const gameMode = parseNflGameMode(search.get("game_mode"));
  if (!gameMode) return badRequest("game_mode must be all_time or active_only");
  return proxyNfl(() => fetchNflPlayerStats(id, teamId, gameMode), "Player stats not found");
}
