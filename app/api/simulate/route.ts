import { NextResponse } from "next/server";
import { fetchPlayerStats } from "@/lib/nba-api";
import type { PlayerStats } from "@/lib/nba-api";
import type { Roster } from "@/lib/game-types";
import { POSITIONS } from "@/lib/game-types";
import {
  buildStatsMap,
  computeHybridMatchupWinProbability,
  computeTeamProfile,
  resolveRosterStats,
  simulateHeadToHeadGame,
} from "@/lib/simulation-engine";

type Body = {
  roster1: Roster;
  roster2: Roster;
  gameMode?: string;
  providedStats1?: (Partial<PlayerStats> | null)[];
  providedStats2?: (Partial<PlayerStats> | null)[];
};
const ALLOWED_GAME_MODES = new Set(["all_time", "active_only"]);

function toPlayerStatsList(
  roster: Roster,
  provided: (Partial<PlayerStats> | null)[] | undefined
): (PlayerStats | null)[] | null {
  if (!Array.isArray(provided) || provided.length !== POSITIONS.length) return null;

  return POSITIONS.map((position, index) => {
    const slot = roster[position];
    const source = provided[index];
    if (!slot.playerId || !source) return null;

    return {
      player_id: source.player_id ?? slot.playerId,
      gp: Number(source.gp ?? 0),
      pts: Number(source.pts ?? 0),
      reb: Number(source.reb ?? 0),
      ast: Number(source.ast ?? 0),
      stl: Number(source.stl ?? 0),
      blk: Number(source.blk ?? 0),
      mpg: source.mpg == null ? undefined : Number(source.mpg),
      fgm: source.fgm == null ? undefined : Number(source.fgm),
      fga: source.fga == null ? undefined : Number(source.fga),
      fg3m: source.fg3m == null ? undefined : Number(source.fg3m),
      fg3a: source.fg3a == null ? undefined : Number(source.fg3a),
      ftm: source.ftm == null ? undefined : Number(source.ftm),
      fta: source.fta == null ? undefined : Number(source.fta),
      tov: source.tov == null ? undefined : Number(source.tov),
      pf: source.pf == null ? undefined : Number(source.pf),
      fg_pct: source.fg_pct == null ? undefined : Number(source.fg_pct),
      fg3_pct: source.fg3_pct == null ? undefined : Number(source.fg3_pct),
      ft_pct: source.ft_pct == null ? undefined : Number(source.ft_pct),
      per: source.per == null ? undefined : Number(source.per),
      ts_pct: source.ts_pct == null ? undefined : Number(source.ts_pct),
      three_par: source.three_par == null ? undefined : Number(source.three_par),
      ftr: source.ftr == null ? undefined : Number(source.ftr),
      orb_pct: source.orb_pct == null ? undefined : Number(source.orb_pct),
      drb_pct: source.drb_pct == null ? undefined : Number(source.drb_pct),
      trb_pct: source.trb_pct == null ? undefined : Number(source.trb_pct),
      ast_pct: source.ast_pct == null ? undefined : Number(source.ast_pct),
      stl_pct: source.stl_pct == null ? undefined : Number(source.stl_pct),
      blk_pct: source.blk_pct == null ? undefined : Number(source.blk_pct),
      tov_pct: source.tov_pct == null ? undefined : Number(source.tov_pct),
      usg_pct: source.usg_pct == null ? undefined : Number(source.usg_pct),
      ows: source.ows == null ? undefined : Number(source.ows),
      dws: source.dws == null ? undefined : Number(source.dws),
      ws: source.ws == null ? undefined : Number(source.ws),
      ws48: source.ws48 == null ? undefined : Number(source.ws48),
      obpm: source.obpm == null ? undefined : Number(source.obpm),
      dbpm: source.dbpm == null ? undefined : Number(source.dbpm),
      bpm: source.bpm == null ? undefined : Number(source.bpm),
      vorp: source.vorp == null ? undefined : Number(source.vorp),
      stocks: source.stocks == null ? undefined : Number(source.stocks),
    };
  });
}

// Cap concurrent simulations to prevent event-loop saturation under spikes
let _activeSimulations = 0;
const MAX_CONCURRENT_SIMULATIONS = 20;

