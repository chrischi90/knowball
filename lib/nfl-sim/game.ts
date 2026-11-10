/**
 * Layer 3 of the NFL sim: a drive-by-drive game engine.
 *
 * Each possession ends in a TD, FG, punt, turnover, turnover on downs, or end of half. The
 * odds come from unit-vs-unit matchups (pass vs pass defense, run vs run defense, ball
 * security vs takeaways), anchored to real NFL per-drive base rates. Chaos is limited to the
 * kinds real football has: turnover luck, return/defensive TDs, missed kicks, two-point
 * tries, game-day form, home field, and overtime.
 *
 * No caps on team strength: a far-better roster wins more because its drives succeed more.
 */
import { createRng, type Rng } from "./rng";
import type { TeamProfile } from "./ratings";
import { StatKeeper, type BoxScore } from "./stats";

/** Tunable constants. Base rates ≈ modern NFL per-drive outcomes. */
export const CAL = {
  base: { TD: 0.205, FG: 0.16, TO: 0.115, DOWNS: 0.05, PUNT: 0.465 },
  coef: { td: 0.5, fg: 0.18, puntMove: 0.35, downsMove: 0.15, toSecure: 0.45, toMove: 0.1 },
  /** How much a unit's defense offsets the opposing offense. */
  defScale: 0.75,
  /** Pass rush pressure effect on the passing game and on ball security. */
  pressure: 0.15,
  /**
   * Red-zone compression: drive efficiency has diminishing returns (the field shrinks, the
   * defense tightens near the goal line). Soft — never flat — so better is always better.
   */
  saturation: 3,
  formSd: 0.18,
  homeField: 0.08,
  shortField: 0.35,
  fgMake: 0.86,
  xp: 0.95,
  twoPoint: 0.48,
  defTdPerTurnover: 0.07,
  returnTdPerPossession: 0.006,
  /** Total possessions per half (both teams) — ~11 per team per game, like the NFL. */
  possessionsPerHalf: [10, 12] as [number, number],
  regularSeasonOtPossessions: 5,
  /** In overtime, teams play for field-goal range. */
  otFieldGoalBoost: 1.4,
};

export type DriveOutcome = "TD" | "FG" | "FG_MISS" | "PUNT" | "TO" | "DEF_TD" | "DOWNS" | "END_HALF" | "RETURN_TD";

export type DriveLog = {
  index: number;
  quarter: 1 | 2 | 3 | 4 | 5; // 5 = OT
  offense: 1 | 2;
  outcome: DriveOutcome;
  points: { team: 1 | 2; value: number } | null;
  score: [number, number];
  text: string;
};

export type KeyMoment = { quarter: DriveLog["quarter"]; team: 1 | 2; text: string; score: [number, number] };

export type GameResult = {
  seed: number;
  team1Score: number;
  team2Score: number;
  /** null = tie (regular season only). */
  winner: 1 | 2 | null;
  overtime: boolean;
  drives: DriveLog[];
  keyMoments: KeyMoment[];
  teamStats: Record<1 | 2, { touchdowns: number; fieldGoals: number; turnovers: number }>;
  /** Player box score (omitted for fast games). */
  boxScore?: BoxScore;
};

export type GameOptions = {
  seed: number;
  /** Which team is at home (home-field edge). null = neutral site. */
  home?: 1 | 2 | null;
  /** Playoff games can't end in a tie. */
  playoff?: boolean;
  /** Skip text + key moments (Monte Carlo speed). */
  fast?: boolean;
};

const compress = (m: number) => CAL.saturation * Math.tanh(m / CAL.saturation);

