/**
 * Box-score layer for the drive engine. The game engine decides every drive's OUTCOME (and who
 * scored / turned it over); this layer fills in the plays that got there — field position,
 * play count, passes and runs, who got the ball, yardage — so stats are always consistent with
 * the game. It uses its own RNG stream, so adding stats never changes a game's result.
 */
import { createRng, type Rng } from "./rng";
import type { TeamProfile, TeamUsage } from "./ratings";

export type PassingLine = { name: string; cmp: number; att: number; yds: number; td: number; int: number; sacked: number };
export type RushingLine = { name: string; att: number; yds: number; td: number; long: number };
export type ReceivingLine = { name: string; tgt: number; rec: number; yds: number; td: number; long: number };
export type DefenseLine = { name: string; tackles: number; sacks: number; int: number; fumbleRecoveries: number; td: number };

export type TeamBox = {
  passing: PassingLine;
  rushing: RushingLine[];
  receiving: ReceivingLine[];
  defense: DefenseLine;
  team: { plays: number; yards: number; passYards: number; rushYards: number; sacks: number };
};

export type BoxScore = Record<1 | 2, TeamBox>;

export type DriveStatInput = {
  offense: 1 | 2;
  outcome: "TD" | "FG" | "FG_MISS" | "PUNT" | "TO" | "DEF_TD" | "DOWNS" | "END_HALF";
  shortField: boolean;
  /** Trailing late: throw more. */
  trailingLate: boolean;
  td?: { kind: "pass"; receiver: string } | { kind: "rush"; runner: string };
  turnover?: { kind: "int" | "fumble"; player: string; byCaptain: boolean };
};

export type DriveStatResult = { yards: number; scoringPlayYards: number | null; fieldGoalDistance: number | null };

// League-typical fallbacks for players/teams without usage data.
const DEFAULT_USAGE = { cmpPct: 0.64, sackRate: 0.065, ypc: 4.3, ypr: 11, catchRate: 0.65 };
/** Targets/carries that go to teammates who aren't on the drafted roster (WR4, RB2, …). */
const OTHERS_TARGETS = 6;
const OTHERS_CARRIES = 10;
const OTHERS = "Teammates";

type Play =
  | { type: "pass"; receiver: string; complete: boolean; weight: number; yards: number }
  | { type: "sack"; yards: number }
  | { type: "run"; runner: string; weight: number; yards: number };

function genericUsage(p: TeamProfile): TeamUsage {
  const a = p.attribution;
  return {
    qb: { name: a.qbName, cmpPct: DEFAULT_USAGE.cmpPct, sackRate: DEFAULT_USAGE.sackRate, rushAttPg: 3, ypc: 4.5 },
    receivers: a.receivers.map((r, i) => ({ name: r.name, tgtPg: [8, 6, 5, 6, 4][i] ?? 4, catchRate: DEFAULT_USAGE.catchRate, ypr: DEFAULT_USAGE.ypr })),
    rushers: [{ name: a.rbName, rushAttPg: 15, ypc: DEFAULT_USAGE.ypc }],
    captain: { name: a.captainName, tacklesPg: 4, sacksPg: 0.3, archetype: a.captainArchetype },
    teamSacksPg: 2.4,
    leagueCatchRate: DEFAULT_USAGE.catchRate,
  };
}

function emptyBox(u: TeamUsage): TeamBox {
  const recNames = Array.from(new Set(u.receivers.map((r) => r.name)));
  const rushNames = Array.from(new Set([...u.rushers.map((r) => r.name), u.qb.name]));
  return {
    passing: { name: u.qb.name, cmp: 0, att: 0, yds: 0, td: 0, int: 0, sacked: 0 },
    rushing: rushNames.map((name) => ({ name, att: 0, yds: 0, td: 0, long: 0 })),
    receiving: recNames.map((name) => ({ name, tgt: 0, rec: 0, yds: 0, td: 0, long: 0 })),
    defense: { name: u.captain.name, tackles: 0, sacks: 0, int: 0, fumbleRecoveries: 0, td: 0 },
    team: { plays: 0, yards: 0, passYards: 0, rushYards: 0, sacks: 0 },
  };
}

