import { describe, expect, it } from "vitest";
import type { NflPlayerStats, NflTeamDefense } from "@/lib/nfl-types";
import {
  anyA,
  buildTeamProfile,
  createRng,
  estimateMatchup,
  moveForPointsPerGame,
  profileFromUnits,
  rateQb,
  rateReceiver,
  simulateGame,
  type NflSimRoster,
} from "./index";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const LEAGUE_QB = { cmp: 21, att: 33, yds: 235, td: 1.5, int: 0.8, sacked: 2.2 };
const LEAGUE_RUSH = { att: 15, yds: 65, td: 0.45, fumblesLost: 0.12 };
const LEAGUE_REC = { tgt: 6, rec: 4, yds: 50, td: 0.3 };
const LEAGUE_DEF = { tackles: 4, sacks: 0.3, int: 0.08, passesDefended: 0.4, forcedFumbles: 0.06, tacklesForLoss: 0.35 };

function stats(position: NflPlayerStats["position"], line: Partial<NflPlayerStats>, gp = 16): NflPlayerStats {
  return {
    playerId: "x", teamId: "KC", position, gp, gs: gp, seasons: [2020], statsTeamId: "KC",
    passing: null, rushing: null, receiving: null, defense: null,
    league: { passing: LEAGUE_QB, rushing: LEAGUE_RUSH, receiving: LEAGUE_REC, defense: LEAGUE_DEF },
    source: "db",
    ...line,
  };
}

const qb = (scale: number) =>
  stats("QB", {
    passing: { cmp: 21 * scale, att: 33, yds: 235 * scale, td: 1.5 * scale, int: 0.8 / scale, sacked: 2.2 / scale },
    rushing: { att: 3, yds: 15, td: 0.1, fumblesLost: 0.1 },
  });
const rb = (scale: number) =>
  stats("RB", { rushing: { att: 16, yds: 65 * scale, td: 0.45 * scale, fumblesLost: 0.12 }, receiving: { tgt: 3, rec: 2, yds: 15 * scale, td: 0.05 } });
const wr = (scale: number) => stats("WR", { receiving: { tgt: 7, rec: 4.5, yds: 50 * scale, td: 0.3 * scale } });
const captain = (scale: number) =>
  stats("LB", { defense: { tackles: 4, sacks: 0.3 * scale, int: 0.08, passesDefended: 0.4, forcedFumbles: 0.06, tacklesForLoss: 0.35 * scale } });
const defense = (pa: number): NflTeamDefense => ({
  teamId: "KC", season: 2020, teamName: "Chiefs", games: 16, pointsAllowed: pa, yardsAllowed: 340,
  passYardsAllowed: 230, rushYardsAllowed: 110, takeaways: 1.4, sacks: 2.5, playsAllowed: 63, source: "db",
  league: { pointsAllowed: 23, yardsAllowed: 340, passYardsAllowed: 230, rushYardsAllowed: 110, takeaways: 1.4, sacks: 2.5, playsAllowed: 63 },
});

function roster(name: string, s: { qb: number; rb: number; wr: number; te: number; cap: number; pa: number }): NflSimRoster {
  return {
    name,
    QB: { name: `${name} QB`, stats: qb(s.qb) },
    RB: { name: `${name} RB`, stats: rb(s.rb) },
    WR1: { name: `${name} WR1`, stats: wr(s.wr) },
    WR2: { name: `${name} WR2`, stats: wr(s.wr) },
    WR3: { name: `${name} WR3`, stats: wr(s.wr) },
    TE: { name: `${name} TE`, stats: wr(s.te) },
    DEF_CAPTAIN: { name: `${name} LB`, stats: captain(s.cap) },
    TEAM_DEF: defense(s.pa),
  };
}

const AVERAGE = { qb: 1, rb: 1, wr: 1, te: 1, cap: 1, pa: 23 };
const SUPER = { qb: 1.45, rb: 1.6, wr: 1.8, te: 1.7, cap: 2.5, pa: 17 };

function sample(a: ReturnType<typeof profileFromUnits>, b: ReturnType<typeof profileFromUnits>, n = 3000, playoff = false) {
  const games = Array.from({ length: n }, (_, i) => simulateGame(a, b, { seed: i + 1, fast: true, playoff }));
  const mean = (f: (g: (typeof games)[number]) => number) => games.reduce((s, g) => s + f(g), 0) / n;
  const margin = mean((g) => g.team1Score - g.team2Score);
  const sd = Math.sqrt(mean((g) => (g.team1Score - g.team2Score - margin) ** 2));
  return {
    games,
    ppg: (mean((g) => g.team1Score) + mean((g) => g.team2Score)) / 2,
    team1Ppg: mean((g) => g.team1Score),
    winPct: mean((g) => (g.winner === 1 ? 1 : 0)),
    tiePct: mean((g) => (g.winner === null ? 1 : 0)),
    sd,
  };
}