/** Outcome probabilities for one drive given its net move and ball-security values. */
export function driveProbabilities(move: number, secure: number) {
  const m = compress(move);
  const b = CAL.base;
  const c = CAL.coef;
  const w = {
    TD: b.TD * Math.exp(c.td * m),
    FG: b.FG * Math.exp(c.fg * m),
    TO: b.TO * Math.exp(-c.toSecure * secure - c.toMove * m),
    DOWNS: b.DOWNS * Math.exp(-c.downsMove * m),
    PUNT: b.PUNT * Math.exp(-c.puntMove * m),
  };
  const total = w.TD + w.FG + w.TO + w.DOWNS + w.PUNT;
  return {
    TD: w.TD / total,
    FG: w.FG / total,
    TO: w.TO / total,
    DOWNS: w.DOWNS / total,
    PUNT: w.PUNT / total,
  };
}

/** Expected points per drive (offense's own scoring, before defensive/return TDs). */
export function expectedPointsPerDrive(move: number, secure = 0): number {
  const p = driveProbabilities(move, secure);
  return p.TD * (6 + CAL.xp) + p.FG * CAL.fgMake * 3;
}

// Total possessions per half averages out to possessions per team per game.
const AVG_POSSESSIONS_PER_TEAM = (CAL.possessionsPerHalf[0] + CAL.possessionsPerHalf[1]) / 2;

/**
 * Real-team calibration: the engine-scale move that makes a league-average opponent score
 * `pointsPerGame`. Used to turn real teams' points for/against into season-mode opponents.
 */