/** No receiver gets more than this share of team targets (NFL record-level is ~30%). */
const MAX_TARGET_SHARE = 0.3;

/** Target weights with a per-player cap; excess goes to unnamed teammates. */
export function targetShares(u: TeamUsage): { name: string; w: number }[] {
  const opts = [...u.receivers.map((r) => ({ name: r.name, w: r.tgtPg })), { name: OTHERS, w: OTHERS_TARGETS }];
  const total = opts.reduce((s, o) => s + o.w, 0);
  const cap = MAX_TARGET_SHARE * total;
  const others = opts[opts.length - 1];
  for (const o of opts.slice(0, -1)) {
    if (o.w > cap) {
      others.w += o.w - cap;
      o.w = cap;
    }
  }
  return opts;
}

/** Exponential(1) — gives each play a long tail so big plays happen. */
const expo = (rng: Rng) => -Math.log(Math.max(1e-9, 1 - rng.next()));

export class StatKeeper {
  readonly box: BoxScore;
  private readonly usage: Record<1 | 2, TeamUsage>;
  private readonly rng: Rng;
  private readonly passShare: Record<1 | 2, number>;
  private readonly passRush: Record<1 | 2, number>;
  /** Yards per play multiplier: better offenses gain more per snap (fewer plays per yard). */
  private readonly yppFactor: Record<1 | 2, number>;

  constructor(team1: TeamProfile, team2: TeamProfile, seed: number) {
    // Separate stream from the game RNG: stats never perturb outcomes.
    this.rng = createRng((seed ^ 0x5bd1e995) >>> 0);
    this.usage = { 1: team1.usage ?? genericUsage(team1), 2: team2.usage ?? genericUsage(team2) };
    this.passShare = { 1: team1.passShare, 2: team2.passShare };
    this.passRush = { 1: team1.passRush, 2: team2.passRush };
    const ypp = (t: TeamProfile) =>
      Math.min(1.6, Math.max(0.8, 1 + 0.25 * (t.passShare * t.pass + (1 - t.passShare) * t.rush)));
    this.yppFactor = { 1: ypp(team1), 2: ypp(team2) };
    this.box = { 1: emptyBox(this.usage[1]), 2: emptyBox(this.usage[2]) };
  }

  private pickReceiver(u: TeamUsage): string {
    const opts = targetShares(u);
    return opts[this.rng.weighted(opts.map((o) => o.w))].name;
  }

  private pickRunner(u: TeamUsage): string {
    const opts = [
      ...u.rushers.map((r) => ({ name: r.name, w: r.rushAttPg })),
      { name: u.qb.name, w: u.qb.rushAttPg },
      { name: OTHERS, w: OTHERS_CARRIES },
    ];
    return opts[this.rng.weighted(opts.map((o) => Math.max(0.2, o.w)))].name;
  }

  private receiverOf(u: TeamUsage, name: string) {
    return u.receivers.find((r) => r.name === name) ?? { name, tgtPg: OTHERS_TARGETS, catchRate: DEFAULT_USAGE.catchRate, ypr: 9.5 };
  }

  private runnerYpc(u: TeamUsage, name: string) {
    if (name === u.qb.name) return u.qb.ypc;
    return u.rushers.find((r) => r.name === name)?.ypc ?? 3.9;
  }

