import type { Config } from "tailwindcss";

/**
 * Site-wide type scale: Tailwind's default sizes × 1.125 (16px body → 18px), so every
 * heading/paragraph grows by the same ratio. Spacing and layout widths are unchanged.
 */
const TYPE_SCALE = 1.125;
const BASE_SIZES: Record<string, [number, number]> = {
  // name: [font-size rem, line-height rem] (Tailwind defaults)
  xs: [0.75, 1],
  sm: [0.875, 1.25],
  base: [1, 1.5],
  lg: [1.125, 1.75],
  xl: [1.25, 1.75],
  "2xl": [1.5, 2],
  "3xl": [1.875, 2.25],
  "4xl": [2.25, 2.5],
  "5xl": [3, 1],
  "6xl": [3.75, 1],
  "7xl": [4.5, 1],
};
const fontSize = Object.fromEntries(
  Object.entries(BASE_SIZES).map(([name, [size, lh]]) => [
    name,
    // 5xl+ use a unitless line-height of 1 in Tailwind; keep that.
    [`${+(size * TYPE_SCALE).toFixed(4)}rem`, { lineHeight: lh === 1 && size >= 3 ? "1" : `${+(lh * TYPE_SCALE).toFixed(4)}rem` }],
  ])
) as Record<string, [string, { lineHeight: string }]>;

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontSize,
      keyframes: {
        // Breathing halo behind the wheel's Spin button when it's the user's turn.
        "spin-glow": {
          "0%, 100%": {
            boxShadow: "0 0 0 0 rgba(251,146,60,0.55), 0 0 14px 4px rgba(251,146,60,0.45)",
          },
          "50%": {
            boxShadow: "0 0 0 9px rgba(251,146,60,0.28), 0 0 34px 14px rgba(251,146,60,0.75)",
          },
        },
      },
      animation: {
        "spin-glow": "spin-glow 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
