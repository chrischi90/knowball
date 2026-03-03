"use client";

import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import type { NBATeam } from "@/lib/nba-api";

type WheelProps = {
  teams: NBATeam[];
  currentTeamId: string | null;
  isMyTurn: boolean;
  gameId: string;
  onSpin: (result: { teamIndex: number; teamId: string; teamName: string }) => void;
};

const SEGMENT_DEG = 360 / 30;

// NBA Official Team Colors (primary colors)
const NBA_TEAM_COLORS: Record<string, string> = {
  ATL: "#E03C3C", BOS: "#007A33", BKN: "#000000", CHA: "#00778D",
  CHI: "#CE1141", CLE: "#6F263D", DAL: "#002B80", DEN: "#0E2240",
  DET: "#0076B6", GSW: "#1D428A", HOU: "#CE1141", LAC: "#1D1160",
  LAL: "#552583", MEM: "#12173F", MIA: "#98002E", MIL: "#00471B",
  MIN: "#0C2340", NOP: "#0C2340", NYK: "#006BB6", OKC: "#007AC1",
  ORL: "#0077B6", PHI: "#1D1F2E", PHX: "#1D1D1D", POR: "#E03C3C",
  SAC: "#5A2D81", SAS: "#C4CED4", TOR: "#B4302B", UTA: "#F9423A",
  WAS: "#002B81", IND: "#002D62",
};

function getTeamColor(abbreviation: string): string {
  return NBA_TEAM_COLORS[abbreviation] || "#4B5563";
}

