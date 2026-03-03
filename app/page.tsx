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
      <h1 className="font-funnel-display text-6xl font-bold mb-2">Knowball</h1>
      <p className="text-zinc-400 mb-8 text-center max-w-sm">
        Two players. Spin the wheel. Draft your roster. Simulate and win.
      </p>

      <div className="w-full max-w-xs space-y-6">
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="w-full py-3.5 px-6 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-50 font-semibold text-lg transition"
        >
          {creating ? "Creating…" : "Create Game"} hello
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
      </div>

      {error && (
        <p className="mt-6 text-red-400 text-sm text-center max-w-xs">{error}</p>
      )}
    </main>
  );
}