  /** Fill in one drive's plays. Returns yardage details for key-moment text. */
  drive(input: DriveStatInput): DriveStatResult {
    const rng = this.rng;
    const off = input.offense;
    const def: 1 | 2 = off === 1 ? 2 : 1;
    const u = this.usage[off];
    const box = this.box[off];
    const defBox = this.box[def];

    // Field position: own ~30 normally, near midfield after a turnover / failed 4th down.
    const start = input.shortField ? rng.int(40, 65) : rng.int(22, 35);
    const toGoal = 100 - start;
    let yards: number;
    switch (input.outcome) {
      case "TD":
        yards = toGoal;
        break;
      case "FG":
      case "FG_MISS": {
        const endFromGoal = Math.min(toGoal - 1, rng.int(3, 33));
        yards = Math.max(0, toGoal - endFromGoal);
        break;
      }
      case "PUNT":
        yards = Math.min(Math.round(expo(rng) * 12), Math.max(0, toGoal - 40));
        break;
      case "DOWNS":
        yards = Math.min(rng.int(5, 45), Math.max(0, toGoal - 5));
        break;
      case "END_HALF":
        yards = Math.min(rng.int(0, 30), Math.max(0, toGoal - 30));
        break;
      default: // TO / DEF_TD
        yards = Math.min(Math.round(expo(rng) * 15), Math.max(0, toGoal - 5));
    }

    // Play count scales with distance covered (NFL: ~5.8 plays and ~63 plays per team-game).
    const perPlay = 7.8 * this.yppFactor[off];
    let nPlays = Math.max(input.outcome === "TD" ? 1 : 3, Math.round(yards / perPlay + 1.5 + rng.normal() * 1.1));
    if (input.outcome === "TO" || input.outcome === "DEF_TD") nPlays = Math.max(1, Math.round(yards / perPlay + 0.5 + rng.next() * 2));
    // Engine passShare is a play-calling tendency; real dropback share runs ~54% (incl. sacks).
    const share = Math.min(0.85, this.passShare[off] * 0.96 + (input.trailingLate ? 0.15 : 0));
    const sackRate = u.qb.sackRate * Math.exp(0.3 * Math.max(-1, Math.min(2, this.passRush[def])));
    const qbCmp = u.qb.cmpPct;

    const plays: Play[] = [];
    const makePass = (receiver?: string, forceComplete?: boolean): Extract<Play, { type: "pass" }> => {
      const name = receiver ?? this.pickReceiver(u);
      const r = this.receiverOf(u, name);
      const p = Math.min(0.92, qbCmp * Math.pow(r.catchRate / u.leagueCatchRate, 0.6));
      const complete = forceComplete ?? rng.chance(p);
      return { type: "pass", receiver: name, complete, weight: complete ? r.ypr * (0.35 + expo(rng)) : 0, yards: 0 };
    };
    const makeRun = (runner?: string): Extract<Play, { type: "run" }> => {
      const name = runner ?? this.pickRunner(u);
      return { type: "run", runner: name, weight: this.runnerYpc(u, name) * (0.3 + expo(rng)), yards: 0 };
    };

    for (let i = 0; i < nPlays - 1; i++) {
      if (rng.chance(share)) plays.push(rng.chance(sackRate) ? { type: "sack", yards: -rng.int(4, 10) } : makePass());
      else plays.push(makeRun());
    }
    // The final play is whatever the game engine said happened.
    let last: Play;
    if (input.td?.kind === "pass") last = makePass(input.td.receiver, true);
    else if (input.td?.kind === "rush") last = makeRun(input.td.runner);
    else if (input.turnover?.kind === "int") last = { type: "pass", receiver: this.pickReceiver(u), complete: false, weight: 0, yards: 0 };
    else if (input.turnover?.kind === "fumble") {
      const who = input.turnover.player;
      last = who === u.qb.name || u.rushers.some((r) => r.name === who) ? makeRun(who) : makePass(who, true);
    } else if (input.outcome === "DOWNS") {
      // Failed fourth down: an incompletion or a stuffed run.
      last = rng.chance(share)
        ? { type: "pass", receiver: this.pickReceiver(u), complete: false, weight: 0, yards: 0 }
        : { ...makeRun(), weight: 0 };
    }
    else last = rng.chance(share) ? makePass() : makeRun();
    plays.push(last);

    // Spread the drive's yards across gaining plays (sacks already lose yards).
    const sackLoss = plays.reduce((s, p) => s + (p.type === "sack" ? p.yards : 0), 0);
    const toGain = Math.max(0, yards - sackLoss);
    const gainers = plays.filter((p): p is Exclude<Play, { type: "sack" }> => p.type !== "sack" && p.weight > 0);
    const totalW = gainers.reduce((s, p) => s + p.weight, 0);
    if (gainers.length && totalW > 0) {
      let assigned = 0;
      gainers.forEach((p) => {
        p.yards = Math.floor((p.weight / totalW) * toGain);
        assigned += p.yards;
      });
      // Rounding remainder goes to the scoring/last gaining play.
      gainers[gainers.length - 1].yards += toGain - assigned;
    }

    // Record.
    for (const p of plays) {
      box.team.plays++;
      if (p.type === "sack") {
        box.passing.sacked++;
        box.team.yards += p.yards;
        box.team.passYards += p.yards;
        defBox.team.sacks++;
        if (this.rng.chance(this.captainSackShare(def))) defBox.defense.sacks++;
        continue;
      }
      if (p.type === "pass") {
        box.passing.att++;
        const rec = this.recLine(box, p.receiver);
        if (rec) rec.tgt++;
        if (p.complete) {
          box.passing.cmp++;
          box.passing.yds += p.yards;
          box.team.yards += p.yards;
          box.team.passYards += p.yards;
          if (rec) {
            rec.rec++;
            rec.yds += p.yards;
            rec.long = Math.max(rec.long, p.yards);
          }
          this.creditTackle(def);
        }
      } else {
        const line = this.rushLine(box, p.runner);
        box.team.yards += p.yards;
        box.team.rushYards += p.yards;
        if (line) {
          line.att++;
          line.yds += p.yards;
          line.long = Math.max(line.long, p.yards);
        }
        this.creditTackle(def);
      }
    }

    if (input.td?.kind === "pass") {
      box.passing.td++;
      const rec = this.recLine(box, input.td.receiver);
      if (rec) rec.td++;
    } else if (input.td?.kind === "rush") {
      const line = this.rushLine(box, input.td.runner);
      if (line) line.td++;
    }
    if (input.turnover) {
      if (input.turnover.kind === "int") box.passing.int++;
      if (input.turnover.byCaptain) {
        if (input.turnover.kind === "int") defBox.defense.int++;
        else defBox.defense.fumbleRecoveries++;
        if (input.outcome === "DEF_TD") defBox.defense.td++;
      }
    }

    const lastPlay = plays[plays.length - 1];
    const scoringPlayYards = input.td && lastPlay.type !== "sack" ? Math.max(1, lastPlay.yards) : null;
    const fieldGoalDistance = input.outcome === "FG" || input.outcome === "FG_MISS" ? toGoal - yards + 17 : null;
    return { yards, scoringPlayYards, fieldGoalDistance };
  }

