import type { Metadata } from "next";
import Link from "next/link";
import { decodeShareData } from "@/lib/share-utils";
import { POSITIONS } from "@/lib/game-types";

const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ?? "https://knowball.onrender.com";

const POSITIONS_ARRAY = [...POSITIONS] as string[];

type Props = {
  searchParams: { mode?: string; d?: string };
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { mode, d } = searchParams;
  const ogImageUrl = `${BASE_URL}/api/og?mode=${mode ?? ""}&d=${d ?? ""}`;

  let title = "Knowball – NBA Draft Game";
  let description = "Can you beat my squad? Play Knowball!";

  if (d) {
    const parsed = decodeShareData(d);
    if (parsed?.mode === "solo") {
      const { w, l, r } = parsed.data;
      const result = r === "Champion" ? "NBA Champion" : r ?? "Missed Playoffs";
      title = `${w}–${l} | ${result} – Knowball`;
      description = `I drafted a squad and went ${w}–${l}. Can you beat it? Play Knowball!`;
    } else if (parsed?.mode === "2p") {
      const { s1, s2, winner } = parsed.data;
      const winText = winner === 1 ? "Player 1 Wins" : winner === 2 ? "Player 2 Wins" : "Tie Game";
      title = `${s1} vs ${s2} | ${winText} – Knowball`;
      description = `Player 1: ${s1} — Player 2: ${s2}. ${winText}! Play Knowball!`;
    }
  }

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: ogImageUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

export default function SharePage({ searchParams }: Props) {
  const { d } = searchParams;
  const parsed = d ? decodeShareData(d) : null;

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-5">
        {/* Brand */}
        <Link href="/" className="font-funnel-display text-orange-500 text-2xl font-bold text-center tracking-wide hover:text-orange-400 transition block">
          Knowball
        </Link>

        {parsed?.mode === "solo" && (
          <>
            <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-5 space-y-4">
              <div>
                <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                  Roster
                </p>
                <ul className="space-y-1 text-sm">
                  {POSITIONS_ARRAY.map((pos) => {
                    const name = parsed.data[pos.toLowerCase() as keyof typeof parsed.data] as string;
                    return (
                      <li key={pos} className="flex justify-between gap-2">
                        <span className="text-zinc-500 w-8">{pos}</span>
                        <span className="text-white">{name}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="text-center">
                <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
                  Regular Season
                </p>
                <div className="flex items-baseline justify-center gap-2">
                  <span className="text-4xl font-bold text-green-400">{parsed.data.w}</span>
                  <span className="text-2xl text-zinc-500">–</span>
                  <span className="text-4xl font-bold text-red-400">{parsed.data.l}</span>
                </div>
              </div>

              {parsed.data.r && (
                <div className="text-center">
                  <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
                    Postseason
                  </p>
                  <p className="font-semibold text-yellow-400">
                    {parsed.data.r === "Champion" ? "🏆 NBA Champion!" : parsed.data.r}
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {parsed?.mode === "2p" && (
          <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4 text-center">
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Player 1</p>
                <p className={`text-4xl font-bold ${parsed.data.winner === 1 ? "text-green-400" : parsed.data.winner === 2 ? "text-red-400" : "text-white"}`}>
                  {parsed.data.s1}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Player 2</p>
                <p className={`text-4xl font-bold ${parsed.data.winner === 2 ? "text-green-400" : parsed.data.winner === 1 ? "text-red-400" : "text-white"}`}>
                  {parsed.data.s2}
                </p>
              </div>
            </div>

            <p className="text-center font-semibold text-orange-400">
              {parsed.data.winner === 1 ? "Player 1 Wins!" : parsed.data.winner === 2 ? "Player 2 Wins!" : "Tie Game!"}
            </p>

            <div className="grid grid-cols-2 gap-4">
              {([parsed.data.p1, parsed.data.p2] as string[][]).map((players, idx) => (
                <div key={idx}>
                  <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                    Player {idx + 1} Roster
                  </p>
                  <ul className="space-y-1 text-sm">
                    {POSITIONS_ARRAY.map((pos, i) => (
                      <li key={pos} className="flex justify-between gap-1">
                        <span className="text-zinc-500 w-8">{pos}</span>
                        <span className="text-white text-xs">{players[i]}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        {!parsed && (
          <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-5 text-center">
            <p className="text-zinc-400 text-sm">Draft your squad and see how your season plays out.</p>
          </div>
        )}

        <Link
          href="/"
          className="block w-full py-3.5 rounded-lg bg-orange-600 hover:bg-orange-500 font-funnel-display font-semibold text-center transition"
        >
          Play Knowball
        </Link>
      </div>
    </main>
  );
}
