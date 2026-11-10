import { describe, expect, it } from "vitest";
import { createEmptyNflRoster } from "./nfl-types";
import { decodeShareData, encode2PShareData, encodeNfl2PShareData, encodeNflSoloShareData, encodeSoloShareData } from "./share-utils";
import { createEmptyRoster } from "./game-types";

describe("share links", () => {
  it("old NBA links (no sport marker) still decode as NBA", () => {
    const roster = createEmptyRoster();
    roster.PG.playerName = "Stephen Curry (GSW)";
    const solo = decodeShareData(encodeSoloShareData(roster, { wins: 60, losses: 22, playoffResult: "Champion" }));
    expect(solo).toMatchObject({ mode: "solo", sport: "nba", data: { pg: "Stephen Curry (GSW)", w: 60 } });
    const h2h = decodeShareData(encode2PShareData(roster, roster, { team1Score: 110, team2Score: 99, winner: 1 }));
    expect(h2h).toMatchObject({ mode: "2p", sport: "nba", data: { s1: 110 } });
  });

  it("NFL solo and 2p round-trip with 8 slots", () => {
    const r = createEmptyNflRoster();
    r.QB.playerName = "Tom Brady";
    r.TEAM_DEF = { slot: "TEAM_DEF", teamId: "BAL", teamName: "Baltimore Ravens", season: 2000 };
    const solo = decodeShareData(encodeNflSoloShareData(r, { wins: 15, losses: 1, ties: 1, playoffResult: "Champion" }));
    expect(solo?.sport).toBe("nfl");
    if (solo?.sport !== "nfl" || solo.mode !== "solo") throw new Error("wrong shape");
    expect(solo.data.rs).toHaveLength(8);
    expect(solo.data.rs[0]).toBe("Tom Brady");
    expect(solo.data.rs[7]).toBe("2000 Baltimore Ravens D");
    expect(solo.data.t).toBe(1);
    const h2h = decodeShareData(encodeNfl2PShareData(r, r, { team1Score: 27, team2Score: 24, winner: 1, overtime: true }));
    expect(h2h).toMatchObject({ mode: "2p", sport: "nfl", data: { s1: 27, s2: 24, ot: true } });
  });

  it("garbage decodes to null", () => {
    expect(decodeShareData("not-base64!!")).toBeNull();
  });
});
