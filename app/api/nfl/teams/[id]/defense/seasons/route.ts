import { fetchNflDefenseSeasons, isValidNflTeamId } from "@/lib/nfl-api";
import { badRequest, proxyNfl } from "../../../../_proxy";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!isValidNflTeamId(id)) return badRequest("Invalid team ID");
  return proxyNfl(() => fetchNflDefenseSeasons(id), "No defense seasons for this team");
}
