/**
 * Seeded RNG so a simulated game can be replayed exactly (share links, server authority).
 * mulberry32: tiny, fast, good enough statistical quality for game simulation.
 */
export type Rng = {
  /** Uniform [0, 1). */
  next(): number;
  /** Standard normal (mean 0, sd 1). */
  normal(): number;
  /** Integer in [min, max]. */
  int(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Pick an index by (unnormalized, non-negative) weights. */
  weighted(weights: number[]): number;
};

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    normal() {
      // Box-Muller
      const u = Math.max(next(), 1e-12);
      const v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    chance(p) {
      return next() < p;
    },
    weighted(weights) {
      const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
      let r = next() * total;
      for (let i = 0; i < weights.length; i++) {
        r -= Math.max(0, weights[i]);
        if (r < 0) return i;
      }
      return weights.length - 1;
    },
  };
}

/** Random 32-bit seed (for callers that don't need replay). */
export function randomSeed(): number {
  return Math.floor(Math.random() * 4294967296) >>> 0;
}