  private recLine(box: TeamBox, name: string) {
    return name === OTHERS ? null : box.receiving.find((r) => r.name === name) ?? null;
  }

  private rushLine(box: TeamBox, name: string) {
    return name === OTHERS ? null : box.rushing.find((r) => r.name === name) ?? null;
  }

  private captainSackShare(def: 1 | 2) {
    const c = this.usage[def].captain;
    return Math.min(0.8, c.sacksPg / Math.max(this.usage[def].teamSacksPg, c.sacksPg + 0.3));
  }

  /** Captain makes the tackle on a share of the opponent's runs/catches (by real tackle rate). */
  private creditTackle(def: 1 | 2) {
    const c = this.usage[def].captain;
    if (this.rng.chance(Math.min(0.3, c.tacklesPg / 45))) this.box[def].defense.tackles++;
  }
}

/** Sum per-game boxes into season totals (regular season stat lines). */
export function sumBoxes(boxes: TeamBox[]): TeamBox | null {
  if (!boxes.length) return null;
  const out: TeamBox = JSON.parse(JSON.stringify(boxes[0]));
  for (const b of boxes.slice(1)) {
    for (const k of ["cmp", "att", "yds", "td", "int", "sacked"] as const) out.passing[k] += b.passing[k];
    for (const r of b.rushing) {
      const t = out.rushing.find((x) => x.name === r.name);
      if (t) {
        t.att += r.att; t.yds += r.yds; t.td += r.td; t.long = Math.max(t.long, r.long);
      }
    }
    for (const r of b.receiving) {
      const t = out.receiving.find((x) => x.name === r.name);
      if (t) {
        t.tgt += r.tgt; t.rec += r.rec; t.yds += r.yds; t.td += r.td; t.long = Math.max(t.long, r.long);
      }
    }
    for (const k of ["tackles", "sacks", "int", "fumbleRecoveries", "td"] as const) out.defense[k] += b.defense[k];
    for (const k of ["plays", "yards", "passYards", "rushYards", "sacks"] as const) out.team[k] += b.team[k];
  }
  return out;
}
