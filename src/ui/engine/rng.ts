// sfc32 seeded with the first 16 bytes of a seed (little-endian u32 a,b,c,d), warmed up 16 rounds (VISUAL §8.2).
// range(lo, hi), int(lo, hi) inclusive and pick(arr) each consume exactly one output.

export interface Rng {
  (): number;
  range(lo: number, hi: number): number;
  int(lo: number, hi: number): number;
  pick<T>(arr: readonly T[]): T;
}

export function rng(seed: Uint8Array): Rng {
  const u = (i: number) => ((seed[i] | (seed[i + 1] << 8) | (seed[i + 2] << 16) | (seed[i + 3] << 24)) >>> 0);
  let a = u(0), b = u(4), c = u(8), d = u(12);
  const next = (() => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0; d = (d + 1) | 0;
    a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  }) as Rng;
  for (let i = 0; i < 16; i++) next();
  next.range = (lo, hi) => lo + (hi - lo) * next();
  next.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * next());
  next.pick = <T,>(arr: readonly T[]) => arr[Math.floor(next() * arr.length)];
  return next;
}
