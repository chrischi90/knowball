"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSocket } from "@/lib/socket";
import { persistMultiplayerSession } from "@/lib/multiplayer-session";
import type { GameState } from "@/lib/game-types";

export default function LobbyPage() {
  const router = useRouter();
  const [gameCode, setGameCode] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [playerMode, setPlayerMode] = useState<"1p" | "2p">("1p");

  const handleCreate = () => {
    setError("");
    setCreating(true);
    const socket = getSocket();
    socket.emit("create_game", (res: { gameId?: string; game?: GameState; playerNumber?: number; reconnectToken?: string; error?: string }) => {
      setCreating(false);
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.gameId) {
        persistMultiplayerSession(res.gameId, {
          playerNumber: res.playerNumber ?? 1,
          reconnectToken: res.reconnectToken,
        });
        router.push(`/game/${res.gameId}`);
      }
    });
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const code = gameCode.trim().toUpperCase();
    if (!code) {
      setError("Enter a game code");
      return;
    }
    setJoining(true);
    const socket = getSocket();
    socket.emit("join_game", { gameId: code }, (res: { game?: GameState; playerNumber?: number; reconnectToken?: string; error?: string }) => {
      setJoining(false);
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.game) {
        persistMultiplayerSession(code, {
          playerNumber: res.playerNumber,
          reconnectToken: res.reconnectToken,
        });
        router.push(`/game/${code}`);
      }
    });
  };

  const subtitle =
    playerMode === "1p"
      ? "Spin the wheel. Build your dream roster. How dominant can you be?"
      : "Two players. Spin the wheel. Draft your roster. Simulate and win.";

  return (
    <main className="min-h-screen flex flex-col items-center justify-start pt-[12vh] pb-16 px-4 bg-black text-white">
      <img src="/KnowballHero.gif" alt="Knowball" className="w-64 mb-4" />
      <h1 className="font-funnel-display text-6xl font-bold mb-2">Knowball</h1>
      <p className="text-zinc-400 mb-8 text-center max-w-sm">
        {subtitle}
      </p>

      <div className="w-full max-w-xs space-y-6">
        {/* Mode toggles */}
        <div className="space-y-3">
          {/* Players toggle */}
          <div className="relative flex rounded-full border border-zinc-700 p-1">
            <div className={`pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-orange-600 transition-transform duration-200 ease-in-out${playerMode === "2p" ? " translate-x-full" : ""}`} />
            <button
              type="button"
              onClick={() => setPlayerMode("1p")}
              className={`relative z-10 flex-1 py-1.5 px-4 text-sm font-medium transition-colors duration-200 ${playerMode === "1p" ? "text-white" : "text-zinc-400"}`}
            >
              1 Player
            </button>
            <button
              type="button"
              onClick={() => setPlayerMode("2p")}
              className={`relative z-10 flex-1 py-1.5 px-4 text-sm font-medium transition-colors duration-200 ${playerMode === "2p" ? "text-white" : "text-zinc-400"}`}
            >
              2 Players
            </button>
          </div>

          {/* Sport toggle */}
          <div className="relative flex rounded-full border border-zinc-700 p-1">
            <div className="pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-orange-600" />
            <button
              type="button"
              className="relative z-10 flex-1 py-1.5 px-4 text-sm font-medium text-white"
            >
              Basketball
            </button>
            <button
              type="button"
              disabled
              title="Coming soon"
              className="relative z-10 flex-1 py-1.5 px-4 text-sm font-medium text-zinc-500 cursor-not-allowed"
            >
              Football
            </button>
          </div>
        </div>

        {playerMode === "1p" ? (
          <button
            type="button"
            onClick={() => router.push("/solo")}
            className="w-full py-3.5 px-6 rounded-lg bg-orange-600 hover:bg-orange-500 font-semibold text-lg transition"
          >
            Start Game
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="w-full py-3.5 px-6 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-50 font-semibold text-lg transition"
            >
              {creating ? "Creating…" : "Create Game"}
            </button>

            <div className="relative">
              <span className="block text-center text-zinc-500 text-sm">or</span>
            </div>

            <form onSubmit={handleJoin} className="space-y-3">
              <input
                type="text"
                value={gameCode}
                onChange={(e) => setGameCode(e.target.value.toUpperCase())}
                placeholder="Game code"
                maxLength={8}
                className="w-full py-2.5 px-4 rounded-lg bg-zinc-900 border border-zinc-700 text-center text-lg tracking-widest placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              <button
                type="submit"
                disabled={joining}
                className="w-full py-3.5 px-6 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 font-semibold transition"
              >
                {joining ? "Joining…" : "Join Game"}
              </button>
            </form>
          </>
        )}
      </div>

      {error && (
        <p className="mt-6 text-red-400 text-sm text-center max-w-xs">{error}</p>
      )}
    </main>
  );
}
