/**
 * NFL sim backtest: rebuild every real team-season (1999+) from its actual top players and
 * team defense, simulate vs a league-average opponent, and compare with what really happened.
 *
 *   python nba-service/export_nfl_backtest.py /tmp/nfl_backtest.json
 *   npx tsx scripts/backtest_nfl.ts /tmp/nfl_backtest.json
 *
 * The sim only sees 8 slots (no OL, kicker, or the other 10 defenders), so a perfect fit is
 * impossible — what matters is a strong correlation and a slope near 1 (not over/under-reacting).
 */
import { readFileSync } from "node:fs";
import { buildTeamProfile, estimateMatchup, profileFromUnits, rateCaptain, type NflSimRoster } from "../lib/nfl-sim";

type Row = {
  teamId: string; season: number; teamName: string; wins: number; losses: number; ties: number; games: number;
  pointsForPerGame: number; pointsAgainstPerGame: number;
  QB: any; RB: any; WR: any[]; TE: any; defenders: any[]; TEAM_DEF: any;
};

const rows: Row[] = JSON.parse(readFileSync(process.argv[2] ?? "/tmp/nfl_backtest.json", "utf8"));
const SIMS = Number(process.env.SIMS ?? 300);
const avg = profileFromUnits("League average", 0, 0);

const results = rows.map((t, i) => {
  const captain = t.defenders.reduce((best, d) => (rateCaptain(d.stats).value > rateCaptain(best.stats).value ? d : best));
  const roster: NflSimRoster = {
    name: `${t.season} ${t.teamName}`, QB: t.QB, RB: t.RB, WR1: t.WR[0], WR2: t.WR[1], WR3: t.WR[2], TE: t.TE,
    DEF_CAPTAIN: captain, TEAM_DEF: t.TEAM_DEF,
  };
  const est = estimateMatchup(buildTeamProfile(roster), avg, { seed: i + 1, sims: SIMS });
  return {
    name: roster.name,
    actualDiff: t.pointsForPerGame - t.pointsAgainstPerGame,
    simDiff: est.avgTeam1Score - est.avgTeam2Score,
    actualPf: t.pointsForPerGame, simPf: est.avgTeam1Score,
    actualPa: t.pointsAgainstPerGame, simPa: est.avgTeam2Score,
    actualWinPct: (t.wins + 0.5 * t.ties) / t.games,
    simWinPct: est.team1WinPct + 0.5 * est.tiePct,
  };
});

function fit(xs: number[], ys: number[]) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return { r: sxy / Math.sqrt(sxx * syy), slope: sxy / sxx, meanX: mx, meanY: my };
}

const f = (k1: keyof (typeof results)[number], k2: keyof (typeof results)[number]) =>
  fit(results.map((r) => r[k1] as number), results.map((r) => r[k2] as number));
const diff = f("simDiff", "actualDiff");
const pf = f("simPf", "actualPf");
const pa = f("simPa", "actualPa");
const win = f("simWinPct", "actualWinPct");
const winRmse = Math.sqrt(results.reduce((s, r) => s + ((r.simWinPct - r.actualWinPct) * 17) ** 2, 0) / results.length);

console.log(`team-seasons: ${results.length}  (sims per team: ${SIMS})`);
console.log(`point diff/game  r=${diff.r.toFixed(3)}  slope(actual~sim)=${diff.slope.toFixed(2)}  mean sim ${diff.meanX.toFixed(2)} vs actual ${diff.meanY.toFixed(2)}`);
console.log(`points for/game  r=${pf.r.toFixed(3)}  slope=${pf.slope.toFixed(2)}  mean sim ${pf.meanX.toFixed(1)} vs actual ${pf.meanY.toFixed(1)}`);
console.log(`points vs/game   r=${pa.r.toFixed(3)}  slope=${pa.slope.toFixed(2)}  mean sim ${pa.meanX.toFixed(1)} vs actual ${pa.meanY.toFixed(1)}`);
console.log(`win %            r=${win.r.toFixed(3)}  slope=${win.slope.toFixed(2)}  RMSE ${winRmse.toFixed(2)} wins/17`);
const top = (k: "simDiff" | "actualDiff") => results.slice().sort((a, b) => b[k] - a[k]).slice(0, 8);
console.log("\nTop 8 by sim:   ", top("simDiff").map((r) => `${r.name} (${r.simDiff.toFixed(1)} / real ${r.actualDiff.toFixed(1)})`).join("; "));
console.log("Top 8 by real:  ", top("actualDiff").map((r) => `${r.name} (real ${r.actualDiff.toFixed(1)} / sim ${r.simDiff.toFixed(1)})`).join("; "));
const misses = results.slice().sort((a, b) => Math.abs(b.simDiff - b.actualDiff) - Math.abs(a.simDiff - a.actualDiff)).slice(0, 5);
console.log("Biggest misses: ", misses.map((r) => `${r.name} (sim ${r.simDiff.toFixed(1)} vs real ${r.actualDiff.toFixed(1)})`).join("; "));
