import { describe, expect, it } from "vitest";
import {
  NFL_SLOTS,
  createEmptyNflRoster,
  eligibleSlotsFor,
  getNflSeasonContext,
  getOpenSlots,
  isEligibleForSlot,
  isNflRosterComplete,
  normalizeNflPosition,
  validateNflPlayerPick,
  validateTeamDefensePick,
  type NflRoster,
} from "./nfl-types";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 18));

function fullRoster(): NflRoster {
  const r = createEmptyNflRoster();
  for (const slot of ["QB", "RB", "WR1", "WR2", "WR3", "TE", "DEF_CAPTAIN"] as const) {
    r[slot] = { slot, playerId: `p-${slot}`, playerName: slot, teamId: "kan", naturalPosition: null };
  }
  r.TEAM_DEF = { slot: "TEAM_DEF", teamId: "kan", teamName: "Kansas City Chiefs", season: 2025 };
  return r;
}

describe("normalizeNflPosition", () => {
  it.each([
    ["HB", "RB"],
    ["FB", "RB"],
    ["qb", "QB"],
    ["LEDG", "DE"],
    ["REDG", "DE"],
    ["NT", "DT"],
    ["MIKE", "LB"],
    ["OLB", "LB"],
    ["FS", "S"],
    ["SS", "S"],
    ["LB/DE", "LB"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeNflPosition(raw)).toBe(expected);
  });

  it.each(["LT", "C", "K", "P", "LS", "", null, undefined])("ignores non-game position %s", (raw) => {
    expect(normalizeNflPosition(raw)).toBeNull();
  });
});

describe("slot eligibility (strict)", () => {
  it("only lets players fill their own position", () => {
    expect(isEligibleForSlot("RB", "RB")).toBe(true);
    expect(isEligibleForSlot("RB", "TE")).toBe(false);
    expect(isEligibleForSlot("WR2", "TE")).toBe(false);
    expect(isEligibleForSlot("QB", "RB")).toBe(false);
    expect(isEligibleForSlot("TE", "WR")).toBe(false);
  });

  it("fullbacks can fill RB (via normalization)", () => {
    expect(isEligibleForSlot("RB", normalizeNflPosition("FB"))).toBe(true);
  });

  it("defensive captain accepts any defensive position and no offense", () => {
    for (const pos of ["DE", "DT", "LB", "CB", "S", "DB"] as const) {
      expect(isEligibleForSlot("DEF_CAPTAIN", pos)).toBe(true);
    }
    expect(isEligibleForSlot("DEF_CAPTAIN", "QB")).toBe(false);
  });

  it("WRs are eligible for all three WR slots only", () => {
    expect(eligibleSlotsFor("WR")).toEqual(["WR1", "WR2", "WR3"]);
  });
});

describe("roster helpers", () => {
  it("empty roster has all 8 slots open", () => {
    const r = createEmptyNflRoster();
    expect(getOpenSlots(r)).toEqual([...NFL_SLOTS]);
    expect(NFL_SLOTS).toHaveLength(8);
    expect(isNflRosterComplete(r)).toBe(false);
  });

  it("complete roster requires TEAM_DEF with a season", () => {
    const r = fullRoster();
    expect(isNflRosterComplete(r)).toBe(true);
    r.TEAM_DEF = { ...r.TEAM_DEF, season: null };
    expect(getOpenSlots(r)).toEqual(["TEAM_DEF"]);
  });
});

describe("validateNflPlayerPick", () => {
  const base = { roster: createEmptyNflRoster(), takenPlayerIds: [] as string[] };

  it("accepts a valid pick in any open slot order", () => {
    expect(validateNflPlayerPick({ ...base, slot: "WR3", player: { id: "a", position: "WR" } })).toBeNull();
    expect(validateNflPlayerPick({ ...base, slot: "DEF_CAPTAIN", player: { id: "b", position: "CB" } })).toBeNull();
  });

  it("rejects ineligible positions", () => {
    expect(validateNflPlayerPick({ ...base, slot: "RB", player: { id: "a", position: "TE" } })).toMatch(
      /not eligible/
    );
  });

  it("rejects taken players and filled slots", () => {
    expect(
      validateNflPlayerPick({ ...base, takenPlayerIds: ["a"], slot: "QB", player: { id: "a", position: "QB" } })
    ).toBe("Player already taken");
    expect(
      validateNflPlayerPick({ roster: fullRoster(), takenPlayerIds: [], slot: "QB", player: { id: "z", position: "QB" } })
    ).toBe("Slot already filled");
  });
});

