// Where each engine check lives in the contract source. Derived from the source text by anchors (the `val` that
// decides a condition, the block of each action), so the mapping follows whichever copy of basis.es /
// basis-token.es is shown and survives reformatting. Pure; tested for completeness against every ReserveCheckId.

import type { ReserveCheckId } from "@/protocol";

/** 1-based inclusive line range. */
export type LineRange = readonly [number, number];
export type ActionId = 0 | 1 | 2 | 3;
export type ContractId = "basis" | "basis-token";

export interface CheckLines {
  /** The line where the condition is decided (lamp position). */
  anchor: number;
  ranges: LineRange[];
}

export interface ContractMap {
  contract: ContractId;
  lineCount: number;
  /** Reads every path needs: `val v = getVar…` up to the line before `if (action == 0)`. */
  prologue: LineRange;
  /** Shared preservation conditions (selfPreserved, and tokenIdsPreserved / ergPreserved in basis-token.es). */
  shared: LineRange[];
  actions: Record<ActionId, LineRange>;
  elseBranch: LineRange;
  /** The sigmaProp(...) that combines an action's conditions. */
  combine: Partial<Record<ActionId, LineRange>>;
  /** Per check; `byAction` overrides when a name is reused by several actions (refundPreserved, treePreserved, ownerSignature). */
  checks: Partial<Record<ReserveCheckId, CheckLines & { byAction?: Partial<Record<ActionId, CheckLines>> }>>;
}

const ALL_PROLOGUE: ReserveCheckId[] = ["actionVar", "outputExists", "ownerKey", "reserveTokens", "refundHeightRead"];

/** The checks the engine reports for an action, in contract order (what an idle X-ray shows). */
export function expectedChecks(contract: ContractId, action: ActionId | null): ReserveCheckId[] {
  const tok = contract === "basis-token";
  const prologue = ALL_PROLOGUE.filter((c) => tok || c !== "reserveTokens");
  const chain: ReserveCheckId[] = ["uniqueReserveInput", "scriptPreserved", ...(tok ? [] : (["tokensPreserved"] as ReserveCheckId[])), "ownerPreserved", "trackerNftPreserved", ...(tok ? (["tokenIdsPreserved"] as ReserveCheckId[]) : [])];
  switch (action) {
    case 0:
      return [...prologue, ...chain, ...(tok ? (["ergPreserved"] as ReserveCheckId[]) : []), "trackerIdCorrect", "trackerDebtCorrect", "timestampCorrect", "trackerSigValid", "properlyRedeemed", "properReserveSignature", "properRedemptionTree", "refundPreserved", "receiverSignature"];
    case 1:
      return [...prologue, ...chain, ...(tok ? (["ergPreserved"] as ReserveCheckId[]) : []), "treePreserved", "refundPreserved", "topUpAmount"];
    case 2:
      return [...prologue, ...chain, "valueNotDecreased", "treePreserved", "refundHeightValid", "refundNotStarted", "ownerSignature"];
    case 3:
      return [...prologue, "refundStarted", "refundPeriodOver", "ownerSignature"];
    default:
      return [...prologue, "invalidAction"];
  }
}

/** Every check id the engine can report (kept in sync with ReserveCheckId by the Record type below). */
const CHECK_ID_RECORD: Record<ReserveCheckId, true> = {
  actionVar: true, outputExists: true, ownerKey: true, reserveTokens: true, refundHeightRead: true,
  uniqueReserveInput: true, scriptPreserved: true, tokensPreserved: true, tokenIdsPreserved: true, ergPreserved: true, ownerPreserved: true, trackerNftPreserved: true,
  trackerIdCorrect: true, trackerDebtCorrect: true, timestampCorrect: true, properRedemptionTree: true, properReserveSignature: true, properlyRedeemed: true, trackerSigValid: true, refundPreserved: true, receiverSignature: true,
  treePreserved: true, topUpAmount: true,
  valueNotDecreased: true, refundHeightValid: true, refundNotStarted: true, ownerSignature: true,
  refundStarted: true, refundPeriodOver: true,
  invalidAction: true,
};
export const ALL_CHECK_IDS = Object.keys(CHECK_ID_RECORD) as ReserveCheckId[];