export async function POST(req: Request) {
  if (_activeSimulations >= MAX_CONCURRENT_SIMULATIONS) {
    return NextResponse.json({ error: "Server busy, please try again shortly" }, { status: 503 });
  }
  _activeSimulations++;
  try {
    const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
    const body = (await req.json()) as Body;
    const { roster1, roster2, gameMode } = body;
    if (!roster1 || !roster2) {
      return NextResponse.json(
        { error: "rosters required" },
        { status: 400 }
      );
    }

    const count1 = POSITIONS.filter((p) => roster1[p].playerId).length;
    const count2 = POSITIONS.filter((p) => roster2[p].playerId).length;
    if (gameMode && !ALLOWED_GAME_MODES.has(gameMode)) {
      return NextResponse.json({ error: "Invalid gameMode" }, { status: 400 });
    }
    if (count1 !== 5 || count2 !== 5) {
      return NextResponse.json(
        { error: "Each roster must have 5 players" },
        { status: 400 }
      );
    }

    const providedStats1 = toPlayerStatsList(roster1, body.providedStats1);
    const providedStats2 = toPlayerStatsList(roster2, body.providedStats2);

    const fetchAll = async (roster: Roster) =>
      Promise.all(
        POSITIONS.map(async (p) => {
          const slot = roster[p];
          if (!slot.playerId) return null;

          if (!slot.teamId) {
            return fetchPlayerStats(slot.playerId, null, slot.playerName, gameMode, { requestId }).catch(() => null);
          }

          const teamScoped = await fetchPlayerStats(
            slot.playerId,
            slot.teamId,
            slot.playerName,
            gameMode,
            { requestId }
          ).catch(() => null);
          if (teamScoped) return teamScoped;

          return fetchPlayerStats(slot.playerId, null, slot.playerName, gameMode, { requestId }).catch(() => null);
        })
      );

    const [rawStats1, rawStats2] =
      providedStats1 && providedStats2
        ? [providedStats1, providedStats2]
        : await Promise.all([fetchAll(roster1), fetchAll(roster2)]);
    const stats1 = resolveRosterStats(roster1, rawStats1);
    const stats2 = resolveRosterStats(roster2, rawStats2);
    const team1Profile = computeTeamProfile(roster1, stats1);
    const team2Profile = computeTeamProfile(roster2, stats2);
    const hybrid = computeHybridMatchupWinProbability(team1Profile, team2Profile);
    const gameResult = simulateHeadToHeadGame(
      team1Profile.teamRating,
      team2Profile.teamRating,
      hybrid.blendedWinProbability
    );

    return NextResponse.json({
      winner: gameResult.winner,
      team1Score: gameResult.team1Score,
      team2Score: gameResult.team2Score,
      team1WinProbability: gameResult.team1WinProbability,
      team2WinProbability: gameResult.team2WinProbability,
      team1RatingWinProbability: hybrid.ratingWinProbability,
      team2RatingWinProbability: Math.round((1 - hybrid.ratingWinProbability) * 1000) / 1000,
      team1PythagoreanWinProbability: hybrid.pythagoreanWinProbability,
      team2PythagoreanWinProbability: Math.round((1 - hybrid.pythagoreanWinProbability) * 1000) / 1000,
      team1BlendedWinProbability: hybrid.blendedWinProbability,
      team2BlendedWinProbability: Math.round((1 - hybrid.blendedWinProbability) * 1000) / 1000,
      hybridBlendWeight: hybrid.blendWeight,
      team1Rating: team1Profile.teamRating,
      team2Rating: team2Profile.teamRating,
      team1EstimatedPointsFor: hybrid.team1EstimatedPointsFor,
      team1EstimatedPointsAgainst: hybrid.team1EstimatedPointsAgainst,
      team2EstimatedPointsFor: hybrid.team2EstimatedPointsFor,
      team2EstimatedPointsAgainst: hybrid.team2EstimatedPointsAgainst,
      team1Diagnostics: team1Profile.diagnostics,
      team2Diagnostics: team2Profile.diagnostics,
      playerStats1: buildStatsMap(roster1, stats1),
      playerStats2: buildStatsMap(roster2, stats2),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Simulation failed" },
      { status: 500 }
    );
  } finally {
    _activeSimulations--;
  }
}
