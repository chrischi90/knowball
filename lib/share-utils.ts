import type { Roster } from "@/lib/game-types";
import { POSITIONS } from "@/lib/game-types";

const PROD_BASE_URL = "https://knowball.gg";
const SHARE_BASE_URL = (
  process.env.NEXT_PUBLIC_SHARE_BASE_URL ?? PROD_BASE_URL
).replace(/\/$/, "");

function resolveBaseUrl(): string {
  return SHARE_BASE_URL;
}

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
  const json = JSON.stringify(obj);

  // Encode JSON as UTF-8 before base64 to support non-Latin1 characters.
  if (typeof Buffer !== "undefined") {
    return Buffer.from(json, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }

  const bytes = new TextEncoder().encode(json);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    let chunkBinary = "";
    for (let j = 0; j < chunk.length; j++) {
      chunkBinary += String.fromCharCode(chunk[j]);
    }
    binary += chunkBinary;
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function decodeData(d: string): unknown | null {
  try {
    const base64Url = d.replace(/-/g, "+").replace(/_/g, "/");
    const padding = (4 - (base64Url.length % 4)) % 4;
    const base64 = `${base64Url}${"=".repeat(padding)}`;

    if (typeof Buffer !== "undefined") {
      return JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
    }

    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function decodeShareData(d: string): ShareData | null {
  const parsed = decodeData(d);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  if ("pg" in parsed) return { mode: "solo", data: parsed as SoloShareData };
  if ("p1" in parsed) return { mode: "2p", data: parsed as TwoPlayerShareData };
  return null;
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
  return `${resolveBaseUrl()}/share?mode=${mode}&d=${encodedData}`;
}
