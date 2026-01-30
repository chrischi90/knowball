"use client";

import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import type { NBATeam } from "@/lib/nba-api";

type WheelProps = {
  teams: NBATeam[];
  currentTeamId: string | null;
  isMyTurn: boolean;
  gameId: string;
  onSpin: (callback: (result: { teamIndex: number }) => void) => void;
};

const SEGMENT_DEG = 360 / 30;

// Seeded random number generator for stable colors
function seededRandom(seed: string, index: number): number {
  const str = seed + index.toString();
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash % 1000) / 1000;
}

function getRandomColor(gameId: string, teamIndex: number): string {
  const hue = seededRandom(gameId, teamIndex) * 360;
  return `hsl(${hue}, 70%, 40%)`;
}

export function Wheel({ teams, currentTeamId, isMyTurn, gameId, onSpin }: WheelProps) {
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [landedIndex, setLandedIndex] = useState<number | null>(null);
  const wheelRef = useRef<HTMLDivElement>(null);
  const prevTeamIdRef = useRef<string | null>(null);
  
  // Memoize stable colors per session
  const colorMap = useMemo(() => {
    const map: Record<string, string> = {};
    teams.forEach((team, idx) => {
      map[team.id] = getRandomColor(gameId, idx);
    });
    return map;
  }, [gameId, teams.length]);

  // When game state sets currentTeamId (e.g. other player sees the result), animate to it
  useEffect(() => {
    if (!currentTeamId || teams.length === 0 || prevTeamIdRef.current === currentTeamId) return;
    prevTeamIdRef.current = currentTeamId;
    const idx = teams.findIndex((t) => t.id === currentTeamId);
    if (idx === -1) return;
    setSpinning(true);
    const extraRotations = 4 * 360;
    const segmentCenter = idx * SEGMENT_DEG + SEGMENT_DEG / 2;
    const targetAngle = 360 - segmentCenter + extraRotations;
    const duration = 4000;
    const start = performance.now();
    const startRotation = rotation;

    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const current = startRotation + targetAngle * easeOut;
      setRotation(current % 360);
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setSpinning(false);
        setLandedIndex(idx);
      }
    };
    requestAnimationFrame(animate);
  }, [currentTeamId, teams]);

  const handleSpin = useCallback(() => {
    if (!isMyTurn || spinning || teams.length === 0) return;
    setSpinning(true);
    setLandedIndex(null);
    onSpin(({ teamIndex }) => {
      const extraRotations = 4 * 360;
      const segmentCenter = teamIndex * SEGMENT_DEG + SEGMENT_DEG / 2;
      const targetAngle = 360 - segmentCenter + extraRotations;
      const duration = 4000;
      const start = performance.now();
      const startRotation = rotation;

      const animate = (now: number) => {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const current = startRotation + targetAngle * easeOut;
        setRotation(current % 360);
        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          setSpinning(false);
          setLandedIndex(teamIndex);
        }
      };
      requestAnimationFrame(animate);
    });
  }, [isMyTurn, spinning, teams.length, onSpin, rotation]);

  if (teams.length === 0) {
    return (
      <div className="rounded-xl bg-slate-800 p-6 text-center text-slate-400">
        Loading teams…
      </div>
    );
  }

  const displayTeams = teams.slice(0, 30);
  const wheelSize = 384; // 96 * 4 for responsive sizing
  const radius = wheelSize / 2;

  return (
    <div className="rounded-xl bg-slate-800 p-4">
      <p className="text-center text-slate-400 text-sm mb-4">
        {isMyTurn && !spinning
          ? "Your turn — spin the wheel!"
          : spinning
            ? "Spinning…"
            : "Waiting for your turn"}
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
              const labelRadius = radius * 0.7;
              const labelX = radius + labelRadius * Math.cos(midAngle);
              const labelY = radius + labelRadius * Math.sin(midAngle);
              
              return (
                <g key={team.id}>
                  <path
                    d={pathData}
                    fill={colorMap[team.id] || "hsl(220, 70%, 40%)"}
                    stroke="rgba(255,255,255,0.1)"
                    strokeWidth="1"
                  />
                  <text
                    x={labelX}
                    y={labelY}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="white"
                    fontSize="12"
                    fontWeight="600"
                    pointerEvents="none"
                  >
                    {team.abbreviation}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <div
          className="absolute -top-2 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[12px] border-r-[12px] border-t-[20px] border-l-transparent border-r-transparent border-t-orange-500 z-10"
          aria-hidden
        />
      </div>
      <button
        type="button"
        onClick={handleSpin}
        disabled={!isMyTurn || spinning}
        className="w-full mt-4 py-4 rounded-xl bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed font-semibold text-lg transition touch-manipulation min-h-[48px]"
      >
        {spinning ? "Spinning…" : "Spin"}
      </button>
      {landedIndex !== null && currentTeamId && (
        <p className="text-center mt-3 text-orange-400 font-medium">
          Landed on: {displayTeams[landedIndex]?.full_name}
        </p>
      )}
    </div>
  );
}