// ---------------------------------------------------------------------------
// ratings
// ---------------------------------------------------------------------------

describe("ratings", () => {
  it("league-average stats rate ~0 (before small-sample regression)", () => {
    const r = rateQb(stats("QB", { passing: LEAGUE_QB }, 1000));
    expect(r.pass).toBeCloseTo(0, 1);
  });

  it("era adjustment: same production relative to its league rates the same", () => {
    const modern = stats("WR", { receiving: { tgt: 9, rec: 6, yds: 90, td: 0.7 } }, 16);
    const oldEra = stats("WR", {
      receiving: { tgt: 9 * 0.8, rec: 6 * 0.8, yds: 90 * 0.8, td: 0.7 * 0.8 },
      league: { ...modern.league, receiving: { tgt: 4.8, rec: 3.2, yds: 40, td: 0.24 } },
    }, 16);
    // Old era: 80% of the raw production against an 80% league → similar rating.
    expect(Math.abs(rateReceiver(modern).value - rateReceiver(oldEra).value)).toBeLessThan(0.25);
  });

  it("has no ceiling — historically great seasons rate far above 1", () => {
    const line = { cmp: 26, att: 36, yds: 340, td: 3.1, int: 0.4, sacked: 1.0 }; // ~+4 ANY/A over league
    expect(rateQb(stats("QB", { passing: line }, 16)).pass).toBeGreaterThan(1.2); // one season (slightly regressed)
    expect(rateQb(stats("QB", { passing: line }, 120)).pass).toBeGreaterThan(1.55); // sustained career
  });

  it("small samples regress toward replacement; projections are trusted", () => {
    const star = { cmp: 26, att: 36, yds: 340, td: 3.1, int: 0.4, sacked: 1.0 };
    const oneGame = rateQb(stats("QB", { passing: star }, 1)).pass;
    const fullSeason = rateQb(stats("QB", { passing: star }, 16)).pass;
    expect(oneGame).toBeLessThan(fullSeason / 2);
    const projected = rateQb({ ...stats("QB", { passing: star }, 0), source: "projection" }).pass;
    expect(projected).toBeGreaterThan(fullSeason);
  });

  it("ANY/A matches the standard formula", () => {
    expect(anyA({ att: 30, yds: 250, td: 2, int: 1, sacked: 2 })).toBeCloseTo((250 + 40 - 45 - 13) / 32, 5);
  });

  it("QB × receivers is multiplicative: elite WRs help an elite QB more than a bad one", () => {
    const passWith = (q: number, w: number) => buildTeamProfile(roster("T", { ...AVERAGE, qb: q, wr: w })).pass;
    const eliteQbGain = passWith(1.4, 1.8) - passWith(1.4, 1);
    const badQbGain = passWith(0.7, 1.8) - passWith(0.7, 1);
    expect(eliteQbGain).toBeGreaterThan(badQbGain * 1.3);
  });

  it("better rosters produce stronger profiles", () => {
    const avg = buildTeamProfile(roster("A", AVERAGE));
    const sup = buildTeamProfile(roster("S", SUPER));
    expect(sup.pass).toBeGreaterThan(avg.pass + 1);
    expect(sup.passDef).toBeGreaterThan(avg.passDef);
  });
});

// ---------------------------------------------------------------------------
// game engine realism
// ---------------------------------------------------------------------------

