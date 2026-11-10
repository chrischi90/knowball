/**
 * 1-player season mode: the user's team joins the real NFL (taking a random team's place in
 * the league), plays an NFL-style 17-game schedule, then the playoffs: 7 seeds per conference
 * (4 division winners + 3 wild cards), #1 seed bye, single elimination, re-seeding after the
 * wild-card round, neutral-site final. Every game runs on the drive engine.
 */
import type { NflLeagueSeason } from "@/lib/nfl-types";
import { CAL, estimateMatchup, moveForPointsPerGame, simulateGame, type KeyMoment } from "./game";
import { profileFromUnits, type TeamProfile } from "./ratings";
import { createRng, type Rng } from "./rng";

export const FINAL_ROUND_NAME = "Super Bowl";
export const PLAYOFF_ROUNDS = ["Wild Card", "Divisional", "Conference Championship", FINAL_ROUND_NAME] as const;
export type PlayoffRoundName = (typeof PLAYOFF_ROUNDS)[number];

export type LeagueEntry = {
  id: string;
  name: string;
  conference: "AFC" | "NFC";
  division: string;
  profile: TeamProfile;
  isUser?: boolean;
};

export type SeasonGame = {
  week: number;
  opponentId: string;
  opponent: string;
  home: boolean;
  teamScore: number;
  opponentScore: number;
  result: "W" | "L" | "T";
  overtime: boolean;
  keyMoments: KeyMoment[];
};

export type StandingsRow = {
  id: string;
  name: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  isUser?: boolean;
};

export type PlayoffGame = {
  round: PlayoffRoundName;
  opponentId: string;
  opponent: string;
  opponentSeed: number | null;
  home: boolean | null; // null = neutral site
  teamScore: number;
  opponentScore: number;
  won: boolean;
  overtime: boolean;
  keyMoments: KeyMoment[];
};

export type SeasonResult = {
  seed: number;
  season: number;
  conference: "AFC" | "NFC";
  division: string;
  replacedTeam: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  expectedWins: number;
  byeWeek: number;
  games: SeasonGame[];
  divisionStandings: StandingsRow[];
  madePlayoffs: boolean;
  playoffSeed: number | null;
  playoffBye: boolean;
  playoffGames: PlayoffGame[];
  /** null = missed playoffs; otherwise the round they lost in, or "Champion". */
  playoffResult: PlayoffRoundName | "Champion" | null;
  champion: string;
  milestones: string[];
};

/** Turn a real season's points for/against into engine-scale opponent profiles. */
export function leagueProfiles(league: NflLeagueSeason): LeagueEntry[] {
  const base = moveForPointsPerGame(league.leaguePointsPerGame);
  return league.teams.map((t) => ({
    id: t.teamId,
    name: t.teamName,
    conference: t.conference,
    division: t.division,
    profile: profileFromUnits(
      t.teamName,
      moveForPointsPerGame(t.pointsForPerGame) - base,
      (base - moveForPointsPerGame(t.pointsAgainstPerGame)) / CAL.defScale
    ),
  }));
}

type ScheduledGame = { opponent: LeagueEntry; home: boolean };

function shuffle<T>(rng: Rng, items: T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * NFL scheduling formula for one team: 6 division games (home + away), 4 vs one other
 * division in the conference, 1 each vs the two remaining conference divisions, 4 vs one
 * division in the other conference, and a 17th game vs another other-conference team.
 */
export function buildSchedule(team: LeagueEntry, league: LeagueEntry[], rng: Rng): ScheduledGame[] {
  const others = league.filter((t) => t.id !== team.id);
  const divisions = (conf: string) =>
    Array.from(new Set(league.filter((t) => t.conference === conf).map((t) => t.division)));
  const inDivision = (div: string) => others.filter((t) => t.division === div);

  const games: ScheduledGame[] = [];
  for (const rival of inDivision(team.division)) {
    games.push({ opponent: rival, home: true }, { opponent: rival, home: false });
  }
  const confDivs = shuffle(rng, divisions(team.conference).filter((d) => d !== team.division));
  const otherConf = team.conference === "AFC" ? "NFC" : "AFC";
  const otherDivs = shuffle(rng, divisions(otherConf));
  const fourGameSet = (div: string) =>
    shuffle(rng, inDivision(div)).map((opponent, i) => ({ opponent, home: i % 2 === 0 }));

  games.push(...fourGameSet(confDivs[0]));
  for (const div of confDivs.slice(1)) {
    const pool = inDivision(div);
    if (pool.length) games.push({ opponent: pool[rng.int(0, pool.length - 1)], home: rng.chance(0.5) });
  }
  games.push(...fourGameSet(otherDivs[0]));
  const seventeenth = otherDivs.slice(1).flatMap((d) => inDivision(d));
  if (seventeenth.length) games.push({ opponent: seventeenth[rng.int(0, seventeenth.length - 1)], home: rng.chance(0.5) });

  return shuffle(rng, games).slice(0, 17);
}

const winPct = (r: StandingsRow) => (r.wins + 0.5 * r.ties) / Math.max(1, r.wins + r.losses + r.ties);

function rank(rows: StandingsRow[], rng: Rng): StandingsRow[] {
  // Record, then point differential, then a coin flip (stand-in for the full tiebreaker list).
  const tiebreak = new Map(rows.map((r) => [r.id, rng.next()]));
  return rows.slice().sort(
    (a, b) =>
      winPct(b) - winPct(a) ||
      b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst) ||
      tiebreak.get(b.id)! - tiebreak.get(a.id)!
  );
}

