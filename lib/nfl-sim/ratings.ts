/**
 * Layers 1 + 2 of the NFL sim: player ratings (era-adjusted, relative to the league average
 * starter of the same seasons) and roster fit, producing a TeamProfile for the drive engine.
 *
 * Scale: 0 = league-average starter/unit, ~1 = elite (top few in the league). There is NO
 * ceiling — a historically great player can be well above 1, and super teams are expected.
 */
import type { NflPlayerStats, NflPosition, NflTeamDefense } from "@/lib/nfl-types";

export type NflSimPlayer = {
  name: string;
  stats: NflPlayerStats;
};

export type NflSimRoster = {
  name: string;
  QB: NflSimPlayer;
  RB: NflSimPlayer;
  WR1: NflSimPlayer;
  WR2: NflSimPlayer;
  WR3: NflSimPlayer;
  TE: NflSimPlayer;
  DEF_CAPTAIN: NflSimPlayer;
  TEAM_DEF: NflTeamDefense;
};

export type ReceiverArchetype = "deep" | "possession" | "redzone" | "balanced";
export type CaptainArchetype = "passRush" | "coverage" | "runStop";

export type PlayerRating = {
  name: string;
  slot: string;
  value: number;
  archetype?: ReceiverArchetype | CaptainArchetype;
};

export type TeamProfile = {
  name: string;
  /** Passing unit strength (QB × receivers, plus play-action). */
  pass: number;
  /** Rushing unit strength. */
  rush: number;
  /** Share of plays that are passes — teams lean on their strength. */
  passShare: number;
  /** Ball security (avoiding INTs/fumbles). */
  secure: number;
  /** Pass defense strength. */
  passDef: number;
  /** Run defense strength. */
  runDef: number;
  /** Takeaway ability. */
  takeaway: number;
  /** Pass rush (pressures → sacks, rushed throws). */
  passRush: number;
  players: PlayerRating[];
  /** Weights used to attribute TDs/turnovers to players in key moments. */
  attribution: {
    receivers: { name: string; weight: number }[];
    qbName: string;
    rbName: string;
    qbRushShare: number;
    captainName: string;
    captainArchetype: CaptainArchetype;
    defenseName: string;
  };
};

/**
 * Backtest calibration: rebuilding all 861 real team-seasons (1999-2025) and regressing actual
 * point differential on simulated showed the raw ratings spread teams ~1.37x too far apart
 * (slope 0.73, r 0.90). Scaling unit strengths by this factor makes real rosters reproduce
 * real results. It's a uniform scale, not a cap — super teams still dominate on merit.
 * Re-run scripts/backtest_nfl.ts after changing any rating weights.
 */
export const RATING_SCALE = 0.72;

const safeDiv = (n: number, d: number) => (d > 0 ? n / d : 0);
const nz = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? 0 : v);

/**
 * Small-sample regression: a player's value is pulled toward replacement level when they
 * have few games, so a backup's one great game doesn't make him an MVP. Projections are
 * already shaped (and capped) by the service, so they're trusted as-is.
 */
export const REPLACEMENT_LEVEL = -0.6;
export function regress(value: number, stats: NflPlayerStats, priorGames = 3): number {
  if (stats.source === "projection") return value;
  const w = stats.gp / (stats.gp + priorGames);
  return w * value + (1 - w) * REPLACEMENT_LEVEL;
}

// ---------------------------------------------------------------------------
// Quarterback
// ---------------------------------------------------------------------------

/** Adjusted net yards per attempt (yards + 20·TD − 45·INT − ~6.5 yds per sack) / dropbacks. */
export function anyA(p: { att: number; yds: number; td: number; int: number; sacked: number }): number {
  return safeDiv(p.yds + 20 * p.td - 45 * p.int - 6.5 * p.sacked, p.att + p.sacked);
}

