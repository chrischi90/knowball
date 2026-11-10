import { fetchNflTeamDefense, isValidNflTeamId } from "@/lib/nfl-api";
import { badRequest, proxyNfl } from "../../../_proxy";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!isValidNflTeamId(id)) return badRequest("Invalid team ID");
  const raw = new URL(req.url).searchParams.get("season");
  const season = raw == null || raw === "" ? undefined : Number(raw);
  if (season !== undefined && !Number.isInteger(season)) return badRequest("season must be a year");
  return proxyNfl(() => fetchNflTeamDefense(id, season), "No defense data for this team and season");
}