describe("validateTeamDefensePick", () => {
  const roster = createEmptyNflRoster();

  it("active_only requires the active stats season", () => {
    const args = { roster, teamId: "kan", wheelTeamId: "kan", gameMode: "active_only" as const, activeSeason: 2025 };
    expect(validateTeamDefensePick({ ...args, season: 2025 })).toBeNull();
    expect(validateTeamDefensePick({ ...args, season: 2019 })).toMatch(/current season/);
  });

  it("all_time allows any available season from NFL_ALL_TIME_START_SEASON on", () => {
    const args = {
      roster,
      teamId: "chi",
      wheelTeamId: "chi",
      gameMode: "all_time" as const,
      availableSeasons: [2000, 2006, 2025],
    };
    expect(validateTeamDefensePick({ ...args, season: 2000 })).toBeNull();
    expect(validateTeamDefensePick({ ...args, season: 2010 })).toMatch(/not available/);
    expect(validateTeamDefensePick({ ...args, season: 1985 })).toMatch(/before 1999/);
  });

  it("must be the team the wheel landed on", () => {
    expect(
      validateTeamDefensePick({
        roster,
        teamId: "kan",
        wheelTeamId: "buf",
        season: 2025,
        gameMode: "active_only",
        activeSeason: 2025,
      })
    ).toMatch(/wheel landed/);
  });

  it("2p: cannot lock a team the opponent already has, in any season", () => {
    const opponent = createEmptyNflRoster();
    opponent.TEAM_DEF = { slot: "TEAM_DEF", teamId: "chi", teamName: "Chicago Bears", season: 2006 };
    expect(
      validateTeamDefensePick({
        roster,
        opponentRoster: opponent,
        teamId: "chi",
        wheelTeamId: "chi",
        season: 2018,
        gameMode: "all_time",
        availableSeasons: [2006, 2018],
      })
    ).toMatch(/opponent already locked/);
  });
});

describe("getNflSeasonContext", () => {
  it("2026 week 9 (today) still uses 2025 stats with 2026 rosters", () => {
    expect(getNflSeasonContext(utc(2026, 11, 9))).toEqual({
      season: 2026,
      phase: "regular",
      week: 9,
      rosterSeason: 2026,
      statsSeason: 2025,
    });
  });

  it("switches to current-season stats at week 10", () => {
    const ctx = getNflSeasonContext(utc(2026, 11, 10)); // Tuesday starting week 10
    expect(ctx.week).toBe(10);
    expect(ctx.statsSeason).toBe(2026);
  });

  it("week 1 starts the Tuesday before kickoff (2025 kickoff Thu Sep 4)", () => {
    expect(getNflSeasonContext(utc(2025, 9, 2)).week).toBe(1);
    expect(getNflSeasonContext(utc(2025, 9, 1)).phase).toBe("offseason");
  });

  it("early-January week 18 games count as regular season of the prior year", () => {
    const ctx = getNflSeasonContext(utc(2027, 1, 10));
    expect(ctx).toMatchObject({ season: 2026, phase: "regular", week: 18, statsSeason: 2026 });
  });

  it("playoffs and Super Bowl use the just-finished season", () => {
    expect(getNflSeasonContext(utc(2027, 2, 7))).toMatchObject({
      season: 2026,
      phase: "postseason",
      rosterSeason: 2026,
      statsSeason: 2026,
    });
  });

  it("offseason uses upcoming rosters and last season's stats", () => {
    expect(getNflSeasonContext(utc(2026, 6, 15))).toEqual({
      season: 2026,
      phase: "offseason",
      week: null,
      rosterSeason: 2026,
      statsSeason: 2025,
    });
  });
});

describe("nameMatchRank", () => {
  it("prefers first-name prefix, then last-name prefix, then substring", async () => {
    const { nameMatchRank } = await import("./nfl-types");
    expect(nameMatchRank("Tom Brady", "to")).toBe(0);
    expect(nameMatchRank("LaDainian Tomlinson", "to")).toBe(1);
    expect(nameMatchRank("Antonio Brown", "to")).toBe(2);
    expect(nameMatchRank("Ja'Marr Chase", "ma")).toBe(1);
    expect(nameMatchRank("Tom Brady", "xyz")).toBe(-1);
    expect(nameMatchRank("Tom Brady", "")).toBe(-1);
  });
});
