import { fetchTeams } from "@/lib/nba-api";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const data = await fetchTeams();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch teams" },
      { status: 502 }
    );
  }
}
