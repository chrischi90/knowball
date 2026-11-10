import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const store = require("./game-store.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const rules = require("../lib/nfl-rules.js");

function draftingGame(sport: "nba" | "nfl", gameMode: "all_time" | "active_only" = "all_time") {
  const g = store.createGame(sport);
  store.joinGame(g.gameId, "s1", 1);
  store.joinGame(g.gameId, "s2", 2);
  store.setGameMode(g.gameId, gameMode);
  store.startDraft(g.gameId);
  return g;
}

describe("NBA games are unchanged", () => {
  it("defaults to nba with 5 positions and the old pick flow", () => {
    const g = draftingGame("nba");
    expect(g.sport).toBe("nba");
    store.spinWheel(g.gameId, "1610612744", "Golden State Warriors");
    expect(store.pickPlayer(g.gameId, 1, "201939", "Stephen Curry", "PG", "1610612744", "PG")).not.toBeNull();
    expect(g.rosters[1].PG.playerId).toBe("201939");
    expect(g.currentTurn).toBe(2);
  });

  it("unknown sport falls back to nba", () => {
    expect(store.createGame("cricket").sport).toBe("nba");
  });
});

describe("NFL draft", () => {
  it("creates 8-slot rosters", () => {
    const g = draftingGame("nfl");
    expect(Object.keys(g.rosters[1])).toEqual(rules.NFL_SLOTS);
  });

  it("enforces strict position eligibility", () => {
    const g = draftingGame("nfl");
    store.spinWheel(g.gameId, "KC", "Kansas City Chiefs");
    expect(store.pickPlayer(g.gameId, 1, "kelce", "Travis Kelce", "RB", "KC", "TE")).toBeNull();
    expect(store.pickPlayer(g.gameId, 1, "kelce", "Travis Kelce", "TE", "KC", "TE")).not.toBeNull();
    expect(g.rosters[1].TE.playerId).toBe("kelce");
  });

  it("fullbacks can fill RB; any defender can be captain", () => {
    const g = draftingGame("nfl");
    store.spinWheel(g.gameId, "SF", "San Francisco 49ers");
    expect(store.pickPlayer(g.gameId, 1, "juice", "Kyle Juszczyk", "RB", "SF", "FB")).not.toBeNull();
    store.spinWheel(g.gameId, "SF", "San Francisco 49ers");
    expect(store.pickPlayer(g.gameId, 2, "bosa", "Nick Bosa", "DEF_CAPTAIN", "SF", "DE")).not.toBeNull();
  });

  it("rejects taken players and filled slots", () => {
    const g = draftingGame("nfl");
    store.spinWheel(g.gameId, "BUF", "Buffalo Bills");
    store.pickPlayer(g.gameId, 1, "allen", "Josh Allen", "QB", "BUF", "QB");
    store.spinWheel(g.gameId, "BUF", "Buffalo Bills");
    expect(store.pickPlayer(g.gameId, 2, "allen", "Josh Allen", "QB", "BUF", "QB")).toBeNull();
  });

  it("all-time: lock any available season of the landed team", () => {
    const g = draftingGame("nfl", "all_time");
    store.spinWheel(g.gameId, "CHI", "Chicago Bears");
    expect(store.lockDefense(g.gameId, 1, 1985).error).toMatch(/before/); // pre-1999 not available yet
    const ok = store.lockDefense(g.gameId, 1, 2006);
    expect(ok.error).toBeUndefined();
    expect(g.rosters[1].TEAM_DEF).toEqual({ slot: "TEAM_DEF", teamId: "CHI", teamName: "Chicago Bears", season: 2006 });
    expect(g.currentTurn).toBe(2);
    expect(g.wheelTeamId).toBeNull();
  });

  it("2p: the other player can't lock the same team's defense in any season", () => {
    const g = draftingGame("nfl", "all_time");
    store.spinWheel(g.gameId, "CHI", "Chicago Bears");
    store.lockDefense(g.gameId, 1, 2006);
    store.spinWheel(g.gameId, "CHI", "Chicago Bears");
    expect(store.lockDefense(g.gameId, 2, 2018).error).toMatch(/opponent/);
  });

  it("active-only: must use the current stats season", () => {
    const g = draftingGame("nfl", "active_only");
    const now = new Date(Date.UTC(2026, 10, 3)); // week 9 → 2025 stats
    store.spinWheel(g.gameId, "PHI", "Philadelphia Eagles");
    expect(store.lockDefense(g.gameId, 1, 2018, now).error).toMatch(/current season/);
    expect(store.lockDefense(g.gameId, 1, 2025, now).error).toBeUndefined();
  });

  it("only on your turn, and only once", () => {
    const g = draftingGame("nfl");
    store.spinWheel(g.gameId, "KC", "Kansas City Chiefs");
    expect(store.lockDefense(g.gameId, 2, 2020).error).toMatch(/turn/);
    store.lockDefense(g.gameId, 1, 2020);
    store.spinWheel(g.gameId, "KC", "Kansas City Chiefs");
    store.pickPlayer(g.gameId, 2, "x", "X", "QB", "KC", "QB");
    store.spinWheel(g.gameId, "BUF", "Buffalo Bills");
    expect(store.lockDefense(g.gameId, 1, 2020).error).toMatch(/already filled/);
  });

  it("moves to simulation when both 8-slot rosters are full; rematch keeps NFL", () => {
    const g = draftingGame("nfl");
    const slots: [string, string][] = [["QB", "QB"], ["RB", "RB"], ["WR1", "WR"], ["WR2", "WR"], ["WR3", "WR"], ["TE", "TE"], ["DEF_CAPTAIN", "LB"]];
    const teams = ["KC", "BUF"];
    for (const [slot, pos] of slots) {
      for (const pn of [1, 2]) {
        store.spinWheel(g.gameId, teams[pn - 1], teams[pn - 1]);
        expect(store.pickPlayer(g.gameId, pn, `${pn}-${slot}`, slot, slot, teams[pn - 1], pos)).not.toBeNull();
      }
    }
    expect(g.phase).toBe("drafting");
    for (const pn of [1, 2]) {
      store.spinWheel(g.gameId, teams[pn - 1], teams[pn - 1]);
      expect(store.lockDefense(g.gameId, pn, 2020).error).toBeUndefined();
    }
    expect(g.phase).toBe("simulation");
    store.rematchGame(g.gameId);
    expect(g.sport).toBe("nfl");
    expect(rules.getOpenSlots(g.rosters[1])).toHaveLength(8);
  });
});