/** Which checks exist in a contract at all. */
export function checksOf(contract: ContractId): ReserveCheckId[] {
  return ALL_CHECK_IDS.filter((c) => (contract === "basis-token" ? c !== "tokensPreserved" : c !== "reserveTokens" && c !== "tokenIdsPreserved" && c !== "ergPreserved"));
}

class Finder {
  constructor(private readonly lines: readonly string[]) {}
  /** First 1-based line in [from, to] matching `re`; throws when absent (the source does not match the engine). */
  at(re: RegExp, from = 1, to = this.lines.length): number {
    for (let i = Math.max(1, from); i <= Math.min(this.lines.length, to); i++) if (re.test(this.lines[i - 1])) return i;
    throw new Error(`contract source: no line matches ${re} in ${from}–${to}`);
  }
  maybe(re: RegExp, from = 1, to = this.lines.length): number | null {
    try {
      return this.at(re, from, to);
    } catch {
      return null;
    }
  }
  /** Closing brace of a block opened at or after `from` (first line that is only "}" with the same or less indent). */
  close(from: number): number {
    const indent = (this.lines[from - 1].match(/^\s*/)?.[0].length ?? 0);
    for (let i = from + 1; i <= this.lines.length; i++) {
      const l = this.lines[i - 1];
      if (/^\s*\}\s*$/.test(l) && (l.match(/^\s*/)?.[0].length ?? 0) <= indent) return i;
    }
    return from;
  }
}

const one = (n: number): LineRange => [n, n];

