// Simulated chain time. Ergo targets one block every 120 s; every protocol window is counted in blocks.

/** Ergo block interval target. */
export const BLOCK_TIME_MS = 120_000;
/** basis.es: `enoughTimeSpent = (HEIGHT - trackerUpdateTime) > 3 * 720` (strictly greater). */
export const EMERGENCY_BLOCKS = 3 * 720;
/** basis.es: `refundPeriod = 43200` (≈ 60 days). */
export const REFUND_PERIOD_BLOCKS = 43_200;
/** basis.es action #1: `selfOut.value - SELF.value >= 100000000` (0.1 ERG). */
export const MIN_TOP_UP_NANOERG = 100_000_000n;
/** basis-token.es action #1: at least one token unit. */
export const MIN_TOP_UP_TOKEN_UNITS = 1n;
/** Tracker server `transaction.fee` default (0.001 ERG), paid from the tracker's own wallet inputs. */
export const MINER_FEE_NANOERG = 1_000_000n;
/** redemption_build.rs TOKEN_RECIPIENT_MIN_VALUE_NANOERG: ERG the tracker adds to a token redemption output. */
export const MIN_BOX_VALUE_NANOERG = 1_000_000n;
/** tracker_box_updater: one update attempt every 600 s (= 5 blocks). */
export const TRACKER_UPDATE_INTERVAL_MS = 600_000;
/** Tracker server: a commitment counts as confirmed at depth ≥ 2. */
export const MIN_CONFIRMATION_DEPTH = 2;
/** Tracker server: redemption builds per (issuer, recipient) pair per hour. */
export const REDEMPTION_BUILDS_PER_PAIR_PER_HOUR = 60;
/** Tracker box updater: pending update reverted after this many cycles without seeing it on chain. */
export const UPDATER_MISSING_CYCLES = 3;

/** 2026-01-01T00:00:00Z — sandbox genesis, fixed for determinism. */
export const DEFAULT_GENESIS_TIME_MS = 1_767_225_600_000n;
export const DEFAULT_GENESIS_HEIGHT = 1_600_000;

export interface ClockState {
  genesisHeight: number;
  genesisTimeMs: bigint;
  blockTimeMs: number;
  height: number;
  /** Last logical millisecond handed out (strictly increasing). */
  lastMs: bigint;
}

/**
 * Block clock with a logical millisecond counter: every `tick()` returns a fresh timestamp that is
 * strictly greater than the previous one and never earlier than the current block's time, so cumulative
 * notes always get increasing timestamps (the tracker rejects `timestamp <= existing`).
 */
export class BlockClock {
  readonly genesisHeight: number;
  readonly genesisTimeMs: bigint;
  readonly blockTimeMs: number;
  height: number;
  private lastMs: bigint;

  constructor(opts: Partial<Pick<ClockState, "genesisHeight" | "genesisTimeMs" | "blockTimeMs">> = {}) {
    this.genesisHeight = opts.genesisHeight ?? DEFAULT_GENESIS_HEIGHT;
    this.genesisTimeMs = opts.genesisTimeMs ?? DEFAULT_GENESIS_TIME_MS;
    this.blockTimeMs = opts.blockTimeMs ?? BLOCK_TIME_MS;
    this.height = this.genesisHeight;
    this.lastMs = this.genesisTimeMs;
  }

  /** Wall time at which block `h` was mined. */
  timeOfHeight(h: number): bigint {
    return this.genesisTimeMs + BigInt(h - this.genesisHeight) * BigInt(this.blockTimeMs);
  }

  /** Current logical time (ms): the block time or the last handed-out timestamp, whichever is later. */
  nowMs(): bigint {
    const t = this.timeOfHeight(this.height);
    return t > this.lastMs ? t : this.lastMs;
  }

  /** A fresh strictly increasing timestamp. */
  tick(): bigint {
    const t = this.nowMs();
    this.lastMs = t === this.lastMs ? t + 1n : t;
    return this.lastMs;
  }

  /** Keeps the counter ahead of an externally supplied timestamp (replays). */
  observe(ms: bigint): void {
    if (ms > this.lastMs) this.lastMs = ms;
  }

  setHeight(h: number): void {
    if (h < this.height) throw new RangeError("the chain does not go backwards");
    this.height = h;
  }

  snapshot(): ClockState {
    return { genesisHeight: this.genesisHeight, genesisTimeMs: this.genesisTimeMs, blockTimeMs: this.blockTimeMs, height: this.height, lastMs: this.lastMs };
  }

  static restore(s: ClockState): BlockClock {
    const c = new BlockClock(s);
    c.height = s.height;
    c.lastMs = s.lastMs;
    return c;
  }

  /** How many blocks a real-time animation step should mine at `speed` simulated seconds per real second. */
  static blocksForRealtime(dtRealMs: number, speed: number, carry = 0, blockTimeMs = BLOCK_TIME_MS): { blocks: number; carry: number } {
    const simMs = dtRealMs * speed + carry;
    const blocks = Math.floor(simMs / blockTimeMs);
    return { blocks, carry: simMs - blocks * blockTimeMs };
  }
}

/** "3 d 0 h", "4 min" — human duration of `blocks` blocks at 120 s. */
export function blocksToDuration(blocks: number, blockTimeMs = BLOCK_TIME_MS): string {
  const totalMin = Math.round((blocks * blockTimeMs) / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return h ? `${d} d ${h} h` : `${d} d`;
  if (h > 0) return m ? `${h} h ${m} min` : `${h} h`;
  return `${m} min`;
}
