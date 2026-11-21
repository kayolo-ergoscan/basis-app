// Seeded, deterministic pseudo-random numbers for scenarios and replays (sfc32 seeded through blake2b).
// Never used for key material or real nonces — signatures use deterministic RFC-6979-style nonces (schnorr.ts).

import { blake2b256, utf8 } from "./bytes";

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  readonly seed: string;

  constructor(seed: string | number = "basis") {
    this.seed = String(seed);
    const h = blake2b256(utf8("basis/rng/v1"), utf8(this.seed));
    const dv = new DataView(h.buffer, h.byteOffset, h.byteLength);
    this.a = dv.getUint32(0) | 0;
    this.b = dv.getUint32(4) | 0;
    this.c = dv.getUint32(8) | 0;
    this.d = dv.getUint32(12) | 0;
    for (let i = 0; i < 12; i++) this.nextU32();
  }

  /** Uniform 32-bit unsigned integer. */
  nextU32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** Integer in [lo, hi] (inclusive). */
  int(lo: number, hi: number): number {
    if (hi < lo) throw new RangeError("hi < lo");
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** BigInt in [lo, hi] (inclusive), for amounts. */
  bigint(lo: bigint, hi: bigint): bigint {
    if (hi < lo) throw new RangeError("hi < lo");
    const span = hi - lo + 1n;
    let x = 0n;
    for (let i = 0; i < 4; i++) x = (x << 32n) | BigInt(this.nextU32());
    return lo + (x % span);
  }

  bool(p = 0.5): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("pick from empty list");
    return items[Math.floor(this.next() * items.length)];
  }

  /** Index drawn with probability proportional to `weights`. */
  weighted(weights: readonly number[]): number {
    const total = weights.reduce((s, w) => s + w, 0);
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  /** Independent child stream; same parent seed + label → same child. */
  fork(label: string): Rng {
    return new Rng(`${this.seed}/${label}`);
  }
}