export function deriveContractMap(lines: readonly string[], contract: ContractId): ContractMap {
  const f = new Finder(lines);
  const tok = contract === "basis-token";
  const n = lines.length;
  const vLine = f.at(/val v = getVar\[Byte\]\(0\)\.get/);
  const a0 = f.at(/if \(action == 0\)/, vLine);
  const a1 = f.at(/\} else if \(action == 1\)/, a0);
  const a2 = f.at(/\} else if \(action == 2\)/, a1);
  const a3 = f.at(/\} else if \(action == 3\)/, a2);
  const ae = f.at(/\} else \{/, a3);
  const aeEnd = f.close(ae);
  const actions: Record<ActionId, LineRange> = { 0: [a0, a1 - 1], 1: [a1, a2 - 1], 2: [a2, a3 - 1], 3: [a3, ae - 1] };

  const checks: ContractMap["checks"] = {};
  const put = (id: ReserveCheckId, anchor: number, ranges: LineRange[]) => {
    checks[id] = { anchor, ranges };
  };
  const putAction = (id: ReserveCheckId, action: ActionId, anchor: number, ranges: LineRange[]) => {
    const c = checks[id] ?? { anchor, ranges: [] as LineRange[] };
    c.byAction = { ...c.byAction, [action]: { anchor, ranges } };
    c.ranges = [...c.ranges, ...ranges];
    checks[id] = c;
  };

  // prologue
  put("actionVar", vLine, [[vLine, Math.min(vLine + 2, a0 - 1)]]);
  const ownerL = f.at(/val ownerKey = SELF\.R4\[GroupElement\]\.get/, vLine, a0);
  put("ownerKey", ownerL, [one(ownerL)]);
  const outL = f.at(/val selfOut = OUTPUTS\(index\)/, vLine, a0);
  put("outputExists", outL, [one(outL)]);
  const r7L = f.at(/val refundHeight = SELF\.R7\[Long\]\.getOrElse\(0L\)/, vLine, a0);
  const periodL = f.at(/val refundPeriod = 43200/, vLine, a0);
  put("refundHeightRead", r7L, [one(r7L)]);
  if (tok) {
    const t0 = f.at(/val tokenId0 = SELF\.tokens\(0\)\._1/, vLine, a0);
    put("reserveTokens", t0 + 1, [[t0, t0 + 1]]);
  }

  // shared preservation
  const u1 = f.at(/val uniqueReserveInput = /, vLine, a0);
  const u2 = f.at(/\}\)\.size == 1/, u1, a0);
  put("uniqueReserveInput", u2, [[u1, u2]]);
  const s1 = f.at(/val selfPreserved =/, vLine, a0);
  const s2 = f.at(/selfOut\.R6\[Coll\[Byte\]\]\.get == SELF\.R6\[Coll\[Byte\]\]\.get/, s1, a0);
  const shared: LineRange[] = [[u1, u2], [s1, s2]];
  const scriptL = f.at(/selfOut\.propositionBytes == SELF\.propositionBytes/, s1, s2);
  put("scriptPreserved", scriptL, [one(scriptL)]);
  if (!tok) {
    const tl = f.at(/selfOut\.tokens == SELF\.tokens/, s1, s2);
    put("tokensPreserved", tl, [one(tl)]);
  }
  const ownerPL = f.at(/selfOut\.R4\[GroupElement\]\.get == SELF\.R4\[GroupElement\]\.get/, s1, s2);
  put("ownerPreserved", ownerPL, [one(ownerPL)]);
  put("trackerNftPreserved", s2, [one(s2)]);
  if (tok) {
    const ti1 = f.at(/val tokenIdsPreserved =/, s2, a0);
    const ti2 = f.at(/selfOut\.tokens\(1\)\._1 == tokenId1/, ti1, a0);
    put("tokenIdsPreserved", ti1, [[ti1, ti2]]);
    shared.push([ti1, ti2]);
    const ep = f.at(/val ergPreserved = selfOut\.value >= SELF\.value/, ti2, a0);
    put("ergPreserved", ep, [one(ep)]);
    shared.push(one(ep));
  }

  // action 0: redeem
  const [b0, e0] = actions[0];
  const tr1 = f.at(/val tracker = CONTEXT\.dataInputs\(0\)/, b0, e0);
  const tr2 = f.at(/val trackerIdCorrect = /, tr1, e0);
  put("trackerIdCorrect", tr2, [[tr1, tr2]]);
  const rcv = f.at(/val receiver = getVar\[GroupElement\]\(1\)\.get/, b0, e0);
  const keyL = tok ? f.at(/val reserveKey = blake2b256\(/, rcv, e0) : f.at(/val key = blake2b256\(/, rcv, e0);
  const td1 = f.at(/val totalDebt = getVar\[Long\]\(3\)\.get/, keyL, e0);
  const td2 = f.at(/val trackerDebtCorrect = /, td1, e0);
  put("trackerDebtCorrect", td2, [[rcv, keyL], [td1, td2]]);
  const sigVar = f.at(/val reserveSigBytes = getVar\[Coll\[Byte\]\]\(2\)\.get/, td2, e0);
  const lk1 = f.at(/val lookupProofOpt = getVar\[Coll\[Byte\]\]\(7\)/, td2, e0);
  const ts2 = f.at(/val timestampCorrect = /, lk1, e0);
  put("timestampCorrect", ts2, [[lk1, ts2]]);
  const up1 = f.at(/val trackerUpdateTime = /, ts2, e0);
  const up2 = f.at(/val enoughTimeSpent = /, up1, e0);
  const msgL = f.at(/val message = /, up2, e0);
  const ts6 = f.at(/val trackerSigBytes = getVar\[Coll\[Byte\]\]\(6\)\.get/, msgL, e0);
  const tv1 = f.at(/val trackerSigValid = if/, ts6, e0);
  const tv2 = f.close(tv1);
  put("trackerSigValid", tv1, [[up1, up2], [ts6, tv2]]);
  const red1 = tok ? f.at(/val tokenAmountIn = SELF\.tokens\(1\)\._2/, tv2, e0) : f.at(/val redeemed = SELF\.value - selfOut\.value/, tv2, e0);
  const red2 = f.at(/val properlyRedeemed = /, red1, e0);
  put("properlyRedeemed", red2, [[red1, red2]]);
  const ra1 = f.at(/val reserveABytes = /, red2, e0);
  const ra2 = f.at(/val properReserveSignature = /, ra1, e0);
  put("properReserveSignature", ra2, [one(msgL), one(sigVar), [ra1, ra2]]);
  const nr1 = f.at(/val newRedeemed = /, ra2, e0);
  const nr2 = f.at(/val properRedemptionTree = /, nr1, e0);
  put("properRedemptionTree", nr2, [[nr1, nr2]]);
  const rp0 = f.at(/val refundPreserved = /, nr2, e0);
  putAction("refundPreserved", 0, rp0, [one(rp0)]);
  const rc = f.at(/val receiverCondition = proveDlog\(receiver\)/, rp0, e0);
  put("receiverSignature", rc, [one(rc)]);
  const c0a = f.at(/sigmaProp\(selfPreserved &&/, rc, e0);
  const c0b = f.at(/receiverCondition\)/, c0a, e0);

  // action 1: top up
  const [b1, e1] = actions[1];
  const tp = f.at(/selfOut\.R5\[AvlTree\]\.get == SELF\.R5\[AvlTree\]\.get/, b1, e1);
  putAction("treePreserved", 1, tp, [one(tp)]);
  const rp1 = f.at(/selfOut\.R7\[Long\]\.getOrElse\(0L\) == refundHeight/, b1, e1);
  putAction("refundPreserved", 1, rp1, [one(rp1)]);
  if (tok) {
    const ti = f.at(/val tokenAmountIn = SELF\.tokens\(1\)\._2/, b1, e1);
    const amt = f.at(/tokenAmountOut - tokenAmountIn >= 1/, ti, e1);
    put("topUpAmount", amt, [[ti, ti + 1], one(amt)]);
  } else {
    const amt = f.at(/selfOut\.value - SELF\.value >= 100000000/, b1, e1);
    put("topUpAmount", amt, [one(amt)]);
  }
  const c1a = f.at(/sigmaProp\(/, b1, e1);

  // action 2: initiate refund
  const [b2, e2] = actions[2];
  if (tok) {
    const v1 = f.at(/selfOut\.tokens\(1\)\._2 >= SELF\.tokens\(1\)\._2/, b2, e2);
    const v2 = f.at(/selfOut\.value >= SELF\.value/, v1, e2);
    put("valueNotDecreased", v2, [[v1, v2]]);
  } else {
    const v1 = f.at(/selfOut\.value >= SELF\.value/, b2, e2);
    put("valueNotDecreased", v1, [one(v1)]);
  }
  const tp2 = f.at(/selfOut\.R5\[AvlTree\]\.get == SELF\.R5\[AvlTree\]\.get/, b2, e2);
  putAction("treePreserved", 2, tp2, [one(tp2)]);
  const rhv = f.at(/selfOut\.R7\[Long\]\.get >= HEIGHT/, b2, e2);
  put("refundHeightValid", rhv, [one(rhv)]);
  const rns = f.at(/refundHeight == 0L/, b2, e2);
  put("refundNotStarted", rns, [one(rns)]);
  const os2 = f.at(/\) && proveDlog\(ownerKey\)/, b2, e2);
  putAction("ownerSignature", 2, os2, [one(os2)]);
  const c2a = f.at(/sigmaProp\(/, b2, e2);

  // action 3: complete refund
  const [b3, e3] = actions[3];
  const rs = f.at(/refundHeight > 0L/, b3, e3);
  put("refundStarted", rs, [one(rs)]);
  const rpo = f.at(/HEIGHT >= refundHeight \+ refundPeriod/, b3, e3);
  put("refundPeriodOver", rpo, [one(rpo), one(periodL)]);
  const os3 = f.at(/\) && proveDlog\(ownerKey\)/, b3, e3);
  putAction("ownerSignature", 3, os3, [one(os3)]);
  const c3a = f.at(/sigmaProp\(/, b3, e3);

  // else
  const fl = f.at(/sigmaProp\(false\)/, ae, aeEnd);
  put("invalidAction", fl, [one(fl)]);

  return {
    contract,
    lineCount: n,
    prologue: [vLine, a0 - 1],
    shared,
    actions,
    elseBranch: [ae, aeEnd],
    combine: { 0: [c0a, c0b], 1: [c1a, Math.max(c1a, e1)], 2: [c2a, os2], 3: [c3a, os3] },
    checks,
  };
}

/** Lines of a check for an action (falls back to the check's union of ranges). */
export function checkLinesFor(map: ContractMap, id: ReserveCheckId, action: ActionId | null): CheckLines | null {
  const c = map.checks[id];
  if (!c) return null;
  if (action !== null && c.byAction?.[action]) return c.byAction[action]!;
  return c;
}

/** Line ranges that compact mode shows for an action: prologue reads, shared conditions, the action branch. */
export function compactRanges(map: ContractMap, action: ActionId | null): LineRange[] {
  const out: LineRange[] = [map.prologue];
  if (action === null) return [...out, map.elseBranch];
  out.push(map.actions[action]);
  return mergeRanges(out);
}

export function mergeRanges(ranges: readonly LineRange[]): LineRange[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export function inRanges(line: number, ranges: readonly LineRange[]): boolean {
  for (const [a, b] of ranges) if (line >= a && line <= b) return true;
  return false;
}