export function rateQb(s: NflPlayerStats) {
  const p = s.passing;
  const lp = s.league.passing;
  if (!p || !lp) return { pass: REPLACEMENT_LEVEL, rush: 0, secure: 0 };
  // Elite ≈ +1.8 ANY/A over the league-average starter of the same seasons (sustained;
  // single historic seasons reach +3 to +4 and rate far above 1).
  const pass = regress((anyA(p) - anyA(lp)) / 1.8, s);
  const rushYds = nz(s.rushing?.yds);
  const lgRushYds = nz(s.league.rushing?.yds);
  const rush = regress((rushYds - lgRushYds) / 50, s, 3);
  // INT rate vs league: elite ball security ≈ 1.2 percentage points better.
  const intRate = safeDiv(p.int, p.att);
  const lgIntRate = safeDiv(lp.int, lp.att);
  const secure = regress((lgIntRate - intRate) / 0.012, s, 3);
  return { pass, rush, secure };
}

// ---------------------------------------------------------------------------
// Running back
// ---------------------------------------------------------------------------

export function rateRb(s: NflPlayerStats) {
  const r = s.rushing;
  const lr = s.league.rushing;
  if (!r || !lr) return { rush: REPLACEMENT_LEVEL, receiving: 0, secure: 0 };
  const ypc = safeDiv(r.yds, r.att) - safeDiv(lr.yds, lr.att);
  const volume = r.yds - lr.yds;
  const td = r.td - lr.td;
  const recYds = nz(s.receiving?.yds) - nz(s.league.receiving?.yds);
  const rush = regress(0.4 * (ypc / 0.8) + 0.35 * (volume / 30) + 0.1 * (td / 0.4) + 0.15 * (recYds / 25), s);
  const receiving = regress(recYds / 25, s);
  const secure = regress((nz(lr.fumblesLost) - nz(r.fumblesLost)) / 0.08, s, 3);
  return { rush, receiving, secure };
}

// ---------------------------------------------------------------------------
// Receivers
// ---------------------------------------------------------------------------

export function rateReceiver(s: NflPlayerStats): { value: number; archetype: ReceiverArchetype } {
  const r = s.receiving;
  const lr = s.league.receiving;
  if (!r || !lr) return { value: REPLACEMENT_LEVEL, archetype: "balanced" };
  const ydsPg = (r.yds - lr.yds) / 25;
  const tdPg = (r.td - lr.td) / 0.3;
  let value: number;
  let catchRateDiff = 0;
  if (r.tgt != null && lr.tgt != null && r.tgt > 0 && lr.tgt > 0) {
    const ypt = (safeDiv(r.yds, r.tgt) - safeDiv(lr.yds, lr.tgt)) / 1.2;
    catchRateDiff = safeDiv(r.rec, r.tgt) - safeDiv(lr.rec, lr.tgt);
    value = 0.4 * ydsPg + 0.35 * ypt + 0.15 * tdPg + 0.1 * (catchRateDiff / 0.08);
  } else {
    // Targets not tracked (2003-2008): lean on production + yards per catch.
    const ypr = (safeDiv(r.yds, r.rec) - safeDiv(lr.yds, lr.rec)) / 2.5;
    value = 0.55 * ydsPg + 0.2 * ypr + 0.25 * tdPg;
  }
  const yprDiff = safeDiv(r.yds, r.rec) - safeDiv(lr.yds, lr.rec);
  let archetype: ReceiverArchetype = "balanced";
  if (yprDiff >= 2) archetype = "deep";
  else if (catchRateDiff >= 0.05 || (yprDiff <= -1 && r.rec >= lr.rec)) archetype = "possession";
  else if (tdPg >= 1 && ydsPg < 0.5) archetype = "redzone";
  return { value: regress(value, s), archetype };
}

// ---------------------------------------------------------------------------
// Defense
// ---------------------------------------------------------------------------

