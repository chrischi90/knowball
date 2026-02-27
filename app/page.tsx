"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSocket } from "@/lib/socket";
import type { GameState } from "@/lib/game-types";

export default function LobbyPage() {
  const router = useRouter();
  const [gameCode, setGameCode] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);

  const handleCreate = () => {
    setError("");
    setCreating(true);
    const socket = getSocket();
    socket.emit("create_game", (res: { gameId?: string; game?: GameState; error?: string }) => {
      setCreating(false);
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.gameId) router.push(`/game/${res.gameId}`);
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
    socket.emit("join_game", { gameId: code }, (res: { game?: GameState; playerNumber?: number; error?: string }) => {
      setJoining(false);
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.game) router.push(`/game/${code}`);
    });
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 bg-black text-white">
      <h1 className="text-3xl font-bold mb-2">NBA Roster Wheel</h1>
      <p className="text-slate-400 mb-8 text-center max-w-sm">
        Two players. Spin the wheel. Draft your roster. Simulate and win.
      </p>

      <div className="w-full max-w-xs space-y-6">
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="w-full py-4 px-6 rounded-xl bg-orange-600 hover:bg-orange-500 disabled:opacity-50 font-semibold text-lg transition"
        >
          {creating ? "Creating…" : "Create Game"}
        </button>

        <div className="relative">
          <span className="block text-center text-slate-500 text-sm">or</span>
        </div>

        <form onSubmit={handleJoin} className="space-y-3">
          <input
            type="text"
            value={gameCode}
            onChange={(e) => setGameCode(e.target.value.toUpperCase())}
            placeholder="Game code"
            maxLength={8}
            className="w-full py-3 px-4 rounded-xl bg-slate-800 border border-slate-600 text-center text-lg tracking-widest placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          <button
            type="submit"
            disabled={joining}
            className="w-full py-4 px-6 rounded-xl bg-slate-700 hover:bg-slate-600 disabled:opacity-50 font-semibold transition"
          >
            {joining ? "Joining…" : "Join Game"}
          </button>
        </form>
      </div>

      {error && (
        <p className="mt-6 text-red-400 text-sm text-center max-w-xs">{error}</p>
      )}
    </main>
  );
}
