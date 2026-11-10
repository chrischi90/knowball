import { NextResponse } from "next/server";
import { NflServiceError } from "@/lib/nfl-api";

/** Shared response handling for /api/nfl/* routes: 404 passes through, other failures → 502. */
export async function proxyNfl<T>(load: () => Promise<T>, notFoundMessage: string) {
  try {
    return NextResponse.json(await load());
  } catch (e) {
    if (e instanceof NflServiceError && e.status === 404) {
      return NextResponse.json({ error: notFoundMessage }, { status: 404 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "NFL service unavailable" },
      { status: 502 }
    );
  }
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}
