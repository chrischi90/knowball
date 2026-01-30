"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import type { NBATeam } from "@/lib/nba-api";

type WheelProps = {
  teams: NBATeam[];
  currentTeamId: string | null;
  isMyTurn: boolean;
  onSpin: (callback: (result: { teamIndex: number }) => void) => void;
};

const SEGMENT_DEG = 360 / 30;

export function Wheel({ teams, currentTeamId, isMyTurn, onSpin }: WheelProps) {
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [landedIndex, setLandedIndex] = useState<number | null>(null);
  const wheelRef = useRef<HTMLDivElement>(null);
  const prevTeamIdRef = useRef<string | null>(null);

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

  return (
    <div className="rounded-xl bg-slate-800 p-4">
      <p className="text-center text-slate-400 text-sm mb-4">
        {isMyTurn && !spinning
          ? "Your turn — spin the wheel!"
          : spinning
            ? "Spinning…"
            : "Waiting for your turn"}
      </p>
      <div className="relative mx-auto w-72 h-72">
        <div
          className="absolute inset-0 rounded-full border-4 border-orange-500 overflow-hidden"
          style={{ transform: "rotate(0deg)" }}
        >
          <div
            ref={wheelRef}
            className="absolute inset-0 rounded-full transition-none"
            style={{
              transform: `rotate(${rotation}deg)`,
              willChange: "transform",
            }}
          >
            {displayTeams.map((team, i) => (
              <div
                key={team.id}
                className="absolute left-1/2 top-0 w-1/2 h-full origin-left"
                style={{
                  transform: `rotate(${i * SEGMENT_DEG}deg)`,
                  background: `linear-gradient(to right, hsl(${220 + i * 2}, 60%, 35%), hsl(${220 + i * 2}, 50%, 25%))`,
                }}
              >
                <span
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-medium text-white whitespace-nowrap truncate max-w-[80%]"
                  style={{ transform: "rotate(90deg)", transformOrigin: "left center" }}
                >
                  {team.abbreviation}
                </span>
              </div>
            ))}
          </div>
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
