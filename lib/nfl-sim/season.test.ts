import { describe, expect, it } from "vitest";
import type { NflLeagueSeason } from "@/lib/nfl-types";
import leagueJson from "./__fixtures__/league-2025.json";
import { buildSchedule, leagueProfiles, profileFromUnits, seedConference, simulateSeason, createRng, PLAYOFF_ROUNDS } from "./index";

const league = leagueJson as NflLeagueSeason;

function many(off: number, def: number, n: number) {
  const p = profileFromUnits("T", off, def);
  return Array.from({ length: n }, (_, i) => simulateSeason(p, league, { seed: i + 1, expectedWinsSims: 50 }));
}

describe("schedule", () => {
  const teams = leagueProfiles(league);
  it("follows the NFL formula: 17 games, each division rival twice", () => {
    const rng = createRng(1);
    for (const team of teams) {
      const s = buildSchedule(team, teams, rng);
      expect(s).toHaveLength(17);
      const rivals = teams.filter((t) => t.division === team.division && t.id !== team.id);
      for (const r of rivals) {
        const vs = s.filter((g) => g.opponent.id === r.id);
        expect(vs).toHaveLength(2);
        expect(vs.filter((g) => g.home)).toHaveLength(1);
      }
      expect(s.filter((g) => g.opponent.conference !== team.conference)).toHaveLength(5);
      expect(s.some((g) => g.opponent.id === team.id)).toBe(false);
    }
  });
});

describe("seeding", () => {
  it("puts the four division winners in seeds 1-4, best others 5-7", () => {
    const rows = [
      { id: "a1", name: "a1", wins: 9, losses: 8, ties: 0, pointsFor: 0, pointsAgainst: 0 },
      { id: "a2", name: "a2", wins: 13, losses: 4, ties: 0, pointsFor: 0, pointsAgainst: 0 },
      { id: "b1", name: "b1", wins: 12, losses: 5, ties: 0, pointsFor: 0, pointsAgainst: 0 },
      { id: "b2", name: "b2", wins: 3, losses: 14, ties: 0, pointsFor: 0, pointsAgainst: 0 },
      { id: "c1", name: "c1", wins: 8, losses: 9, ties: 0, pointsFor: 0, pointsAgainst: 0 },
      { id: "c2", name: "c2", wins: 11, losses: 6, ties: 0, pointsFor: 0, pointsAgainst: 0 },
      { id: "d1", name: "d1", wins: 7, losses: 10, ties: 0, pointsFor: 0, pointsAgainst: 0 },
      { id: "d2", name: "d2", wins: 10, losses: 7, ties: 0, pointsFor: 0, pointsAgainst: 0 },
    ];
    const seeds = seedConference(rows, (id) => id[0], createRng(1));
    expect(seeds.map((r) => r.id)).toEqual(["a2", "b1", "c2", "d2", "a1", "c1", "d1"]);
  });
});

describe("simulateSeason", () => {
  it("is deterministic for a seed", () => {
    const p = profileFromUnits("T", 0.5, 0.5);
    expect(simulateSeason(p, league, { seed: 9, expectedWinsSims: 20 })).toEqual(
      simulateSeason(p, league, { seed: 9, expectedWinsSims: 20 })
    );
  });

  it("produces a coherent season", () => {
    const r = simulateSeason(profileFromUnits("T", 0.5, 0.5), league, { seed: 3, expectedWinsSims: 20 });
    expect(r.games).toHaveLength(17);
    expect(r.wins + r.losses + r.ties).toBe(17);
    const weeks = r.games.map((g) => g.week);
    expect(new Set(weeks).size).toBe(17);
    expect(weeks).not.toContain(r.byeWeek);
    expect(Math.max(...weeks)).toBeLessThanOrEqual(18);
    expect(r.divisionStandings).toHaveLength(4);
    expect(r.divisionStandings.some((s) => s.isUser)).toBe(true);
    expect(r.pointsFor).toBe(r.games.reduce((s, g) => s + g.teamScore, 0));
    if (r.madePlayoffs) {
      expect(r.playoffSeed).toBeGreaterThanOrEqual(1);
      expect(r.playoffSeed).toBeLessThanOrEqual(7);
      expect(r.playoffGames.length).toBeGreaterThan(0);
      expect(r.playoffBye).toBe(r.playoffSeed === 1);
      // #1 seed skips the wild card round.
      if (r.playoffBye) expect(r.playoffGames[0].round).toBe("Divisional");
    } else {
      expect(r.playoffGames).toHaveLength(0);
      expect(r.playoffResult).toBeNull();
    }
  });

  it("an average team looks like an average NFL team", () => {
    const seasons = many(0, 0, 150);
    const avgWins = seasons.reduce((s, r) => s + r.wins, 0) / seasons.length;
    const playoffRate = seasons.filter((r) => r.madePlayoffs).length / seasons.length;
    expect(avgWins).toBeGreaterThan(7.5);
    expect(avgWins).toBeLessThan(9.5);
    expect(playoffRate).toBeGreaterThan(0.2);
    expect(playoffRate).toBeLessThan(0.55);
  });

  it("super teams dominate organically but can still lose in January", () => {
    const seasons = many(1.6, 1.7, 150);
    const avgWins = seasons.reduce((s, r) => s + r.wins, 0) / seasons.length;
    const titles = seasons.filter((r) => r.playoffResult === "Champion").length / seasons.length;
    expect(avgWins).toBeGreaterThan(14.5);
    expect(titles).toBeGreaterThan(0.6);
    expect(titles).toBeLessThan(1);
  });

  it("playoff results use the NFL round names", () => {
    for (const r of many(0.6, 0.6, 40)) {
      if (r.playoffResult) expect([...PLAYOFF_ROUNDS, "Champion"]).toContain(r.playoffResult);
      for (const g of r.playoffGames) expect(PLAYOFF_ROUNDS).toContain(g.round);
    }
  });
});