describe("game engine", () => {
  it("is deterministic for a seed", () => {
    const a = profileFromUnits("A", 0.5, 0);
    const b = profileFromUnits("B", 0, 0.3);
    expect(simulateGame(a, b, { seed: 42 })).toEqual(simulateGame(a, b, { seed: 42 }));
    expect(simulateGame(a, b, { seed: 42 }).drives).not.toEqual(simulateGame(a, b, { seed: 43 }).drives);
  });

  it("average vs average looks like the NFL", () => {
    const avg = profileFromUnits("A", 0, 0);
    const r = sample(avg, avg);
    expect(r.ppg).toBeGreaterThan(20.5);
    expect(r.ppg).toBeLessThan(25);
    expect(r.sd).toBeGreaterThan(12);
    expect(r.sd).toBeLessThan(16);
    expect(r.tiePct).toBeLessThan(0.015);
    expect(r.winPct).toBeGreaterThan(0.45);
    expect(r.winPct).toBeLessThan(0.55);
  });

  it("3 and 7 are the most common margins", () => {
    const avg = profileFromUnits("A", 0, 0);
    const counts = new Map<number, number>();
    for (const g of sample(avg, avg).games) {
      const m = Math.abs(g.team1Score - g.team2Score);
      counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    const top2 = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([m]) => m).sort();
    expect(top2).toEqual([3, 7]);
  });

  it("home field is worth a little, not a lot", () => {
    const avg = profileFromUnits("A", 0, 0);
    const n = 3000;
    let wins = 0;
    for (let i = 0; i < n; i++) if (simulateGame(avg, avg, { seed: i + 1, home: 1, fast: true }).winner === 1) wins++;
    expect(wins / n).toBeGreaterThan(0.51);
    expect(wins / n).toBeLessThan(0.6);
  });

  it("better is always better, with no cap on dominance", () => {
    const avg = profileFromUnits("Avg", 0, 0);
    const wins = [0.5, 1.5, 3].map((m) => sample(profileFromUnits("X", m, 0), avg).winPct);
    expect(wins[0]).toBeLessThan(wins[1]);
    expect(wins[1]).toBeLessThan(wins[2]);
    expect(wins[2]).toBeGreaterThan(0.93); // dominance emerges organically
  });

  it("super teams still lose sometimes (chaos is real)", () => {
    const sup = buildTeamProfile(roster("Super", SUPER));
    const avg = buildTeamProfile(roster("Avg", AVERAGE));
    const r = sample(sup, avg, 4000);
    expect(r.winPct).toBeGreaterThan(0.85);
    expect(r.winPct).toBeLessThan(0.995);
    expect(r.team1Ppg).toBeGreaterThan(30); // scores well above NFL average
  });

  it("playoff games never end in a tie; overtime is rare", () => {
    const avg = profileFromUnits("A", 0, 0);
    const r = sample(avg, avg, 3000, true);
    expect(r.tiePct).toBe(0);
    const ot = r.games.filter((g) => g.overtime).length / r.games.length;
    expect(ot).toBeGreaterThan(0.02);
    expect(ot).toBeLessThan(0.12);
  });

  it("scores and drive log are consistent", () => {
    const g = simulateGame(profileFromUnits("A", 0.6, 0.2), profileFromUnits("B", 0.3, 0.1), { seed: 7 });
    const pts = { 1: 0, 2: 0 };
    for (const d of g.drives) if (d.points) pts[d.points.team] += d.points.value;
    expect([pts[1], pts[2]]).toEqual([g.team1Score, g.team2Score]);
    expect(g.drives.at(-1)!.score).toEqual([g.team1Score, g.team2Score]);
  });

  it("produces 1-5 readable key moments in order", () => {
    const a = buildTeamProfile(roster("Aces", SUPER));
    const b = buildTeamProfile(roster("Bolts", { ...SUPER, qb: 1.4 }));
    for (let seed = 1; seed <= 20; seed++) {
      const g = simulateGame(a, b, { seed });
      expect(g.keyMoments.length).toBeGreaterThan(0);
      expect(g.keyMoments.length).toBeLessThanOrEqual(5);
      for (const m of g.keyMoments) expect(m.text.length).toBeGreaterThan(5);
    }
  });

  it("Monte Carlo estimate agrees with direction and sums to 1", () => {
    const est = estimateMatchup(profileFromUnits("A", 1, 0.5), profileFromUnits("B", 0, 0), { seed: 1, sims: 1000 });
    expect(est.team1WinPct).toBeGreaterThan(0.7);
    expect(est.team1WinPct + est.team2WinPct + est.tiePct).toBeCloseTo(1, 2);
  });

  it("real-team calibration reproduces points per game", () => {
    const team = profileFromUnits("R", moveForPointsPerGame(30), 0);
    const r = sample(team, profileFromUnits("Avg", 0, 0));
    expect(r.team1Ppg).toBeGreaterThan(27.5);
    expect(r.team1Ppg).toBeLessThan(32.5);
  });

  it("seeded rng is uniform-ish", () => {
    const rng = createRng(123);
    const n = 20000;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += rng.next();
    expect(sum / n).toBeGreaterThan(0.48);
    expect(sum / n).toBeLessThan(0.52);
  });
});

describe("key moment text", () => {
  it("never repeats the exact same sentence", () => {
    const a = profileFromUnits("A", 0, -1);
    const b = profileFromUnits("B", 0, 1.5);
    for (let seed = 1; seed <= 200; seed++) {
      const texts = simulateGame(a, b, { seed }).keyMoments.map((m) => m.text);
      expect(new Set(texts).size).toBe(texts.length);
    }
  });
});

