import { fetchPlayerStats } from "@/lib/nba-api";
import { NextResponse } from "next/server";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Player ID required" }, { status: 400 });
  }
  const teamId = new URL(req.url).searchParams.get("team_id") ?? undefined;
  try {
    const data = await fetchPlayerStats(id, teamId);
    if (data === null) {
      return NextResponse.json({ error: "Player stats not found" }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch stats" },
      { status: 502 }
    );
  }
}