export function rateCaptain(s: NflPlayerStats): { value: number; archetype: CaptainArchetype } {
  const d = s.defense;
  const ld = s.league.defense;
  if (!d || !ld) return { value: REPLACEMENT_LEVEL, archetype: "runStop" };
  const sacks = (nz(d.sacks) - nz(ld.sacks)) / 0.35;
  const tfl = d.tacklesForLoss != null && ld.tacklesForLoss != null ? (d.tacklesForLoss - ld.tacklesForLoss) / 0.3 : null;
  const ints = (d.int - ld.int) / 0.12;
  const pd = d.passesDefended != null && ld.passesDefended != null ? (d.passesDefended - ld.passesDefended) / 0.4 : null;
  const tackles = d.tackles != null && ld.tackles != null ? (d.tackles - ld.tackles) / 2.5 : 0;
  const ff = d.forcedFumbles != null && ld.forcedFumbles != null ? (d.forcedFumbles - ld.forcedFumbles) / 0.08 : 0;

  const scores: Record<CaptainArchetype, number> = {
    passRush: tfl == null ? 0.85 * sacks + 0.15 * ff : 0.65 * sacks + 0.2 * tfl + 0.15 * ff,
    coverage: pd == null ? 0.85 * ints + 0.15 * ff : 0.5 * ints + 0.4 * pd + 0.1 * ff,
    runStop: tfl == null ? 0.85 * tackles + 0.15 * ff : 0.6 * tackles + 0.3 * tfl + 0.1 * ff,
  };
  const archetype = (Object.keys(scores) as CaptainArchetype[]).reduce((a, b) => (scores[b] > scores[a] ? b : a));
  return { value: regress(scores[archetype], s), archetype };
}

export function rateTeamDefense(d: NflTeamDefense) {
  const lg = d.league;
  const pa = (lg.pointsAllowed - d.pointsAllowed) / 6.5; // elite ≈ 6.5 ppg better than league
  const ypp =
    d.playsAllowed > 0 && lg.playsAllowed > 0
      ? (lg.yardsAllowed / lg.playsAllowed - d.yardsAllowed / d.playsAllowed) / 0.7
      : (lg.yardsAllowed - d.yardsAllowed) / 40;
  const sacks = d.sacks != null && lg.sacks != null ? (d.sacks - lg.sacks) / 0.8 : 0;
  const base = 0.55 * pa + 0.3 * ypp + 0.15 * sacks;
  return {
    base,
    passTilt: (lg.passYardsAllowed - d.passYardsAllowed) / 40,
    runTilt: (lg.rushYardsAllowed - d.rushYardsAllowed) / 25,
    takeaway: (d.takeaways - lg.takeaways) / 0.6,
    sacks,
  };
}

// ---------------------------------------------------------------------------
// Team profile (fit layer)
// ---------------------------------------------------------------------------

/** One ball per play: the best receiver gets the most work, each extra one adds less. */
const WR_DEPTH_WEIGHTS = [0.4, 0.33, 0.27];