export function Wheel({ teams, currentTeamId, isMyTurn, gameId, onSpin }: WheelProps) {
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [landedIndex, setLandedIndex] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const wheelRef = useRef<HTMLDivElement>(null);
  const prevTeamIdRef = useRef<string | null>(null);
  
  // Memoize colors using official NBA team colors
  const colorMap = useMemo(() => {
    const map: Record<string, string> = {};
    teams.forEach((team) => {
      map[team.id] = getTeamColor(team.abbreviation);
    });
    return map;
  }, [teams.length, teams]);

  // Sync state when other player spins - just update the display
  useEffect(() => {
    if (!currentTeamId || teams.length === 0 || prevTeamIdRef.current === currentTeamId) return;
    prevTeamIdRef.current = currentTeamId;
    const idx = teams.findIndex((t) => t.id === currentTeamId);
    if (idx === -1) return;
    
    // Just update the landed index without animating (other player already animated)
    setLandedIndex(idx);
    setShowResult(true);
  }, [currentTeamId, teams]);

  const handleSpin = useCallback(() => {
    if (!isMyTurn || spinning || teams.length === 0) return;
    
    setSpinning(true);
    setLandedIndex(null);
    setShowResult(false);
    
    // Random spin - this determines the result
    const randomDegrees = Math.random() * 360;
    const extraRotations = 4 * 360;
    const totalRotation = extraRotations + randomDegrees;
    const duration = 4000;
    const start = performance.now();
    const startRotation = rotation;

    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const current = startRotation + totalRotation * easeOut;
      const displayRotation = current % 360;
      setRotation(displayRotation);
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setSpinning(false);
        
        // The arrow is at 0° (top). Find which segment is currently at that position.
        // When wheel rotates by displayRotation degrees, the segment that was originally
        // at angle (0 - displayRotation) is now at 0.
        // Normalize that original angle to [0, 360)
        const originalAngle = ((0 - displayRotation) % 360 + 360) % 360;
        
        // Segments start at -90°, so add 90° to shift to [0, 360) space
        // Segment i spans from (i * SEGMENT_DEG - 90) to ((i+1) * SEGMENT_DEG - 90)
        // In [0, 360) after adding 90: segment i spans from (i * SEGMENT_DEG) to ((i+1) * SEGMENT_DEG)
        const shiftedAngle = (originalAngle + 90) % 360;
        const segmentIndex = Math.floor(shiftedAngle / SEGMENT_DEG) % teams.length;
        const landedTeam = teams[segmentIndex];
        
        setLandedIndex(segmentIndex);
        setTimeout(() => setShowResult(true), 400);
        
        // Send the result to the server
        onSpin({
          teamIndex: segmentIndex,
          teamId: landedTeam.id,
          teamName: landedTeam.full_name
        });
      }
    };
    requestAnimationFrame(animate);
  }, [isMyTurn, spinning, teams, rotation, onSpin]);

  if (teams.length === 0) {
    return (
      <div className="rounded-lg bg-zinc-900 p-6 text-center text-zinc-400">
        Loading teams…
      </div>
    );
  }

  const displayTeams = teams.slice(0, 30);
  const wheelSize = 384;
  const radius = wheelSize / 2;
  const labelRadius = radius * 0.65; // Slightly smaller to avoid center button

  return (
    <div className="rounded-lg bg-zinc-900 p-4">
      <p className={`text-center mb-4 text-xl ${isMyTurn && !spinning ? "text-white font-bold" : "text-zinc-400 font-normal"}`}>
        {isMyTurn && !spinning
          ? "Your turn!"
          : spinning
            ? "Spinning…"
            : "Waiting for your turn..."}
      </p>
      <div className="relative mx-auto w-full max-w-xl aspect-square">
        <div
          className="absolute inset-0 rounded-full border-4 border-orange-500 overflow-hidden"
          style={{ transform: "rotate(0deg)" }}
        >
          <svg
            ref={wheelRef as any}
            viewBox={`0 0 ${wheelSize} ${wheelSize}`}
            className="absolute inset-0 w-full h-full transition-none"
            style={{
              transform: `rotate(${rotation}deg)`,
              willChange: "transform",
            }}
          >
            {displayTeams.map((team, i) => {
              const startAngle = (i * 360) / displayTeams.length - 90;
              const endAngle = ((i + 1) * 360) / displayTeams.length - 90;
              const startRad = (startAngle * Math.PI) / 180;
              const endRad = (endAngle * Math.PI) / 180;
              const x1 = radius + radius * Math.cos(startRad);
              const y1 = radius + radius * Math.sin(startRad);
              const x2 = radius + radius * Math.cos(endRad);
              const y2 = radius + radius * Math.sin(endRad);
              const largeArc = 360 / displayTeams.length > 180 ? 1 : 0;
              const pathData = `M ${radius} ${radius} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
              
              const midAngle = ((startAngle + endAngle) / 2 * Math.PI) / 180;
              const labelX = radius + labelRadius * Math.cos(midAngle);
              const labelY = radius + labelRadius * Math.sin(midAngle);
              
              return (
                <g key={team.id}>
                  <path
                    d={pathData}
                    fill={colorMap[team.id] || "#4B5563"}
                    stroke="rgba(255,255,255,0.1)"
                    strokeWidth="1"
                  />
                  <text
                    x={labelX}
                    y={labelY}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="white"
                    fontSize="13"
                    fontWeight="700"
                    pointerEvents="none"
                  >
                    {team.abbreviation}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        
        {/* Center Spin Button */}
        <button
          type="button"
          onClick={handleSpin}
          disabled={!isMyTurn || spinning}
          className="absolute inset-0 flex items-center justify-center z-10"
        >
          <div className="w-20 h-20 rounded-full bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg flex items-center justify-center font-semibold text-white text-sm transition touch-manipulation"
               style={{ pointerEvents: !isMyTurn || spinning ? "none" : "auto" }}>
            {spinning ? "Spinning…" : "Spin"}
          </div>
        </button>
        
        {/* Arrow Indicator at ~3:10 position (100 degrees) */}
        <div
          className="absolute w-0 h-0 border-l-[12px] border-r-[12px] border-b-[20px] border-l-transparent border-r-transparent border-b-orange-500 z-10"
          style={{
            top: "50%",
            right: "0px",
            transform: "translateY(-50%) rotate(-90deg)",
          }}
          aria-hidden
        />
      </div>
      
      {/* Landed Team Result */}
      {showResult && landedIndex !== null && (
        <p className="text-center mt-6 text-orange-400 font-bold text-lg">
          🎯 Landed on: {displayTeams[landedIndex]?.full_name}
        </p>
      )}
    </div>
  );
}
