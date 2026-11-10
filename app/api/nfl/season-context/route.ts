import { fetchNflSeasonContext } from "@/lib/nfl-api";
import { proxyNfl } from "../_proxy";

export async function GET() {
  return proxyNfl(() => fetchNflSeasonContext(), "Season context not found");
}
