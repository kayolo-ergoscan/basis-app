// The home page's sandbox story: one tiny engine economy (Alice, Bob and the tracker T-01) built in the page.
// Every key, signature, digest, block and amount the hero and the five moments print comes from it: nothing is
// drawn from sample data. Play money on a simulated chain; the page labels it SANDBOX.
//
// The story: Alice locks a reserve, owes Bob 1 000.00, raises her note by 240.00 (she signs, T-01 witnesses), a
// block is mined and T-01 commits one digest. The moments can then check the note against that digest (a real
// AVL lookup proof), top up the reserve and let Bob redeem part of the note through the contract.
import {
  bytesToHex,
  debtKey,
  demoKeyPair,
  Economy,
  erg,
  hexToBytes,
  noteMessage,
  verify,
  type AvlBackend,
  type EconomyEvent,
  type NoteRecord,
  type TrackerSim,
} from "@/protocol";
import { SANDBOX_GENESIS_HEIGHT } from "@/world";

export const STORY_SEED = "basis-home/v1";
/** The economy's demo-key salt (Economy: `basis-sandbox-v1/${seed}`): lets the first paint know the pair key. */
const SALT = `basis-sandbox-v1/${STORY_SEED}`;
export const TRACKER_ID = "t-01";
export const TRACKER_NAME = "T-01";
const NANO = 1_000_000_000;

/**
 * The pair's numbers (ERG): the note's first total, the total the hero opens with, the raise, Bob's limit for
 * Alice, her reserve (132 % of 1 240.00), the redemption and the top-up.
 */
export const STORY = { start: 600, first: 1000, raise: 240, limit: 2000, reserve: 1636.8, redeem: 300, topUp: 100 } as const;

export const toErg = (nano: bigint): number => Number(nano) / NANO;

/** Keys without building the economy (two scalar multiplications): the first paint already has the real pair key. */
export function storyKeys(): { alicePub: string; bobPub: string; noteKey: string } {
  const alicePub = demoKeyPair("alice", SALT).pubHex;
  const bobPub = demoKeyPair("bob", SALT).pubHex;
  return { alicePub, bobPub, noteKey: bytesToHex(debtKey(alicePub, bobPub)) };
}

export interface VersionView {
  total: number;
  /** Issuer signature a(33) ‖ z(32), hex. */
  sigA: string;
  /** Tracker co-signature, hex (handed out at submit). */
  sigT: string | null;
  timestamp: string;
  /** The 80 signed bytes, hex. */
  message: string;
  issuerOk: boolean;
  trackerOk: boolean;
}

export interface BoxView {
  boxId: string;
  txId: string;
  height: number;
  digest: string;
  notes: number;
}

export interface ProofView {
  bytes: number;
  match: boolean;
  /** The total the proof reads from the committed tree (ERG). */
  total: number | null;
  verifier: "stateless" | "tree";
}

export interface RedeemView {
  ok: boolean;
  amount: number;
  txId: string | null;
  checks: number;
  passed: number;
  code: string | null;
  height: number;
}

export interface TapeItem {
  id: number;
  kind: "RESERVE" | "NOTE" | "WITNESS" | "COMMIT" | "CHECK" | "TOP UP" | "REDEEM";
  lamp: "signed" | "tracked" | "committed" | "live";
  /** Parts filled in by the strip (names, amounts); kept as data so the strip can translate. */
  data: Record<string, string | number>;
}

export interface StorySnap {
  alicePub: string;
  bobPub: string;
  trackerPub: string;
  nftId: string;
  noteKey: string;
  avl: { id: string; simulated: boolean; label: string };
  height: number;
  /** The three versions of the one note: 600.00, 1 000.00 and (after the raise) 1 240.00. */
  v0: VersionView | null;
  v1: VersionView | null;
  v2: VersionView | null;
  genesis: BoxView | null;
  commit: BoxView | null;
  confirmed: boolean;
  reserve: { boxId: string | null; collateral: number; coverage: number | null };
  /** Total redeemed against the note (ERG). */
  redeemed: number;
  lastRedeem: RedeemView | null;
  proof: ProofView | null;
  tape: TapeItem[];
}

function boxView(b: { boxId: string; txId: string; creationHeight: number; digest: string; notes: number } | undefined): BoxView | null {
  return b ? { boxId: b.boxId, txId: b.txId, height: b.creationHeight, digest: b.digest, notes: b.notes } : null;
}

