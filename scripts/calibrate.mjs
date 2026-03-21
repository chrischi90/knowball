#!/usr/bin/env node
/**
 * Knowball — Hybrid Model Calibration Script
 *
 * Fetches real rosters from the local API, auto-assigns a starting five ranked
 * by composite stats, runs /api/season, and compares hybrid predicted wins
 * against real regular-season records stored in a season JSON file.
 *
 * Usage:
 *   node scripts/calibrate.mjs
 *   node scripts/calibrate.mjs --season 2024-25
 *   node scripts/calibrate.mjs --targets scripts/seasons/2024-25.json
 *   node scripts/calibrate.mjs --base-url https://knowball.onrender.com
 *   node scripts/calibrate.mjs --runs 5
 *   node scripts/calibrate.mjs --game-mode all_time
 *
 * Season data files live in scripts/seasons/<season>.json.
 * To calibrate a new season, create scripts/seasons/<year>.json following the
 * same shape as 2024-25.json, then run: node scripts/calibrate.mjs --season <year>
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI args ──────────────────────────────────────────────────────────────────

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const BASE_URL   = arg("--base-url", "http://localhost:3000");
const RUNS       = Number(arg("--runs", "3"));
if (!Number.isFinite(RUNS) || !Number.isInteger(RUNS) || RUNS <= 0) {
  console.error(`\nInvalid value for --runs: ${String(arg("--runs"))}`);
  console.error("  --runs must be a finite positive integer (e.g., 1, 3, 10).");
  console.error("  Example: node scripts/calibrate.mjs --runs 5\n");
  process.exit(1);
}
const SEASON     = arg("--season", "2024-25");
const TARGETS_PATH = arg("--targets") ?? resolve(__dirname, "seasons", `${SEASON}.json`);

// ── Load season data ──────────────────────────────────────────────────────────

let seasonData;
try {
  seasonData = JSON.parse(readFileSync(TARGETS_PATH, "utf8"));
} catch (e) {
  console.error(`\nFailed to load season data from: ${TARGETS_PATH}`);
  console.error(`  ${e.message}`);
  console.error(`\nAvailable season files should be in: scripts/seasons/`);
  console.error(`Example: node scripts/calibrate.mjs --season 2024-25\n`);
  process.exit(1);
}

const TARGETS   = seasonData.teams;
const SEASON_LABEL = seasonData.season ?? SEASON;
// --game-mode flag overrides the JSON value
const GAME_MODE = arg("--game-mode") ?? seasonData.gameMode ?? "active_only";

// ── Constants ─────────────────────────────────────────────────────────────────

const POSITION_SLOTS = ["PG", "SG", "SF", "PF", "C"];

// Slot fill priority: for each open slot, try these natural positions in order
const FILL_PRIORITY = {
  PG: ["PG", "SG", "SF", "PF", "C"],
  SG: ["SG", "PG", "SF", "PF", "C"],
  SF: ["SF", "SG", "PF", "PG", "C"],
  PF: ["PF", "SF", "C", "SG", "PG"],
  C:  ["C",  "PF", "SF", "SG", "PG"],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function normPos(raw) {
  if (!raw) return "SF";
  const p = raw.toUpperCase().split(/[-\/,]/)[0].trim();
  if (POSITION_SLOTS.includes(p)) return p;
  if (p.startsWith("PG") || p === "G") return "PG";
  if (p.startsWith("SG")) return "SG";
  if (p.startsWith("SF") || p === "F") return "SF";
  if (p.startsWith("PF")) return "PF";
  if (p.startsWith("C")) return "C";
  return "SF";
}

/** Composite score used to rank players by impact (starters first) */
function playerScore(p) {
  const s = p.stats;
  if (!s) return 0;
  return (
    (s.pts ?? 0) +
    (s.ast ?? 0) * 1.5 +
    (s.reb ?? 0) * 1.2 +
    (s.stl ?? 0) * 2 +
    (s.blk ?? 0) * 2
  );
}

/**
 * Fetches stats for all players in parallel, then returns them sorted by
 * composite score descending. Players with fewer than 10 games are deprioritised
 * (kept as a fallback pool if fewer than 5 meaningful players are found).
 */
async function rankPlayers(players, teamId) {
  const withStats = await Promise.all(
    players.map(async (p) => {
      try {
        const url = `${BASE_URL}/api/players/${p.id}/stats?team_id=${teamId}&game_mode=${GAME_MODE}`;
        const r = await fetch(url);
        if (!r.ok) return { ...p, stats: null, score: 0 };
        const d = await r.json();
        return { ...p, stats: d, score: playerScore({ stats: d }) };
      } catch {
        return { ...p, stats: null, score: 0 };
      }
    })
  );
  const meaningful = withStats.filter((p) => (p.stats?.gp ?? 0) >= 10);
  const ranked = (meaningful.length >= 5 ? meaningful : withStats).sort(
    (a, b) => b.score - a.score
  );
  return ranked;
}

