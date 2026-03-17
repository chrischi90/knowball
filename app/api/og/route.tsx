import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { decodeShareData } from "@/lib/share-utils";

export const runtime = "edge";

const POSITIONS = ["PG", "SG", "SF", "PF", "C"] as const;

const BG = "#18181b";
const CARD = "#27272a";
const ORANGE = "#ea580c";
const GREEN = "#4ade80";
const RED = "#f87171";
const MUTED = "#71717a";
const WHITE = "#ffffff";

function playoffColor(r: string | null): string {
  if (!r) return MUTED;
  if (r === "Champion") return "#facc15";
  if (r === "NBA Finals") return "#fb923c";
  if (r.includes("Conference") || r.includes("Playoffs") || r === "First Round Exit") return GREEN;
  return MUTED;
}

function playoffLabel(r: string | null): string {
  if (!r) return "Missed Playoffs";
  if (r === "Champion") return "🏆 NBA Champion!";
  if (r === "NBA Finals") return "NBA Finals";
  return r;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const d = searchParams.get("d");
  const mode = searchParams.get("mode");

  if (!d || !mode) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "1200px",
            height: "630px",
            background: BG,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ color: ORANGE, fontSize: "48px", fontWeight: 700 }}>
            Knowball
          </span>
        </div>
      ),
      { width: 1200, height: 630 }
    );
  }

  const parsed = decodeShareData(d);

  if (!parsed) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "1200px",
            height: "630px",
            background: BG,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ color: ORANGE, fontSize: "48px", fontWeight: 700 }}>
            Knowball
          </span>
        </div>
      ),
      { width: 1200, height: 630 }
    );
  }

  if (parsed.mode === "solo") {
    const { pg, sg, sf, pf, c, w, l, r } = parsed.data;
    const players = [
      { pos: "PG", name: pg },
      { pos: "SG", name: sg },
      { pos: "SF", name: sf },
      { pos: "PF", name: pf },
      { pos: "C", name: c },
    ];

    return new ImageResponse(
      (
        <div
          style={{
            width: "1200px",
            height: "630px",
            background: BG,
            display: "flex",
            flexDirection: "column",
            padding: "56px 64px",
            fontFamily: "sans-serif",
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", marginBottom: "40px" }}>
            <span style={{ fontSize: "20px", marginRight: "12px" }}>🏀</span>
            <span style={{ color: ORANGE, fontSize: "28px", fontWeight: 700, letterSpacing: "0.05em" }}>
              KNOWBALL
            </span>
          </div>

          {/* Body: two columns */}
          <div style={{ display: "flex", gap: "48px", flex: 1 }}>
            {/* Left: Roster */}
            <div
              style={{
                background: CARD,
                borderRadius: "16px",
                padding: "32px",
                display: "flex",
                flexDirection: "column",
                flex: 1,
              }}
            >
              <span
                style={{
                  color: MUTED,
                  fontSize: "13px",
                  fontWeight: 600,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  marginBottom: "20px",
                }}
              >
                Your Roster
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {players.map(({ pos, name }) => (
                  <div key={pos} style={{ display: "flex", alignItems: "baseline", gap: "16px" }}>
                    <span style={{ color: MUTED, fontSize: "18px", fontWeight: 600, width: "44px" }}>
                      {pos}
                    </span>
                    <span style={{ color: WHITE, fontSize: "22px", fontWeight: 500 }}>{name}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Record + Result */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "24px",
                width: "340px",
              }}
            >
              {/* Record */}
              <div
                style={{
                  background: CARD,
                  borderRadius: "16px",
                  padding: "28px 32px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    color: MUTED,
                    fontSize: "13px",
                    fontWeight: 600,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    marginBottom: "12px",
                  }}
                >
                  Regular Season
                </span>
                <div style={{ display: "flex", alignItems: "baseline", gap: "12px" }}>
                  <span style={{ color: GREEN, fontSize: "64px", fontWeight: 700 }}>{w}</span>
                  <span style={{ color: MUTED, fontSize: "36px" }}>–</span>
                  <span style={{ color: RED, fontSize: "64px", fontWeight: 700 }}>{l}</span>
                </div>
              </div>

              {/* Playoff result */}
              <div
                style={{
                  background: CARD,
                  borderRadius: "16px",
                  padding: "28px 32px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: 1,
                }}
              >
                <span
                  style={{
                    color: MUTED,
                    fontSize: "13px",
                    fontWeight: 600,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    marginBottom: "12px",
                  }}
                >
                  Postseason
                </span>
                <span
                  style={{
                    color: playoffColor(r),
                    fontSize: "26px",
                    fontWeight: 700,
                    textAlign: "center",
                  }}
                >
                  {playoffLabel(r)}
                </span>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "24px" }}>
            <span style={{ color: MUTED, fontSize: "16px" }}>knowball.onrender.com</span>
          </div>
        </div>
      ),
      { width: 1200, height: 630 }
    );
  }

  // 2-player mode
  const { p1, p2, s1, s2, winner } = parsed.data;

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          background: BG,
          display: "flex",
          flexDirection: "column",
          padding: "48px 64px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", marginBottom: "32px" }}>
          <span style={{ fontSize: "20px", marginRight: "12px" }}>🏀</span>
          <span style={{ color: ORANGE, fontSize: "28px", fontWeight: 700, letterSpacing: "0.05em" }}>
            KNOWBALL
          </span>
          <span style={{ color: MUTED, fontSize: "18px", marginLeft: "16px" }}>2-Player Matchup</span>
        </div>

        {/* Scores row */}
        <div style={{ display: "flex", gap: "32px", marginBottom: "28px" }}>
          {[
            { label: "Player 1", score: s1, isWinner: winner === 1 },
            { label: "Player 2", score: s2, isWinner: winner === 2 },
          ].map(({ label, score, isWinner }) => (
            <div
              key={label}
              style={{
                flex: 1,
                background: CARD,
                borderRadius: "12px",
                padding: "16px 24px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                border: isWinner ? `2px solid ${GREEN}` : "2px solid transparent",
              }}
            >
              <span style={{ color: isWinner ? GREEN : MUTED, fontSize: "18px", fontWeight: 600 }}>
                {label} {isWinner ? "🏆" : ""}
              </span>
              <span
                style={{
                  color: isWinner ? GREEN : winner !== null ? RED : WHITE,
                  fontSize: "48px",
                  fontWeight: 700,
                }}
              >
                {score}
              </span>
            </div>
          ))}
        </div>

        {/* Rosters */}
        <div style={{ display: "flex", gap: "32px", flex: 1 }}>
          {[
            { label: "Player 1 Roster", names: p1 },
            { label: "Player 2 Roster", names: p2 },
          ].map(({ label, names }) => (
            <div
              key={label}
              style={{
                flex: 1,
                background: CARD,
                borderRadius: "12px",
                padding: "20px 24px",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <span
                style={{
                  color: MUTED,
                  fontSize: "12px",
                  fontWeight: 600,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  marginBottom: "12px",
                }}
              >
                {label}
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {POSITIONS.map((pos, i) => (
                  <div key={pos} style={{ display: "flex", alignItems: "baseline", gap: "12px" }}>
                    <span style={{ color: MUTED, fontSize: "15px", fontWeight: 600, width: "36px" }}>
                      {pos}
                    </span>
                    <span style={{ color: WHITE, fontSize: "18px" }}>{names[i] ?? "—"}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "20px" }}>
          <span style={{ color: MUTED, fontSize: "14px" }}>knowball.onrender.com</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