/** 7-team conference seeding: division winners 1-4, best remaining records 5-7. */
export function seedConference(rows: StandingsRow[], divisionOf: (id: string) => string, rng: Rng): StandingsRow[] {
  const ranked = rank(rows, rng);
  const winners: StandingsRow[] = [];
  const seenDivisions = new Set<string>();
  for (const r of ranked) {
    const d = divisionOf(r.id);
    if (!seenDivisions.has(d)) {
      seenDivisions.add(d);
      winners.push(r);
    }
  }
  const wildCards = ranked.filter((r) => !winners.includes(r)).slice(0, 3);
  return [...winners, ...wildCards];
}

export function simulateSeason(
  user: TeamProfile,
  league: NflLeagueSeason,
  options: { seed: number; expectedWinsSims?: number }
): SeasonResult {
  const rng = createRng(options.seed);
  const gameSeed = () => Math.floor(rng.next() * 4294967296);
  const real = leagueProfiles(league);

  // The user's team takes a random team's place in the league.
  const replaced = real[rng.int(0, real.length - 1)];
  const userEntry: LeagueEntry = {
    id: "USER", name: user.name, conference: replaced.conference, division: replaced.division,
    profile: user, isUser: true,
  };
  const teams = [...real.filter((t) => t.id !== replaced.id), userEntry];
  const byId = new Map(teams.map((t) => [t.id, t]));
  const standings = new Map<string, StandingsRow>(
    teams.map((t) => [t.id, { id: t.id, name: t.name, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, isUser: t.isUser }])
  );
  const record = (id: string, pf: number, pa: number) => {
    const r = standings.get(id)!;
    r.pointsFor += pf;
    r.pointsAgainst += pa;
    if (pf > pa) r.wins++;
    else if (pf < pa) r.losses++;
    else r.ties++;
  };

  // --- user's regular season ---------------------------------------------------
  const schedule = buildSchedule(userEntry, teams, rng);
  const byeWeek = rng.int(5, 14);
  const games: SeasonGame[] = [];
  let expectedWins = 0;
  const vsUser = new Map<string, number>();
  schedule.forEach((g, i) => {
    const week = i + 1 >= byeWeek ? i + 2 : i + 1;
    const result = simulateGame(user, g.opponent.profile, { seed: gameSeed(), home: g.home ? 1 : 2 });
    const est = estimateMatchup(user, g.opponent.profile, {
      seed: gameSeed(), sims: options.expectedWinsSims ?? 300, home: g.home ? 1 : 2,
    });
    expectedWins += est.team1WinPct + 0.5 * est.tiePct;
    record("USER", result.team1Score, result.team2Score);
    record(g.opponent.id, result.team2Score, result.team1Score);
    vsUser.set(g.opponent.id, (vsUser.get(g.opponent.id) ?? 0) + 1);
    games.push({
      week, opponentId: g.opponent.id, opponent: g.opponent.name, home: g.home,
      teamScore: result.team1Score, opponentScore: result.team2Score,
      result: result.winner === 1 ? "W" : result.winner === 2 ? "L" : "T",
      overtime: result.overtime, keyMoments: result.keyMoments,
    });
  });

  // --- everyone else's season (fast games) -------------------------------------
  // Each team plays its own formula schedule; games against the user already happened above.
  for (const t of teams) {
    if (t.isUser) continue;
    const remaining = 17 - (vsUser.get(t.id) ?? 0);
    const own = buildSchedule(t, teams, rng).filter((g) => !g.opponent.isUser).slice(0, remaining);
    for (const g of own) {
      const r = simulateGame(t.profile, g.opponent.profile, { seed: gameSeed(), home: g.home ? 1 : 2, fast: true });
      record(t.id, r.team1Score, r.team2Score);
    }
  }

  const userRow = standings.get("USER")!;
  const divisionStandings = rank(
    teams.filter((t) => t.division === userEntry.division).map((t) => standings.get(t.id)!),
    rng
  );

  // --- playoffs ----------------------------------------------------------------
  const divisionOf = (id: string) => byId.get(id)!.division;
  const seeds: Record<"AFC" | "NFC", StandingsRow[]> = {
    AFC: seedConference(teams.filter((t) => t.conference === "AFC").map((t) => standings.get(t.id)!), divisionOf, rng),
    NFC: seedConference(teams.filter((t) => t.conference === "NFC").map((t) => standings.get(t.id)!), divisionOf, rng),
  };
  const userSeedIndex = seeds[userEntry.conference].findIndex((r) => r.isUser);
  const madePlayoffs = userSeedIndex >= 0;
  const playoffGames: PlayoffGame[] = [];
  let userAlive = madePlayoffs;
  let playoffResult: SeasonResult["playoffResult"] = null;

  type Seeded = { row: StandingsRow; seed: number };
  const playGame = (a: Seeded, b: Seeded | null, round: PlayoffRoundName, neutral: boolean): Seeded => {
    if (!b) return a;
    const higher = a.seed <= b.seed ? a : b;
    const lower = higher === a ? b : a;
    const userGame = a.row.isUser || b.row.isUser;
    const r = simulateGame(byId.get(higher.row.id)!.profile, byId.get(lower.row.id)!.profile, {
      seed: gameSeed(), home: neutral ? null : 1, playoff: true, fast: !userGame,
    });
    const winner = r.winner === 1 ? higher : lower;
    if (userGame) {
      const userIsHigher = higher.row.isUser === true;
      const opp = userIsHigher ? lower : higher;
      const won = winner.row.isUser === true;
      playoffGames.push({
        round, opponentId: opp.row.id, opponent: opp.row.name, opponentSeed: neutral ? null : opp.seed,
        home: neutral ? null : userIsHigher,
        teamScore: userIsHigher ? r.team1Score : r.team2Score,
        opponentScore: userIsHigher ? r.team2Score : r.team1Score,
        won, overtime: r.overtime,
        keyMoments: r.keyMoments.map((m) => ({ ...m, team: (userIsHigher ? m.team : m.team === 1 ? 2 : 1) as 1 | 2 })),
      });
      if (!won) {
        userAlive = false;
        playoffResult = round;
      }
    }
    return winner;
  };

  const conferenceChampion = (conf: "AFC" | "NFC"): Seeded => {
    let alive: Seeded[] = seeds[conf].map((row, i) => ({ row, seed: i + 1 }));
    // Wild card: 2v7, 3v6, 4v5; #1 has a bye.
    const wc = [playGame(alive[1], alive[6], "Wild Card", false), playGame(alive[2], alive[5], "Wild Card", false), playGame(alive[3], alive[4], "Wild Card", false)];
    alive = [alive[0], ...wc].sort((x, y) => x.seed - y.seed);
    // Divisional (re-seeded): #1 vs lowest remaining, the other two meet.
    const div = [playGame(alive[0], alive[3], "Divisional", false), playGame(alive[1], alive[2], "Divisional", false)];
    return playGame(div[0], div[1], "Conference Championship", false);
  };

  const afc = conferenceChampion("AFC");
  const nfc = conferenceChampion("NFC");
  const champ = playGame(afc, nfc, FINAL_ROUND_NAME, true);
  if (madePlayoffs && userAlive) playoffResult = "Champion";

  const milestones: string[] = [];
  if (userRow.wins === 17) milestones.push("Perfect regular season!");
  else if (userRow.wins >= 15) milestones.push("Historic season!");
  else if (userRow.wins >= 13) milestones.push("Dominant season");
  if (playoffResult === "Champion") milestones.push(`${FINAL_ROUND_NAME} champions!`);
  else if (playoffResult === FINAL_ROUND_NAME) milestones.push(`Made the ${FINAL_ROUND_NAME}`);
  else if (!madePlayoffs) milestones.push("Missed the playoffs");
  if (madePlayoffs && userSeedIndex === 0) milestones.push("Earned the #1 seed and a bye");

  return {
    seed: options.seed,
    season: league.season,
    conference: userEntry.conference,
    division: userEntry.division,
    replacedTeam: replaced.name,
    wins: userRow.wins,
    losses: userRow.losses,
    ties: userRow.ties,
    pointsFor: userRow.pointsFor,
    pointsAgainst: userRow.pointsAgainst,
    expectedWins: Math.round(expectedWins * 10) / 10,
    byeWeek,
    games,
    divisionStandings,
    madePlayoffs,
    playoffSeed: madePlayoffs ? userSeedIndex + 1 : null,
    playoffBye: madePlayoffs && userSeedIndex === 0,
    playoffGames,
    playoffResult,
    champion: champ.row.name,
    milestones,
  };
}