describe("box score layer", () => {
  const a = buildTeamProfile(roster("Aces", SUPER));
  const b = buildTeamProfile(roster("Bolts", AVERAGE));

  it("never changes the game: same seed → same outcomes with or without stats", () => {
    const noUsage = (p: typeof a) => ({ ...p, usage: undefined });
    for (let seed = 1; seed <= 100; seed++) {
      const withStats = simulateGame(a, b, { seed });
      const fast = simulateGame(a, b, { seed, fast: true });
      const generic = simulateGame(noUsage(a), noUsage(b), { seed });
      for (const other of [fast, generic]) {
        expect(other.team1Score).toBe(withStats.team1Score);
        expect(other.team2Score).toBe(withStats.team2Score);
        expect(other.drives.map((d) => d.outcome)).toEqual(withStats.drives.map((d) => d.outcome));
      }
      expect(fast.boxScore).toBeUndefined();
    }
  });

  it("box score agrees with the game it describes", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const g = simulateGame(a, b, { seed });
      for (const t of [1, 2] as const) {
        const box = g.boxScore![t];
        const offTds = g.drives.filter((d) => d.offense === t && d.outcome === "TD").length;
        const rushTds = box.rushing.reduce((s, r) => s + r.td, 0);
        expect(box.passing.td + rushTds).toBe(offTds);
        expect(box.receiving.reduce((s, r) => s + r.td, 0)).toBe(box.passing.td);
        // Interceptions thrown never exceed turnovers committed.
        expect(box.passing.int).toBeLessThanOrEqual(g.teamStats[t].turnovers);
        // QB passing yards are the catches' yards.
        const recYds = box.receiving.reduce((s, r) => s + r.yds, 0);
        expect(box.passing.yds).toBeGreaterThanOrEqual(recYds); // the rest went to unnamed teammates
        expect(box.passing.cmp).toBeLessThanOrEqual(box.passing.att);
        for (const r of box.receiving) expect(r.rec).toBeLessThanOrEqual(r.tgt);
        expect(box.team.passYards + box.team.rushYards).toBe(box.team.yards);
      }
    }
  });

  it("produces sane volumes, and super teams put up bigger but believable numbers", () => {
    const n = 300;
    let supYds = 0, avgYds = 0, supQb = 0, plays = 0;
    for (let seed = 1; seed <= n; seed++) {
      const g = simulateGame(a, b, { seed });
      supYds += g.boxScore![1].team.yards;
      avgYds += g.boxScore![2].team.yards;
      supQb += g.boxScore![1].passing.yds;
      plays += g.boxScore![2].team.plays;
    }
    expect(plays / n).toBeGreaterThan(52);
    expect(plays / n).toBeLessThan(75);
    expect(avgYds / n).toBeGreaterThan(220);
    expect(supYds / n).toBeGreaterThan(avgYds / n);
    // A super team lifts its QB above his real per-game yards, but within reason.
    const realQbYds = 235 * SUPER.qb;
    expect(supQb / n).toBeGreaterThan(realQbYds);
    expect(supQb / n).toBeLessThan(realQbYds * 1.4);
  });

  it("touchdown key moments include yardage", () => {
    const texts = Array.from({ length: 30 }, (_, i) => simulateGame(a, b, { seed: i + 1 }).keyMoments.map((m) => m.text)).flat();
    expect(texts.some((t) => /\d+-yard touchdown|from \d+ yards? out|\d+-yard field goal/.test(t))).toBe(true);
  });
});

describe("generic opponents (season mode)", () => {
  it("are narrated at team level, never as '<Team> QB' / '<Team> receiver'", () => {
    const a = profileFromUnits("Atlanta Falcons", 0.2, 0);
    const b = profileFromUnits("Arizona Cardinals", 0, 0.2);
    for (let seed = 1; seed <= 150; seed++) {
      for (const d of simulateGame(a, b, { seed }).drives) {
        expect(d.text).not.toMatch(/ QB| RB| receiver/);
        expect(d.text).not.toMatch(/by (Atlanta|Arizona)|^(Atlanta|Arizona) \\w+ intercept/);
      }
    }
  });

  it("caps any single receiver's target share", async () => {
    const { targetShares } = await import("./stats");
    const shares = targetShares({
      qb: { name: "Q", cmpPct: 0.65, sackRate: 0.06, rushAttPg: 3, ypc: 4 },
      receivers: [{ name: "Star", tgtPg: 20, catchRate: 0.7, ypr: 12 }, { name: "B", tgtPg: 1, catchRate: 0.6, ypr: 9 }],
      rushers: [{ name: "R", rushAttPg: 15, ypc: 4 }],
      captain: { name: "C", tacklesPg: 4, sacksPg: 0.3, archetype: "passRush" },
      teamSacksPg: 2.4,
      leagueCatchRate: 0.65,
    });
    const total = shares.reduce((s, o) => s + o.w, 0);
    expect(shares[0].w / total).toBeLessThanOrEqual(0.3 + 1e-9);
  });
});
