"use client";

import { SeasonResult } from "@/components/SeasonResult";
import { useRouter } from "next/navigation";

const mockRoster = {
  PG: { position: "PG" as const, playerId: "201939", playerName: "Stephen Curry" },
  SG: { position: "SG" as const, playerId: "893", playerName: "Michael Jordan" },
  SF: { position: "SF" as const, playerId: "2544", playerName: "LeBron James" },
  PF: { position: "PF" as const, playerId: "1495", playerName: "Tim Duncan" },
  C:  { position: "C"  as const, playerId: "165",    playerName: "Hakeem Olajuwon" },
};

const mockResult = {
  wins: 72,
  losses: 10,
  teamPower: 185.5,
  madePlayoffs: true,
  playoffResult: "Champion",
  rounds: [
    { name: "First Round",            wins: 4, losses: 0 },
    { name: "Conference Semifinals",  wins: 4, losses: 1 },
    { name: "Conference Finals",      wins: 4, losses: 2 },
    { name: "NBA Finals",             wins: 4, losses: 3 },
  ],
  milestones: ["Dynasty-level team!", "NBA Champion!"],
};

export default function PreviewPage() {
  const router = useRouter();
  return (
    <SeasonResult
      result={mockResult}
      roster={mockRoster}
      onPlayAgain={() => router.push("/solo")}
    />
  );
}