/** One story economy. Methods run engine commands and return a fresh snapshot (plain data). */
export class Story {
  readonly eco: Economy;
  readonly backend: AvlBackend;
  private readonly tracker: TrackerSim;
  private v0: VersionView | null = null;
  private v1: VersionView | null = null;
  private v2: VersionView | null = null;
  private genesisBox: BoxView | null;
  private proof: ProofView | null = null;
  private lastRedeem: RedeemView | null = null;
  private tape: TapeItem[] = [];
  private seq = 0;

  constructor(backend: AvlBackend) {
    this.backend = backend;
    const eco = new Economy({ seed: STORY_SEED, genesisHeight: SANDBOX_GENESIS_HEIGHT, lazySignatures: false, avl: backend });
    eco.addParticipant({ id: "op", name: "T-01 operator", kind: "tracker-operator", erg: erg(5) });
    eco.addParticipant({ id: "alice", name: "Alice", kind: "human", erg: erg(2200) });
    eco.addParticipant({ id: "bob", name: "Bob", kind: "human", erg: erg(10) });
    this.tracker = eco.createTracker({ id: TRACKER_ID, name: TRACKER_NAME, operator: "op", options: { coSign: "on-submit" } });
    eco.setCreditLine("bob", "alice", erg(STORY.limit));
    this.eco = eco;
    this.genesisBox = boxView(this.tracker.currentBox());
    const res = eco.createReserve({ owner: "alice", amount: erg(String(STORY.reserve)), id: "alice-res" });
    if (!res.ok) throw new Error(`story: reserve refused (${res.code ?? "?"})`);
    this.push("RESERVE", "committed", { amount: STORY.reserve });
  }

  private push(kind: TapeItem["kind"], lamp: TapeItem["lamp"], data: TapeItem["data"]): void {
    this.tape = [{ id: ++this.seq, kind, lamp, data }, ...this.tape].slice(0, 12);
  }

  private record(): NoteRecord | undefined {
    return this.eco.note("alice", "bob");
  }

  private version(rec: NoteRecord): VersionView {
    const s = this.eco.signatures(rec);
    const message = noteMessage(hexToBytes(rec.key), s.version.totalDebt, s.version.timestamp, this.tracker.nftId);
    const sigT = s.trackerSig ? bytesToHex(s.trackerSig) : null;
    return {
      total: toErg(s.version.totalDebt),
      sigA: bytesToHex(s.issuerSig),
      sigT,
      timestamp: s.version.timestamp.toString(),
      message: bytesToHex(message),
      issuerOk: s.issuerSigOk,
      trackerOk: sigT ? verify(this.tracker.pub, message, sigT).ok : false,
    };
  }

  private pay(amount: number): VersionView {
    const r = this.eco.pay({ from: "alice", to: "bob", amount: erg(String(amount)) });
    if (!r.ok || !r.record) throw new Error(`story: payment refused (${r.code ?? "?"})`);
    return this.version(r.record);
  }

  /** Alice owes Bob 600.00, then 1 000.00 (each total signed and witnessed, not yet in a digest). */
  open(): StorySnap {
    if (!this.v1) {
      this.v0 = this.pay(STORY.start);
      this.push("NOTE", "tracked", { amount: STORY.start, delta: STORY.start });
      this.v1 = this.pay(STORY.first - STORY.start);
      this.push("NOTE", "tracked", { amount: STORY.first, delta: STORY.first - STORY.start });
    }
    return this.snap();
  }

  /** Alice raises her note by 240.00: she signs the new total and T-01 co-signs the same 80 bytes at submit. */
  raise(): StorySnap {
    this.open();
    if (!this.v2) {
      this.v2 = this.pay(STORY.raise);
      this.push("NOTE", "signed", { amount: this.v2.total, delta: STORY.raise });
      this.push("WITNESS", "tracked", { sig: this.v2.sigT ?? "" });
    }
    return this.snap();
  }

  /** Mines blocks until T-01 posts a box whose digest holds the latest total (its updater runs every 5 blocks). */
  commit(): StorySnap {
    this.raise();
    const target = this.record();
    for (let i = 0; i < 12 && !this.committedNow(target); i++) this.eco.mine(1);
    const box = this.tracker.currentBox();
    if (box && this.committedNow(target) && !this.tape.some((x) => x.kind === "COMMIT")) this.push("COMMIT", "committed", { digest: box.digest, notes: box.notes, height: box.creationHeight });
    return this.snap();
  }

