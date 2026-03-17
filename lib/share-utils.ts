import type { Roster } from "@/lib/game-types";
import { POSITIONS } from "@/lib/game-types";

const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ?? "https://knowball.onrender.com";

export type SoloShareData = {
  pg: string;
  sg: string;
  sf: string;
  pf: string;
  c: string;
  w: number;
  l: number;
  r: string | null; // playoff result
};

export type TwoPlayerShareData = {
  p1: string[]; // [PG, SG, SF, PF, C] names
  p2: string[];
  s1: number;
  s2: number;
  winner: 1 | 2 | null;
};

export type ShareData =
  | { mode: "solo"; data: SoloShareData }
  | { mode: "2p"; data: TwoPlayerShareData };

function encodeData(obj: unknown): string {
  return btoa(JSON.stringify(obj))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export function decodeShareData(d: string): ShareData | null {
  try {
    const base64 = d.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(atob(base64));
    if ("pg" in parsed) return { mode: "solo", data: parsed as SoloShareData };
    if ("p1" in parsed) return { mode: "2p", data: parsed as TwoPlayerShareData };
    return null;
  } catch {
    return null;
  }
}

export function encodeSoloShareData(
  roster: Roster,
  result: { wins: number; losses: number; playoffResult: string | null }
): string {
  const data: SoloShareData = {
    pg: roster.PG.playerName ?? "—",
    sg: roster.SG.playerName ?? "—",
    sf: roster.SF.playerName ?? "—",
    pf: roster.PF.playerName ?? "—",
    c: roster.C.playerName ?? "—",
    w: result.wins,
    l: result.losses,
    r: result.playoffResult,
  };
  return encodeData(data);
}

export function encode2PShareData(
  roster1: Record<string, { playerName: string | null }>,
  roster2: Record<string, { playerName: string | null }>,
  result: { team1Score: number; team2Score: number; winner: 1 | 2 | null }
): string {
  const data: TwoPlayerShareData = {
    p1: POSITIONS.map((pos) => roster1[pos]?.playerName ?? "—"),
    p2: POSITIONS.map((pos) => roster2[pos]?.playerName ?? "—"),
    s1: result.team1Score,
    s2: result.team2Score,
    winner: result.winner,
  };
  return encodeData(data);
}

export function buildShareUrl(mode: "solo" | "2p", encodedData: string): string {
  return `${BASE_URL}/share?mode=${mode}&d=${encodedData}`;
}