/**
 * Assigns the top-ranked players to slots using position-fit priority.
 * Players are expected to already be sorted by rankPlayers().
 */
function buildRoster(players, teamId) {
  const pool = players.slice(0, Math.min(players.length, 12));
  const remaining = [...pool];
  const roster = {};

  for (const slot of POSITION_SLOTS) {
    let picked = null;
    for (const pref of FILL_PRIORITY[slot]) {
      const idx = remaining.findIndex((p) => normPos(p.position) === pref);
      if (idx !== -1) {
        picked = remaining.splice(idx, 1)[0];
        break;
      }
    }
    if (!picked && remaining.length > 0) picked = remaining.shift();

    roster[slot] = {
      position: slot,
      playerId: picked?.id ?? null,
      playerName: picked?.name ?? null,
      teamId,
      naturalPosition: picked ? normPos(picked.position) : null,
    };
  }
  return roster;
}

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.json();
}

async function runSim(roster) {
  const r = await fetch(`${BASE_URL}/api/season`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roster, gameMode: GAME_MODE }),
  });
  if (!r.ok) throw new Error(`Sim HTTP ${r.status}`);
  return r.json();
}

function pad(s, n, right = true) {
  const str = String(s ?? "-");
  return right ? str.padEnd(n) : str.padStart(n);
}
function sign(v) {
  return v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🏀  Knowball Hybrid Model Calibration — ${SEASON_LABEL} Season`);
  console.log(`   Endpoint : ${BASE_URL}`);
  console.log(`   Mode     : ${GAME_MODE}`);
  console.log(`   Runs/team: ${RUNS}`);
  console.log(`   Data file: ${TARGETS_PATH}\n`);

  const { teams } = await getJSON(`${BASE_URL}/api/teams`);
  const byAbbr = Object.fromEntries(teams.map((t) => [t.abbreviation, t]));

  const rows = [];

  for (const target of TARGETS) {
    const team = byAbbr[target.abbr];
    if (!team) {
      console.warn(`  ⚠  No team record for abbreviation: ${target.abbr}`);
      continue;
    }

    let players;
    try {
      const d = await getJSON(
        `${BASE_URL}/api/teams/${team.id}/players?active_only=true`
      );
      players = d.players;
    } catch (e) {
      console.warn(`  ⚠  Players fetch failed for ${target.abbr}: ${e.message}`);
      continue;
    }

    if (!players || players.length < 5) {
      console.warn(`  ⚠  Fewer than 5 players returned for ${target.abbr} (got ${players?.length ?? 0})`);
      continue;
    }

    process.stdout.write(`  Ranking ${players.length} players for ${target.abbr}...`);
    const rankedPlayers = await rankPlayers(players, team.id);
    process.stdout.write(` top-5: ${rankedPlayers.slice(0, 5).map((p) => p.name).join(", ")}\n`);

    const roster = buildRoster(rankedPlayers, team.id);
    const rosterLine = POSITION_SLOTS
      .map((p) => `${p}:${roster[p].playerName ?? "?"}`)
      .join("  ");

    let totalWins = 0;
    let diagnostics = null;
    let errors = 0;

    for (let i = 0; i < RUNS; i++) {
      try {
        const d = await runSim(roster);
        if (d.error) { errors++; continue; }
        totalWins += d.wins;
        if (!diagnostics) diagnostics = d;
      } catch {
        errors++;
      }
    }

    const valid = RUNS - errors;
    const avgW = valid > 0 ? Math.round(totalWins / valid) : null;
    const avgL = avgW !== null ? 82 - avgW : null;
    const diffAvg = avgW !== null ? avgW - target.realW : null;
    const diffExp =
      diagnostics?.expectedWinsBlended != null
        ? diagnostics.expectedWinsBlended - target.realW
        : null;

    rows.push({ ...target, rosterLine, avgW, avgL, diagnostics, diffAvg, diffExp });

    const rP = diagnostics?.ratingWinProbability;
    const pP = diagnostics?.pythagoreanWinProbability;
    const bP = diagnostics?.regularSeasonWinProbability;
    const expB = diagnostics?.expectedWinsBlended;
    const mk = target.approx ? "~" : " ";

    console.log(
      `  ${pad(target.abbr, 4)} ${mk}${pad(target.realW, 2, false)}-${pad(target.realL, 2)}` +
      `  →  sim ${avgW != null ? `${avgW}-${avgL}` : "err"}` +
      `  exp ${expB != null ? expB.toFixed(1) : "-"} W` +
      `  blend ${bP != null ? (bP * 100).toFixed(1) : "-"}%` +
      `  (rate ${rP != null ? (rP * 100).toFixed(1) : "-"}%  pyth ${pP != null ? (pP * 100).toFixed(1) : "-"}%)`
    );
    console.log(`         ${rosterLine}\n`);
  }

  // ── Summary table ─────────────────────────────────────────────────────────
  const W = 130;
  console.log("═".repeat(W));
  console.log(`  CALIBRATION SUMMARY — Hybrid Model vs ${SEASON_LABEL} Real Records`);
  console.log("═".repeat(W));
  console.log(
    pad("Team", 26) +
    pad("Real", 8) +
    pad("Avg Sim", 9) +
    pad("Exp Blend", 11) +
    pad("Exp Rate", 10) +
    pad("Exp Pyth", 10) +
    pad("Δ Sim", 8) +
    pad("Δ Exp", 8) +
    pad("Blend%", 8) +
    pad("Rate%", 7) +
    pad("Pyth%", 7) +
    pad("Est PF/PA", 11) +
    "Roster"
  );
  console.log("─".repeat(W));

  let sumErrAvg = 0, sumErrExp = 0, n = 0;

  for (const r of rows) {
    const d = r.diagnostics;
    const mk = r.approx ? "~" : " ";
    console.log(
      pad(r.name, 26) +
      pad(`${mk}${r.realW}-${r.realL}`, 8) +
      pad(r.avgW != null ? `${r.avgW}-${r.avgL}` : "-", 9) +
      pad(d?.expectedWinsBlended != null ? d.expectedWinsBlended.toFixed(1) : "-", 11) +
      pad(d?.expectedWinsRating != null ? d.expectedWinsRating.toFixed(1) : "-", 10) +
      pad(d?.expectedWinsPythagorean != null ? d.expectedWinsPythagorean.toFixed(1) : "-", 10) +
      pad(r.diffAvg != null ? sign(r.diffAvg) : "-", 8) +
      pad(r.diffExp != null ? sign(r.diffExp) : "-", 8) +
      pad(d?.regularSeasonWinProbability != null ? `${(d.regularSeasonWinProbability * 100).toFixed(1)}%` : "-", 8) +
      pad(d?.ratingWinProbability != null ? `${(d.ratingWinProbability * 100).toFixed(1)}%` : "-", 7) +
      pad(d?.pythagoreanWinProbability != null ? `${(d.pythagoreanWinProbability * 100).toFixed(1)}%` : "-", 7) +
      pad(d?.estimatedPointsFor != null ? `${d.estimatedPointsFor}/${d.estimatedPointsAgainst}` : "-", 11) +
      r.rosterLine
    );

    if (r.diffAvg != null) { sumErrAvg += Math.abs(r.diffAvg); n++; }
    if (r.diffExp != null)   sumErrExp += Math.abs(r.diffExp);
  }

  console.log("═".repeat(W));

  if (n > 0) {
    console.log(`\n  MAE | Avg Sim Wins vs Real W:     ${(sumErrAvg / n).toFixed(1)} wins`);
    console.log(`  MAE | Expected Blended vs Real W: ${(sumErrExp / n).toFixed(1)} wins`);
  }

  console.log(`
  Legend:
    ~            = real record is approximate (verify against final ${SEASON_LABEL} standings)
    Avg Sim      = simulated W averaged over ${RUNS} runs (includes randomness)
    Exp Blend    = expectedWinsBlended, pre-randomness deterministic signal
    Exp Rate     = rating-only component of expected wins
    Exp Pyth     = pythagorean component of expected wins
    Est PF/PA    = estimated team points-for / points-against used in pythagorean calc
    Δ Sim        = simulated W − real W  (+ = over-predicted, − = under-predicted)
    Δ Exp        = expectedWinsBlended − real W  (best calibration signal, no noise)

  Calibration guide:
    If Δ Exp is consistently negative for elite teams → pythagorean is pulling too hard
      → reduce PYTHAG_EXPONENT (lib/simulation-engine.ts) or increase HYBRID_BLEND_WEIGHT
    If Δ Exp is consistently positive for weak teams  → same direction fix
    If Exp Rate is always near 77.9 for good teams    → rating model is hitting its ceiling
      → increase WIN_PROBABILITY_SCALE to spread the logistic curve
`);
}

main().catch((e) => {
  console.error("Calibration failed:", e.message);
  process.exit(1);
});