export function moveForPointsPerGame(pointsPerGame: number): number {
  const target = pointsPerGame / AVG_POSSESSIONS_PER_TEAM;
  let lo = -6;
  let hi = 6;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (expectedPointsPerDrive(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

type Matchup = { move: number; secure: number };

function matchup(off: TeamProfile, def: TeamProfile): Matchup {
  const passMove = off.pass - CAL.defScale * def.passDef - CAL.pressure * Math.max(def.passRush, 0);
  const rushMove = off.rush - CAL.defScale * def.runDef;
  return {
    move: off.passShare * passMove + (1 - off.passShare) * rushMove,
    secure: off.secure - 0.8 * def.takeaway - 0.1 * Math.max(def.passRush, 0),
  };
}

function pickName(rng: Rng, options: { name: string; weight: number }[]) {
  return options[rng.weighted(options.map((o) => o.weight))].name;
}

export function simulateGame(team1: TeamProfile, team2: TeamProfile, options: GameOptions): GameResult {
  const rng = createRng(options.seed);
  const teams: Record<1 | 2, TeamProfile> = { 1: team1, 2: team2 };
  const other = (t: 1 | 2): 1 | 2 => (t === 1 ? 2 : 1);
  const base: Record<1 | 2, Matchup> = { 1: matchup(team1, team2), 2: matchup(team2, team1) };
  // Game-day form: each team has a good or bad day.
  const form: Record<1 | 2, number> = { 1: rng.normal() * CAL.formSd, 2: rng.normal() * CAL.formSd };
  const homeEdge = (t: 1 | 2) => (options.home === t ? CAL.homeField : options.home === other(t) ? -CAL.homeField : 0);

  const score: [number, number] = [0, 0];
  const drives: DriveLog[] = [];
  const stats: GameResult["teamStats"] = {
    1: { touchdowns: 0, fieldGoals: 0, turnovers: 0 },
    2: { touchdowns: 0, fieldGoals: 0, turnovers: 0 },
  };
  const shortField: Record<1 | 2, boolean> = { 1: false, 2: false };
  const tdsByPlayer = new Map<string, { team: 1 | 2; count: number }>();
  const momentCandidates: (KeyMoment & { priority: number; order: number })[] = [];

  const add = (team: 1 | 2, pts: number) => {
    score[team - 1] += pts;
  };
  const margin = (team: 1 | 2) => score[team - 1] - score[other(team) - 1];
  const fast = !!options.fast;
  // Box score: own RNG stream, never consulted for outcomes.
  const keeper = fast ? null : new StatKeeper(team1, team2, options.seed);
  const creditTd = (team: 1 | 2, name: string) => {
    const cur = tdsByPlayer.get(name) ?? { team, count: 0 };
    cur.count += 1;
    tdsByPlayer.set(name, cur);
  };

  /** Try for one or two after a touchdown. Returns the extra points scored and any text. */
  const conversion = (team: 1 | 2, late: boolean): { pts: number; note: string } => {
    // Late in the game, down 2 after the TD → go for two to tie.
    if (late && margin(team) === -2) {
      const good = rng.chance(CAL.twoPoint);
      return { pts: good ? 2 : 0, note: good ? " Two-point try good." : " Two-point try FAILS." };
    }
    const good = rng.chance(CAL.xp);
    return { pts: good ? 1 : 0, note: good ? "" : " Extra point missed." };
  };

  const runDrive = (offense: 1 | 2, quarter: DriveLog["quarter"], late: boolean, lastInHalf: boolean) => {
    const defense = other(offense);
    const off = teams[offense];
    const def = teams[defense];
    const index = drives.length;
    const leaderBefore = Math.sign(margin(1));
    let points: DriveLog["points"] = null;
    let text = "";
    let outcome: DriveOutcome;

    // Kick/punt return touchdown for the receiving team (rare).
    if (rng.chance(CAL.returnTdPerPossession)) {
      add(offense, 6);
      const conv = conversion(offense, late);
      add(offense, conv.pts);
      stats[offense].touchdowns++;
      outcome = "RETURN_TD";
      points = { team: offense, value: 6 + conv.pts };
      if (!fast) text = `Kick return touchdown for ${off.name}!${conv.note}`;
    } else {
      const m = base[offense];
      let move = m.move + form[offense] - form[defense] * 0.5 + homeEdge(offense);
      const wasShort = shortField[offense];
      if (wasShort) move += CAL.shortField;
      shortField[offense] = false;
      const p = driveProbabilities(move, m.secure);
      let w = [p.TD, quarter === 5 ? p.FG * CAL.otFieldGoalBoost : p.FG, p.TO, p.DOWNS, p.PUNT];
      // Trailing late: go for it on fourth down instead of punting.
      const deficit = -margin(offense);
      if (late && deficit >= 1 && deficit <= 16) {
        w = [p.TD * 1.15, deficit <= 3 ? p.FG * 1.2 : p.FG * 0.5, p.TO * 1.1, p.DOWNS * 2.5, p.PUNT * 0.25];
      }
      const pick = (["TD", "FG", "TO", "DOWNS", "PUNT"] as const)[rng.weighted(w)];
      const trailingLate = late && deficit >= 1;
      const statDrive = (input: Omit<Parameters<StatKeeper["drive"]>[0], "offense" | "shortField" | "trailingLate">) =>
        keeper?.drive({ offense, shortField: wasShort, trailingLate, ...input }) ?? null;

      if (pick === "TD") {
        add(offense, 6);
        const conv = conversion(offense, late);
        add(offense, conv.pts);
        stats[offense].touchdowns++;
        outcome = "TD";
        points = { team: offense, value: 6 + conv.pts };
        const passing = rng.chance(Math.min(0.8, Math.max(0.4, off.passShare + 0.05)));
        if (passing) {
          const catcher = pickName(rng, off.attribution.receivers);
          if (!off.generic) creditTd(offense, catcher);
          const y = statDrive({ outcome: "TD", td: { kind: "pass", receiver: catcher } })?.scoringPlayYards;
          if (!fast) {
            text = off.generic
              ? `The ${off.name} score on a${y ? ` ${y}-yard` : ""} touchdown pass.${conv.note}`
              : `${off.attribution.qbName} finds ${catcher} for a${y ? ` ${y}-yard` : ""} touchdown.${conv.note}`;
          }
        } else {
          const runner = rng.chance(off.attribution.qbRushShare) ? off.attribution.qbName : off.attribution.rbName;
          if (!off.generic) creditTd(offense, runner);
          const y = statDrive({ outcome: "TD", td: { kind: "rush", runner } })?.scoringPlayYards;
          if (!fast && off.generic) {
            text = y && y >= 10
              ? `The ${off.name} break off a ${y}-yard touchdown run.${conv.note}`
              : `The ${off.name} punch it in${y ? ` from ${y} yard${y === 1 ? "" : "s"} out` : ""}.${conv.note}`;
          } else if (!fast) {
            text = y && y >= 10
              ? `${runner} breaks off a ${y}-yard touchdown run.${conv.note}`
              : `${runner} punches it in${y ? ` from ${y} yard${y === 1 ? "" : "s"} out` : " on the ground"}.${conv.note}`;
          }
        }
      } else if (pick === "FG") {
        if (rng.chance(CAL.fgMake)) {
          add(offense, 3);
          stats[offense].fieldGoals++;
          outcome = "FG";
          points = { team: offense, value: 3 };
          const d = statDrive({ outcome: "FG" })?.fieldGoalDistance;
          if (!fast) text = d ? `${d}-yard field goal, ${off.name}.` : `Field goal, ${off.name}.`;
        } else {
          outcome = "FG_MISS";
          shortField[defense] = true;
          const d = statDrive({ outcome: "FG_MISS" })?.fieldGoalDistance;
          if (!fast) text = `Missed${d ? ` ${d}-yard` : ""} field goal for ${off.name}.`;
        }
      } else if (pick === "TO") {
        stats[offense].turnovers++;
        const interception = rng.chance(0.7);
        const captainMadeIt = rng.chance(
          interception
            ? def.attribution.captainArchetype === "coverage" ? 0.35 : 0.1
            : def.attribution.captainArchetype === "coverage" ? 0.1 : 0.25
        );
        const by = captainMadeIt && !def.generic ? def.attribution.captainName : `the ${def.attribution.defenseName}`;
        // Agreement: a player is singular ("intercepts"); a team name is plural ("intercept").
        const verb = (singular: string, plural: string) => (captainMadeIt && !def.generic ? singular : plural);
        const victim = off.generic ? `the ${off.name}` : null;
        const loser = interception
          ? off.attribution.qbName
          : pickName(rng, [
              { name: off.attribution.rbName, weight: 0.6 },
              { name: off.attribution.receivers[0].name, weight: 0.25 },
              { name: off.attribution.qbName, weight: 0.15 },
            ]);
        const turnover = { kind: interception ? "int" : "fumble", player: loser, byCaptain: captainMadeIt } as const;
        if (rng.chance(CAL.defTdPerTurnover)) {
          statDrive({ outcome: "DEF_TD", turnover });
          add(defense, 6);
          const conv = conversion(defense, late);
          add(defense, conv.pts);
          stats[defense].touchdowns++;
          outcome = "DEF_TD";
          points = { team: defense, value: 6 + conv.pts };
          if (captainMadeIt && !def.generic) creditTd(defense, def.attribution.captainName);
          if (!fast) {
            text = interception
              ? `PICK-SIX! ${by.charAt(0).toUpperCase() + by.slice(1)} ${verb("intercepts", "intercept")} ${victim ?? loser} and ${verb("takes", "take")} it to the house.${conv.note}`
              : `${by} ${verb("scoops", "scoop")} up a ${victim ? `${off.name}` : loser} fumble and ${verb("scores", "score")}!${conv.note}`;
          }
        } else {
          statDrive({ outcome: "TO", turnover });
          outcome = "TO";
          shortField[defense] = true;
          if (!fast) {
            text = interception
              ? `${by} ${verb("intercepts", "intercept")} ${victim ?? loser}.`
              : victim
                ? `The ${off.name} fumble — recovered by ${by}.`
                : `${loser} fumbles — recovered by ${by}.`;
          }
        }
      } else if (pick === "DOWNS") {
        outcome = "DOWNS";
        shortField[defense] = true;
        statDrive({ outcome: "DOWNS" });
        if (!fast) text = `Turnover on downs for ${off.name}.`;
      } else {
        outcome = lastInHalf ? "END_HALF" : "PUNT";
        statDrive({ outcome });
        if (!fast) text = lastInHalf ? `End of half for ${off.name}.` : `Punt, ${off.name}.`;
      }
    }

    if (text) text = text.charAt(0).toUpperCase() + text.slice(1);
    drives.push({ index, quarter, offense, outcome, points, score: [score[0], score[1]], text });

    if (!fast && points) {
      const scorer = points.team;
      const leaderAfter = Math.sign(margin(1));
      const tookLead = leaderAfter !== leaderBefore && leaderAfter === (scorer === 1 ? 1 : -1);
      let priority = 0;
      if (outcome === "DEF_TD" || outcome === "RETURN_TD") priority = 80;
      else if (quarter >= 4 && tookLead) priority = 75;
      else if (quarter >= 4 && leaderAfter === 0) priority = 72;
      if (priority) momentCandidates.push({ quarter, team: scorer, text, score: [score[0], score[1]], priority, order: index });
    }
    if (!fast && outcome === "TO" && quarter >= 4 && Math.abs(margin(1)) <= 8) {
      momentCandidates.push({ quarter, team: defense, text, score: [score[0], score[1]], priority: 70, order: index });
    }
    if (!fast && late && drives[index].text.includes("FAILS")) {
      momentCandidates.push({ quarter, team: offense, text, score: [score[0], score[1]], priority: 60, order: index });
    }
    return outcome;
  };

  // --- regulation ----------------------------------------------------------
  const firstReceiver: 1 | 2 = rng.chance(0.5) ? 1 : 2;
  for (let half = 0; half < 2; half++) {
    const n = rng.int(CAL.possessionsPerHalf[0], CAL.possessionsPerHalf[1]);
    const receiver = half === 0 ? firstReceiver : other(firstReceiver);
    for (let i = 0; i < n; i++) {
      const offense: 1 | 2 = i % 2 === 0 ? receiver : other(receiver);
      const quarter = (half * 2 + (i < n / 2 ? 1 : 2)) as 1 | 2 | 3 | 4;
      runDrive(offense, quarter, half === 1 && i >= n - 4, i === n - 1);
    }
  }
  const regulationEndIndex = drives.length;

  // --- overtime: both teams get a possession, then sudden death -------------
  let overtime = false;
  if (score[0] === score[1]) {
    overtime = true;
    const receiver: 1 | 2 = rng.chance(0.5) ? 1 : 2;
    const maxPossessions = options.playoff ? Infinity : CAL.regularSeasonOtPossessions;
    for (let k = 0; k < maxPossessions; k++) {
      const offense: 1 | 2 = k % 2 === 0 ? receiver : other(receiver);
      const outcome = runDrive(offense, 5, true, false);
      // A defensive score on the opening possession ends it immediately.
      if (k === 0 && (outcome === "DEF_TD" || outcome === "RETURN_TD") && score[0] !== score[1]) break;
      if (k >= 1 && score[0] !== score[1]) break;
      if (options.playoff && k > 60) break; // safety valve, never hit in practice
    }
  }

  const winner: 1 | 2 | null = score[0] > score[1] ? 1 : score[1] > score[0] ? 2 : null;

  // --- key moments ----------------------------------------------------------
  let keyMoments: KeyMoment[] = [];
  if (!fast) {
    if (overtime && winner) {
      const last = [...drives].reverse().find((d) => d.points?.team === winner);
      if (last) momentCandidates.push({ ...last, team: winner, text: `OVERTIME: ${last.text}`, priority: 100, order: last.index });
    } else if (winner) {
      // A score in the final possessions of regulation that put the winner ahead for good.
      const lateDrives = drives.slice(Math.max(0, regulationEndIndex - 3), regulationEndIndex);
      const decisive = [...lateDrives].reverse().find((d) => d.points?.team === winner);
      if (decisive && Math.abs(score[0] - score[1]) <= 8) {
        momentCandidates.push({ ...decisive, team: winner, text: `Game-winner: ${decisive.text}`, priority: 95, order: decisive.index });
      }
    }
    let extra = 0;
    for (const [name, v] of Array.from(tdsByPlayer.entries())) {
      if (v.count >= 2) {
        momentCandidates.push({
          quarter: 4, team: v.team,
          text: v.count >= 3 ? `${name} scores ${v.count} touchdowns.` : `${name} finds the end zone twice.`,
          score: [score[0], score[1]], priority: v.count >= 3 ? 65 : 50, order: drives.length + extra++,
        });
      }
    }
    for (const t of [1, 2] as const) {
      if (score[other(t) - 1] === 0) {
        momentCandidates.push({
          quarter: 4, team: t, text: `Shutout by the ${teams[t].attribution.defenseName}.`,
          score: [score[0], score[1]], priority: 70, order: drives.length + extra++,
        });
      }
    }
    // Fillers so blowouts still tell a story: turnovers, then the touchdowns themselves.
    for (const d of drives) {
      if (d.outcome === "TO") momentCandidates.push({ ...d, team: other(d.offense), priority: 40, order: d.index });
      else if (d.outcome === "TD") momentCandidates.push({ ...d, team: d.offense, priority: d === drives.find((x) => x.outcome === "TD") ? 30 : 20, order: d.index });
    }

    const byOrder = new Map<number, (typeof momentCandidates)[number]>();
    for (const m of momentCandidates) {
      const existing = byOrder.get(m.order);
      if (!existing || m.priority > existing.priority) byOrder.set(m.order, m);
    }
    keyMoments = Array.from(byOrder.values())
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 5)
      .sort((a, b) => a.order - b.order)
      .map(({ quarter, team, text, score: s }) => ({ quarter, team, text, score: s }));
    // The same thing can happen twice (two picks of the same QB) — say so instead of repeating.
    const counts = new Map<string, number>();
    const ordinals = ["", "", "again", "for the third time", "for the fourth time", "for the fifth time"];
    for (const m of keyMoments) {
      const n = (counts.get(m.text) ?? 0) + 1;
      counts.set(m.text, n);
      if (n >= 2) m.text = m.text.replace(/\.$/, ` ${ordinals[n] ?? "yet again"}.`);
    }
  }

  return {
    seed: options.seed,
    team1Score: score[0],
    team2Score: score[1],
    winner,
    overtime,
    drives,
    keyMoments,
    teamStats: stats,
    ...(keeper ? { boxScore: keeper.box } : {}),
  };
}

export type MatchupEstimate = {
  team1WinPct: number;
  team2WinPct: number;
  tiePct: number;
  avgTeam1Score: number;
  avgTeam2Score: number;
};

/** Monte Carlo win probability: run many fast games with derived seeds. */
export function estimateMatchup(
  team1: TeamProfile,
  team2: TeamProfile,
  options: { seed: number; sims?: number; home?: 1 | 2 | null; playoff?: boolean }
): MatchupEstimate {
  const sims = options.sims ?? 2000;
  const seeder = createRng(options.seed ^ 0x9e3779b9);
  let w1 = 0;
  let w2 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < sims; i++) {
    const g = simulateGame(team1, team2, {
      seed: Math.floor(seeder.next() * 4294967296),
      home: options.home ?? null,
      playoff: options.playoff,
      fast: true,
    });
    if (g.winner === 1) w1++;
    else if (g.winner === 2) w2++;
    s1 += g.team1Score;
    s2 += g.team2Score;
  }
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return {
    team1WinPct: r3(w1 / sims),
    team2WinPct: r3(w2 / sims),
    tiePct: r3((sims - w1 - w2) / sims),
    avgTeam1Score: Math.round((s1 / sims) * 10) / 10,
    avgTeam2Score: Math.round((s2 / sims) * 10) / 10,
  };
}
