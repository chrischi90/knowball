import { fetchNflTeams } from "@/lib/nfl-api";
import { proxyNfl } from "../_proxy";

// Evaluate per request (never prerender at build time); upstream fetch caching still applies.
export const dynamic = "force-dynamic";

export async function GET() {
  return proxyNfl(() => fetchNflTeams(), "No NFL teams found");
}
