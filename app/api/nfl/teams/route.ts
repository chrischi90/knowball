import { fetchNflTeams } from "@/lib/nfl-api";
import { proxyNfl } from "../_proxy";

export async function GET() {
  return proxyNfl(() => fetchNflTeams(), "No NFL teams found");
}