  private committedNow(rec: NoteRecord | undefined): boolean {
    const box = this.tracker.currentBox();
    if (!box || !rec || !box.tree || box.digest === this.genesisBox?.digest) return false;
    const v = box.tree.get(hexToBytes(rec.key));
    return !!v && bytesToHex(v) === bytesToHex(u64(rec.totalDebt));
  }

  /** Depth 2 plus one updater cycle: the note becomes Confirmed and can be redeemed. */
  confirm(): StorySnap {
    this.commit();
    for (let i = 0; i < 12 && !this.tracker.isConfirmed(); i++) this.eco.mine(1);
    return this.snap();
  }

  /** Anyone can check the note against the committed digest: a lookup proof, verified without the tree. */
  check(): StorySnap {
    this.commit();
    const box = this.tracker.currentBox();
    const rec = this.record();
    if (box?.tree && rec) {
      const key = hexToBytes(rec.key);
      const proof = box.tree.proofFor(key);
      let value: Uint8Array | null | undefined;
      let verifier: ProofView["verifier"] = "tree";
      try {
        if (this.backend.verifier) {
          value = this.backend.verifier.lookup(hexToBytes(box.digest), key, proof);
          verifier = "stateless";
        } else value = box.tree.get(key) ?? null;
      } catch {
        value = undefined;
      }
      const total = value ? toErg(readU64(value)) : null;
      this.proof = { bytes: proof.length, match: value !== undefined && total === toErg(rec.totalDebt), total, verifier };
      this.push("CHECK", this.proof.match ? "committed" : "signed", { bytes: proof.length, match: this.proof.match ? 1 : 0 });
    }
    return this.snap();
  }

  /** Anyone can top up a reserve, at least 0.1 ERG, without a signature (here Alice adds to her own). */
  topUp(amount: number = STORY.topUp): StorySnap {
    const r = this.eco.topUp({ reserve: "alice-res", amount: erg(String(amount)), by: "alice" });
    if (r.ok) this.push("TOP UP", "committed", { amount });
    return this.snap();
  }

  /** Bob redeems part of the note from Alice's reserve: the contract checks both signatures and the digest. */
  redeem(amount: number = STORY.redeem): StorySnap {
    this.confirm();
    const r = this.eco.redeem({ receiver: "bob", issuer: "alice", amount: erg(String(amount)) });
    const checks = r.eval?.checks ?? [];
    this.lastRedeem = {
      ok: r.ok,
      amount: r.amount != null ? toErg(r.amount) : amount,
      txId: r.tx?.id ?? null,
      checks: checks.filter((c) => c.ok !== null).length,
      passed: checks.filter((c) => c.ok === true).length,
      code: r.ok ? null : r.code ?? "refused",
      height: this.eco.clock.height,
    };
    if (r.ok) this.push("REDEEM", "committed", { amount: this.lastRedeem.amount });
    return this.snap();
  }

  snap(): StorySnap {
    const rec = this.record();
    const box = this.tracker.currentBox();
    const committed = this.committedNow(rec);
    const cov = this.eco.coverage("alice", "erg");
    const res = this.eco.reserves.get("alice-res");
    const redeemed = rec ? toErg(rec.amountRedeemed) : 0;
    return {
      alicePub: this.eco.p("alice").pub,
      bobPub: this.eco.p("bob").pub,
      trackerPub: this.tracker.pub,
      nftId: this.tracker.nftId,
      noteKey: rec?.key ?? bytesToHex(debtKey(this.eco.p("alice").pub, this.eco.p("bob").pub)),
      avl: { id: this.backend.id, simulated: this.backend.simulated, label: this.backend.label },
      height: this.eco.clock.height,
      v0: this.v0,
      v1: this.v1,
      v2: this.v2,
      genesis: this.genesisBox,
      commit: committed ? boxView(box) : null,
      confirmed: committed && this.tracker.isConfirmed(box),
      reserve: { boxId: res?.box?.boxId ?? null, collateral: res ? toErg(res.collateral()) : 0, coverage: cov.ratio == null ? null : cov.ratio * 100 },
      redeemed,
      lastRedeem: this.lastRedeem,
      proof: this.proof,
      tape: this.tape,
    };
  }

  /** Engine events so far (for tests and the machine face). */
  get events(): readonly EconomyEvent[] {
    return this.eco.events;
  }
}

function u64(v: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let x = v;
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function readU64(b: Uint8Array): bigint {
  let v = 0n;
  for (let i = 0; i < 8 && i < b.length; i++) v = (v << 8n) | BigInt(b[i]);
  return v;
}
