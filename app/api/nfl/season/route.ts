/**
 * 1-player season: the user's roster joins last season's real league for 17 games + playoffs.
 */
import { NextResponse } from "next/server";
import { fetchNflLeagueSeason, parseNflGameMode } from "@/lib/nfl-api";
import type { NflRoster } from "@/lib/nfl-types";
import { randomSeed, simulateSeason } from "@/lib/nfl-sim";
import { RosterError, loadTeamProfile, mvpOf, summarizeProfile, validateRosterShape } from "../_sim";

type Body = { roster: NflRoster; gameMode?: string; name?: string };

let active = 0;
const MAX_CONCURRENT = 10;

export async function POST(req: Request) {
  if (active >= MAX_CONCURRENT) {
    return NextResponse.json({ error: "Server busy, please try again shortly" }, { status: 503 });
  }
  active++;
  try {
    const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    const gameMode = parseNflGameMode(body.gameMode);
    if (!gameMode) return NextResponse.json({ error: "Invalid gameMode" }, { status: 400 });
    const err = validateRosterShape(body.roster);
    if (err) return NextResponse.json({ error: err }, { status: 400 });

    const name = String(body.name ?? "Your Team").slice(0, 40);
    const [{ profile }, league] = await Promise.all([
      loadTeamProfile(body.roster, gameMode, name, { requestId }),
      fetchNflLeagueSeason(undefined, { requestId }),
    ]);
    const result = simulateSeason(profile, league, {
      seed: randomSeed(),
      homeTeamId: body.roster.TEAM_DEF.teamId,
    });
    return NextResponse.json({ ...result, team: summarizeProfile(profile), mvp: mvpOf(profile) });
  } catch (e) {
    if (e instanceof RosterError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Season simulation failed" }, { status: 502 });
  } finally {
    active--;
  }
}
