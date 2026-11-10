"use client";

import type { TeamBox } from "@/lib/nfl-sim";

const n = (v: number) => v.toLocaleString("en-US");

/** One team's box score (a game or season totals). */
export function NflBoxScore({ box, perGame }: { box: TeamBox; perGame?: number }) {
  const rushers = box.rushing.filter((r) => r.att > 0).sort((a, b) => b.yds - a.yds);
  const receivers = box.receiving.filter((r) => r.tgt > 0).sort((a, b) => b.yds - a.yds);
  const p = box.passing;
  const d = box.defense;
  const pg = perGame && perGame > 0 ? perGame : null;
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="text-xs uppercase tracking-wider text-zinc-500 mb-1">Passing</p>
        <div className="flex flex-wrap justify-between gap-x-2">
          <span className="text-white">{p.name}</span>
          <span className="text-zinc-300 tabular-nums shrink-0">
            {p.cmp}/{p.att} · {n(p.yds)} yds · {p.td} TD · {p.int} INT
          </span>
        </div>
        {pg && <p className="text-xs text-zinc-500 text-right tabular-nums">{(p.yds / pg).toFixed(0)} yds/g · {((p.cmp / Math.max(1, p.att)) * 100).toFixed(1)}%</p>}
      </div>
      {rushers.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wider text-zinc-500 mb-1">Rushing</p>
          {rushers.map((r) => (
            <div key={r.name} className="flex flex-wrap justify-between gap-x-2">
              <span className="text-white">{r.name}</span>
              <span className="text-zinc-300 tabular-nums shrink-0">
                {r.att} car · {n(r.yds)} yds · {r.td} TD{r.long ? ` · long ${r.long}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
      {receivers.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wider text-zinc-500 mb-1">Receiving</p>
          {receivers.map((r) => (
            <div key={r.name} className="flex flex-wrap justify-between gap-x-2">
              <span className="text-white">{r.name}</span>
              <span className="text-zinc-300 tabular-nums shrink-0">
                {r.rec} rec · {n(r.yds)} yds · {r.td} TD{r.long ? ` · long ${r.long}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
      <div>
        <p className="text-xs uppercase tracking-wider text-zinc-500 mb-1">Defense</p>
        <div className="flex flex-wrap justify-between gap-x-2">
          <span className="text-white">{d.name}</span>
          <span className="text-zinc-300 tabular-nums shrink-0">
            {d.tackles} tkl · {d.sacks} sacks · {d.int} INT{d.td ? ` · ${d.td} TD` : ""}
          </span>
        </div>
        <p className="text-xs text-zinc-500 text-right tabular-nums">
          Team: {n(box.team.yards)} total yds · {box.team.sacks} sacks{pg ? ` · ${(box.team.yards / pg).toFixed(0)} yds/g` : ""}
        </p>
      </div>
    </div>
  );
}
