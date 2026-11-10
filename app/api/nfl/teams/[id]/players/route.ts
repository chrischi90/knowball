import { fetchNflTeamPlayers, isValidNflTeamId, parseNflGameMode } from "@/lib/nfl-api";
import { badRequest, proxyNfl } from "../../../_proxy";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!isValidNflTeamId(id)) return badRequest("Invalid team ID");
  const gameMode = parseNflGameMode(new URL(req.url).searchParams.get("game_mode"));
  if (!gameMode) return badRequest("game_mode must be all_time or active_only");
  return proxyNfl(() => fetchNflTeamPlayers(id, gameMode), "No roster data for this team");
}