export function buildTeamProfile(roster: NflSimRoster): TeamProfile {
  const qb = rateQb(roster.QB.stats);
  const rb = rateRb(roster.RB.stats);
  const wrs = (["WR1", "WR2", "WR3"] as const)
    .map((slot) => ({ slot, player: roster[slot], ...rateReceiver(roster[slot].stats) }))
    .sort((a, b) => b.value - a.value);
  const te = rateReceiver(roster.TE.stats);
  const captain = rateCaptain(roster.DEF_CAPTAIN.stats);
  const def = rateTeamDefense(roster.TEAM_DEF);

  // Receiving corps: depth-weighted WRs + TE (safety valve / blocking).
  const wrGroup = wrs.reduce((sum, w, i) => sum + WR_DEPTH_WEIGHTS[i] * w.value, 0);
  const archetypes = new Set(wrs.map((w) => w.archetype).filter((a) => a !== "balanced"));
  const variety = archetypes.size >= 2 && te.value >= 0 ? 0.08 : archetypes.size >= 2 ? 0.04 : 0;
  const receivers = 0.75 * wrGroup + 0.25 * te.value + variety;

  // QB × receivers: a great QB elevates the corps, a bad one wastes it.
  const qbMultiplier = Math.max(0.3, 1 + 0.4 * qb.pass);
  const rushUnit = 0.8 * rb.rush + 0.5 * Math.max(qb.rush, 0) + 0.1 * rb.receiving;
  let pass = qb.pass + 0.7 * receivers * qbMultiplier;
  // Run/pass balance: a real run game sets up play-action and protects a shaky QB.
  if (rushUnit > 0) pass += 0.15 * rushUnit + (qb.pass < 0 ? 0.1 * rushUnit : 0);

  // Play-calling leans toward the stronger unit (a tendency, not a talent cap).
  const passShare = Math.min(0.72, Math.max(0.42, 0.58 + 0.12 * (pass - rushUnit)));

  // Defense: team unit + captain, with extra impact where the captain fills a team weakness.
  const captainBoost = 0.3 * captain.value;
  let passDef = def.base + 0.25 * def.passTilt;
  let runDef = def.base + 0.25 * def.runTilt;
  let takeaway = def.takeaway;
  let passRush = def.sacks;
  if (captain.archetype === "passRush") {
    const fillsHole = def.sacks < 0 ? 1.3 : 1;
    passDef += captainBoost * fillsHole;
    passRush += 0.5 * captain.value * fillsHole;
  } else if (captain.archetype === "coverage") {
    const fillsHole = def.passTilt < 0 ? 1.3 : 1;
    passDef += 0.85 * captainBoost * fillsHole;
    takeaway += 0.3 * captain.value * fillsHole;
  } else {
    const fillsHole = def.runTilt < 0 ? 1.3 : 1;
    runDef += captainBoost * fillsHole;
  }

  const secure = 0.7 * qb.secure + 0.3 * rb.secure;
  const recWeights = [
    ...wrs.map((w) => ({ name: w.player.name, weight: Math.max(0.15, 1 + w.value) * (w === wrs[0] ? 1.3 : 1) })),
    { name: roster.TE.name, weight: Math.max(0.15, 0.8 + te.value) },
    { name: roster.RB.name, weight: Math.max(0.1, 0.4 + rb.receiving) },
  ];

  const k = RATING_SCALE;
  return {
    name: roster.name,
    pass: k * pass,
    rush: k * rushUnit,
    passShare,
    secure: k * secure,
    passDef: k * passDef,
    runDef: k * runDef,
    takeaway: k * takeaway,
    passRush: k * passRush,
    players: [
      { name: roster.QB.name, slot: "QB", value: qb.pass },
      { name: roster.RB.name, slot: "RB", value: rb.rush },
      ...wrs.map((w) => ({ name: w.player.name, slot: w.slot, value: w.value, archetype: w.archetype })),
      { name: roster.TE.name, slot: "TE", value: te.value, archetype: te.archetype },
      { name: roster.DEF_CAPTAIN.name, slot: "DEF_CAPTAIN", value: captain.value, archetype: captain.archetype },
      { name: roster.TEAM_DEF.teamName, slot: "TEAM_DEF", value: def.base },
    ],
    attribution: {
      receivers: recWeights,
      qbName: roster.QB.name,
      rbName: roster.RB.name,
      qbRushShare: Math.min(0.45, Math.max(0.08, 0.15 + 0.15 * qb.rush)),
      captainName: roster.DEF_CAPTAIN.name,
      captainArchetype: captain.archetype,
      defenseName: `${roster.TEAM_DEF.season} ${roster.TEAM_DEF.teamName}`,
    },
  };
}

/**
 * Profile for a real NFL team from its actual points for/against (season-mode opponents and
 * the backtest). offense/defense are already on the engine's scale (see calibrateUnitFromPoints).
 */
export function profileFromUnits(name: string, offense: number, defense: number): TeamProfile {
  return {
    name,
    pass: offense,
    rush: offense,
    passShare: 0.58,
    secure: 0,
    passDef: defense,
    runDef: defense,
    takeaway: 0,
    passRush: 0,
    players: [],
    attribution: {
      receivers: [{ name: `${name} receiver`, weight: 1 }],
      qbName: `${name} QB`,
      rbName: `${name} RB`,
      qbRushShare: 0.15,
      captainName: `${name} defense`,
      captainArchetype: "runStop",
      defenseName: `${name} defense`,
    },
  };
}

export type { NflPosition };
