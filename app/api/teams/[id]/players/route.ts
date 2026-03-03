import { fetchTeamPlayers } from "@/lib/nba-api";
import { NextResponse } from "next/server";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Team ID required" }, { status: 400 });
  }
  const { searchParams } = new URL(req.url);
  const activeOnly = searchParams.get("active_only") === "true";
  try {
    const data = await fetchTeamPlayers(id, { activeOnly });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch players" },
      { status: 502 }
    );
  }
}
