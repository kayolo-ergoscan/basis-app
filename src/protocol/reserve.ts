// Reserve boxes and an executable model of contract/basis.es (ERG) and contract/basis-token.es (token).
//
// `evaluateReserveSpend` runs the contract's logic over a simulated transaction and reports EVERY named
// condition (not just the verdict), distinguishing conditions that evaluate to `false` from expressions that
// THROW in the ErgoScript interpreter (`.get` on None, `insert` of a present key, a bad AVL proof, an
// undecodable point). Either way the spend is invalid.
//
// Action byte #0 = action * 10 + index of the reserve's own output:
//   0 redeem            (receiver signs; tracker signature or emergency; AVL proofs #5 #7 #8)
//   1 top up            (anyone; ≥ 0.1 ERG, or ≥ 1 token unit for basis-token.es)
//   2 initiate refund   (owner signs; R7 := h ≥ HEIGHT; one-shot)
//   3 complete refund   (owner signs; HEIGHT ≥ R7 + 43200; takes everything)
// There is NO redemption fee in either contract: the redeemed amount is exactly SELF − selfOut.
// The tracker server pays the miner fee from its own wallet inputs (and, for token redemptions, the
// 0.001 ERG that the receiver's token box needs).

import { blake2b256, bytesToHex, concatBytes, equalBytes, hexToBytes, I64_MAX, readI64BE, toBytes, u64be, utf8, type Hex } from "./bytes";
import { AvlOperationError, AvlProofError, type AuthenticatedMap, type AvlBackend, getAvlBackend } from "./avl";
import { EMERGENCY_BLOCKS, MIN_BOX_VALUE_NANOERG, MIN_TOP_UP_NANOERG, MIN_TOP_UP_TOKEN_UNITS, MINER_FEE_NANOERG, REFUND_PERIOD_BLOCKS } from "./clock";
import { debtKey as makeDebtKey, noteMessage, reserveKey as makeReserveKey, reserveTreeValue, type DenomId } from "./note";
import { basisAvlRegister, encodeCollByte, encodeGroupElement, encodeLong } from "./registers";
import { ContractThrow, contractSignatureHolds } from "./schnorr";

// ---------- boxes and transactions ----------

export type ScriptId = "basis.es" | "basis-token.es" | `p2pk:${string}` | "tracker" | "miner-fee" | "other";

export interface Token {
  tokenId: Hex;
  amount: bigint;
}

export type RegisterValue =
  | { type: "GroupElement"; value: Hex }
  | { type: "Coll[Byte]"; value: Hex }
  | { type: "Long"; value: bigint }
  | { type: "AvlTree"; digest: Hex; tree?: AuthenticatedMap };

export interface SimBox {
  boxId: Hex;
  /** Stand-in for propositionBytes: boxes with equal ids have equal scripts. */
  script: ScriptId;
  value: bigint;
  tokens: Token[];
  registers: Partial<Record<"R4" | "R5" | "R6" | "R7" | "R8" | "R9", RegisterValue>>;
  creationHeight: number;
}

export type ContextVar =
  | { type: "Byte"; value: number }
  | { type: "GroupElement"; value: Hex }
  | { type: "Coll[Byte]"; value: Hex }
  | { type: "Long"; value: bigint };

export interface SimTx {
  id: Hex;
  inputs: SimBox[];
  dataInputs: SimBox[];
  outputs: SimBox[];
  /** Context extension per input index. */
  contextVars: Record<number, Record<number, ContextVar>>;
  /** Public keys whose proveDlog the transaction satisfies (who signed it). */
  signers: Hex[];
  height: number;
}

// ---------- evaluation report ----------

export type ReserveCheckId =
  // shared
  | "actionVar"
  | "outputExists"
  | "ownerKey"
  | "reserveTokens"
  | "refundHeightRead"
  | "uniqueReserveInput"
  | "scriptPreserved"
  | "tokensPreserved"
  | "tokenIdsPreserved"
  | "ergPreserved"
  | "ownerPreserved"
  | "trackerNftPreserved"
  // redeem
  | "trackerIdCorrect"
  | "trackerDebtCorrect"
  | "timestampCorrect"
  | "properRedemptionTree"
  | "properReserveSignature"
  | "properlyRedeemed"
  | "trackerSigValid"
  | "refundPreserved"
  | "receiverSignature"
  // top up
  | "treePreserved"
  | "topUpAmount"
  // initiate refund
  | "valueNotDecreased"
  | "refundHeightValid"
  | "refundNotStarted"
  | "ownerSignature"
  // complete refund
  | "refundStarted"
  | "refundPeriodOver"
  // other
  | "invalidAction";

export interface ReserveCheck {
  id: ReserveCheckId;
  /** ErgoScript name / expression this check corresponds to. */
  expr: string;
  label: string;
  /** null = not evaluated (an earlier mandatory read threw, or not applicable). */
  ok: boolean | null;
  /** "throws": the expression raised an interpreter error (the tx is invalid regardless of the rest). */
  outcome: "true" | "false" | "throws" | "skipped";
  detail: string;
  /** Group in the contract: e.g. properlyRedeemed contains trackerSigValid. */
  group?: string;
}

export type ActionName = "redeem" | "top-up" | "initiate-refund" | "complete-refund" | "invalid";

export interface ReserveEval {
  ok: boolean;
  contract: "basis.es" | "basis-token.es";
  action: number | null;
  actionName: ActionName;
  outputIndex: number | null;
  checks: ReserveCheck[];
  /** Failed check ids in contract order (throws first, then false conditions). */
  failed: ReserveCheckId[];
  /** First failure, for a one-line explanation. */
  error?: { check: ReserveCheckId; outcome: "false" | "throws"; message: string };
  /** Redeem only. */
  emergency?: boolean;
  redeemed?: bigint;
  debtKey?: Hex;
  reserveKey?: Hex;
  message?: Hex;
  newRedeemedTotal?: bigint;
  /** "verified" = proofs checked against digests; "replayed" = backend has no verifier, box trees used directly. */
  proofMode?: "verified" | "replayed";
}

const ACTION_NAMES: Record<number, ActionName> = { 0: "redeem", 1: "top-up", 2: "initiate-refund", 3: "complete-refund" };

class Thrown extends Error {}

/** Throwing register read, like `box.R4[GroupElement].get`. */
function reg<T extends RegisterValue["type"]>(box: SimBox, r: keyof SimBox["registers"], type: T): Extract<RegisterValue, { type: T }> {
  const v = box.registers[r];
  if (!v) throw new Thrown(`${r} is empty (.get on None)`);
  if (v.type !== type) throw new Thrown(`${r} holds ${v.type}, expected ${type}`);
  return v as Extract<RegisterValue, { type: T }>;
}

function regOpt<T extends RegisterValue["type"]>(box: SimBox, r: keyof SimBox["registers"], type: T): Extract<RegisterValue, { type: T }> | undefined {
  const v = box.registers[r];
  if (!v) return undefined;
  if (v.type !== type) throw new Thrown(`${r} holds ${v.type}, expected ${type}`);
  return v as Extract<RegisterValue, { type: T }>;
}

function cvar<T extends ContextVar["type"]>(vars: Record<number, ContextVar>, id: number, type: T): Extract<ContextVar, { type: T }> {
  const v = vars[id];
  if (!v) throw new Thrown(`getVar[${type}](${id}) is empty (.get on None)`);
  if (v.type !== type) throw new Thrown(`context var #${id} holds ${v.type}, expected ${type}`);
  return v as Extract<ContextVar, { type: T }>;
}

function cvarOpt<T extends ContextVar["type"]>(vars: Record<number, ContextVar>, id: number, type: T): Extract<ContextVar, { type: T }> | undefined {
  const v = vars[id];
  if (!v) return undefined;
  if (v.type !== type) throw new Thrown(`context var #${id} holds ${v.type}, expected ${type}`);
  return v as Extract<ContextVar, { type: T }>;
}

function tokensEqual(a: Token[], b: Token[]): boolean {
  return a.length === b.length && a.every((t, i) => t.tokenId === b[i].tokenId && t.amount === b[i].amount);
}

function treeDigest(r: Extract<RegisterValue, { type: "AvlTree" }>): Uint8Array {
  return hexToBytes(r.digest);
}

interface Recorder {
  checks: ReserveCheck[];
  add(id: ReserveCheckId, expr: string, label: string, fn: () => { ok: boolean; detail: string }, group?: string): boolean | null;
  skip(id: ReserveCheckId, expr: string, label: string, detail: string, group?: string): void;
}

function recorder(): Recorder {
  const checks: ReserveCheck[] = [];
  return {
    checks,
    add(id, expr, label, fn, group) {
      try {
        const r = fn();
        checks.push({ id, expr, label, ok: r.ok, outcome: r.ok ? "true" : "false", detail: r.detail, group });
        return r.ok;
      } catch (e) {
        const msg = e instanceof Thrown || e instanceof ContractThrow || e instanceof AvlProofError || e instanceof AvlOperationError ? e.message : `unexpected: ${(e as Error).message}`;
        checks.push({ id, expr, label, ok: false, outcome: "throws", detail: msg, group });
        return null;
      }
    },
    skip(id, expr, label, detail, group) {
      checks.push({ id, expr, label, ok: null, outcome: "skipped", detail, group });
    },
  };
}

function finish(base: Omit<ReserveEval, "ok" | "failed" | "error" | "checks">, rec: Recorder): ReserveEval {
  const checks = rec.checks;
  const throws = checks.filter((c) => c.outcome === "throws");
  const falses = checks.filter((c) => c.outcome === "false");
  const failed = [...throws, ...falses].map((c) => c.id);
  const first = throws[0] ?? falses[0];
  return {
    ...base,
    ok: failed.length === 0 && checks.length > 0,
    checks,
    failed,
    error: first ? { check: first.id, outcome: first.outcome as "false" | "throws", message: `${first.label}: ${first.detail}` } : undefined,
  };
}

export interface EvalOptions {
  /** AVL backend whose verifier checks proofs; without a verifier the box's own tree is replayed. */
  avl?: AvlBackend;
}

/**
 * Evaluates the reserve script guarding `tx.inputs[inputIndex]` (basis.es or basis-token.es).
 * Mirrors the contract expression by expression, in contract order.
 */
export function evaluateReserveSpend(tx: SimTx, inputIndex: number, opts: EvalOptions = {}): ReserveEval {
  const SELF = tx.inputs[inputIndex];
  const isToken = SELF.script === "basis-token.es";
  const contract = isToken ? "basis-token.es" : "basis.es";
  const vars = tx.contextVars[inputIndex] ?? {};
  const rec = recorder();
  const verifier = (opts.avl ?? getAvlBackend()).verifier;
  const HEIGHT = tx.height;

  // ---- prologue: reads every path needs (a throw here invalidates the spend) ----
  let v = 0;
  const okV = rec.add("actionVar", "getVar[Byte](0).get", "action byte #0", () => {
    v = cvar(vars, 0, "Byte").value;
    return { ok: true, detail: `#0 = ${v} → action ${Math.trunc(v / 10)}, output ${v % 10}` };
  });
  if (okV === null) return finish({ contract, action: null, actionName: "invalid", outputIndex: null }, rec);
  const action = Math.trunc(v / 10);
  const index = v % 10;
  let selfOut!: SimBox;
  const okOut = rec.add("outputExists", "OUTPUTS(index)", "reserve output exists", () => {
    if (index < 0 || index >= tx.outputs.length) throw new Thrown(`OUTPUTS(${index}) is out of bounds (${tx.outputs.length} outputs)`);
    selfOut = tx.outputs[index];
    return { ok: true, detail: `output #${index}` };
  });
  let ownerKey = "";
  const okOwner = rec.add("ownerKey", "SELF.R4[GroupElement].get", "owner key in R4", () => {
    ownerKey = reg(SELF, "R4", "GroupElement").value;
    return { ok: true, detail: ownerKey };
  });
  let tokenId0 = "";
  let tokenId1 = "";
  if (isToken) {
    rec.add("reserveTokens", "SELF.tokens(0)._1, SELF.tokens(1)._1", "reserve NFT + reserve token present", () => {
      if (SELF.tokens.length < 2) throw new Thrown(`SELF.tokens(1) out of bounds (${SELF.tokens.length} token(s))`);
      tokenId0 = SELF.tokens[0].tokenId;
      tokenId1 = SELF.tokens[1].tokenId;
      return { ok: true, detail: `NFT ${tokenId0.slice(0, 8)}…, token ${tokenId1.slice(0, 8)}…` };
    });
  }
  // refundHeight = SELF.R7[Long].getOrElse(0L) is used by every branch, so it is evaluated up front.
  // A register of another type makes getReg throw (InvalidType): such a box can never be spent.
  let refundHeight = 0n;
  rec.add("refundHeightRead", "SELF.R7[Long].getOrElse(0L)", "refund height (R7) readable", () => {
    refundHeight = regOpt(SELF, "R7", "Long")?.value ?? 0n;
    return { ok: true, detail: refundHeight > 0n ? `R7 = ${refundHeight}: refund pending` : SELF.registers.R7 ? `R7 = ${refundHeight}` : "R7 absent → 0" };
  });
  const base = { contract, action, actionName: ACTION_NAMES[action] ?? "invalid", outputIndex: index } as const;
  if (okOut === null || okOwner === null || rec.checks.some((c) => c.outcome === "throws")) return finish(base, rec);

  // ---- common preservation checks (selfPreserved is a lazy && chain: stop at the first false) ----
  const preservation = (r: Recorder = rec) => {
    const chain: Array<[ReserveCheckId, string, string, () => { ok: boolean; detail: string }]> = [
      [
        "uniqueReserveInput",
        "INPUTS.filter(same script && R4 == ownerKey).size == 1",
        "only one reserve of this owner in the transaction",
        () => {
          let n = 0;
          for (const i of tx.inputs) {
            if (i.script !== SELF.script) continue; // propositionBytes differ: && stops here
            const r4 = i.registers.R4;
            if (!r4) continue; // in.R4[GroupElement].isDefined == false
            if (r4.type !== "GroupElement") throw new Thrown(`an input with the reserve script holds ${r4.type} in R4: in.R4[GroupElement] throws`);
            if (r4.value === ownerKey) n++;
          }
          return { ok: n === 1, detail: `${n} matching input(s)` };
        },
      ],
      ["scriptPreserved", "selfOut.propositionBytes == SELF.propositionBytes", "output keeps the reserve script", () => ({ ok: selfOut.script === SELF.script, detail: `${selfOut.script}` })],
    ];
    if (!isToken) chain.push(["tokensPreserved", "selfOut.tokens == SELF.tokens", "tokens unchanged", () => ({ ok: tokensEqual(selfOut.tokens, SELF.tokens), detail: `${selfOut.tokens.length} vs ${SELF.tokens.length} token(s)` })]);
    chain.push(["ownerPreserved", "selfOut.R4[GroupElement].get == SELF.R4[GroupElement].get", "owner key unchanged", () => ({ ok: reg(selfOut, "R4", "GroupElement").value === ownerKey, detail: "R4" })]);
    chain.push([
      "trackerNftPreserved",
      "selfOut.R6[Coll[Byte]].get == SELF.R6[Coll[Byte]].get",
      "tracker binding unchanged",
      () => ({ ok: reg(selfOut, "R6", "Coll[Byte]").value === reg(SELF, "R6", "Coll[Byte]").value, detail: "R6" }),
    ]);
    let stopped = false;
    for (const [id, expr, label, fn] of chain) {
      if (stopped) {
        r.skip(id, expr, label, "not evaluated: an earlier selfPreserved condition is false (&& short-circuits)", "selfPreserved");
        continue;
      }
      const ok = r.add(id, expr, label, fn, "selfPreserved");
      if (ok !== true) stopped = true;
    }
    if (isToken) {
      r.add("tokenIdsPreserved", "selfOut.tokens.size == 2 && ids at 0,1 equal && tokens(0) amount equal", "reserve NFT kept, token id kept", () => {
        const t = selfOut.tokens;
        const ok = t.length === 2 && t[0].tokenId === tokenId0 && t[0].amount === SELF.tokens[0].amount && t[1].tokenId === tokenId1;
        return { ok, detail: `${t.length} token(s) in output` };
      });
    }
  };

  if (action === 0) {
    preservation();
    if (isToken) rec.add("ergPreserved", "selfOut.value >= SELF.value", "ERG not taken out", () => ({ ok: selfOut.value >= SELF.value, detail: `${selfOut.value} ≥ ${SELF.value}` }));
    const result = evaluateRedeem(tx, SELF, selfOut, vars, ownerKey, isToken ? tokenId1 : null, refundHeight, HEIGHT, verifier, rec);
    return finish({ ...base, ...result }, rec);
  }
  if (action === 1) {
    preservation();
    if (isToken) rec.add("ergPreserved", "selfOut.value >= SELF.value", "ERG not taken out", () => ({ ok: selfOut.value >= SELF.value, detail: `${selfOut.value} ≥ ${SELF.value}` }));
    rec.add("treePreserved", "selfOut.R5[AvlTree].get == SELF.R5[AvlTree].get", "redemption tree unchanged", () => ({ ok: reg(selfOut, "R5", "AvlTree").digest === reg(SELF, "R5", "AvlTree").digest, detail: "R5" }));
    rec.add("refundPreserved", "selfOut.R7[Long].getOrElse(0L) == refundHeight", "refund flag unchanged", () => {
      const out = regOpt(selfOut, "R7", "Long")?.value ?? 0n;
      return { ok: out === refundHeight, detail: `${out} vs ${refundHeight}` };
    });
    if (isToken) {
      rec.add("topUpAmount", "selfOut.tokens(1)._2 - SELF.tokens(1)._2 >= 1", "at least 1 token unit added", () => {
        if (selfOut.tokens.length < 2) throw new Thrown("selfOut.tokens(1) out of bounds");
        const d = selfOut.tokens[1].amount - SELF.tokens[1].amount;
        return { ok: d >= MIN_TOP_UP_TOKEN_UNITS, detail: `+${d} unit(s)` };
      });
    } else {
      rec.add("topUpAmount", "selfOut.value - SELF.value >= 100000000", "at least 0.1 ERG added", () => {
        const d = selfOut.value - SELF.value;
        return { ok: d >= MIN_TOP_UP_NANOERG, detail: `+${d} nanoERG` };
      });
    }
    return finish(base, rec);
  }
  if (action === 2) {
    preservation();
    if (isToken) {
      rec.add("valueNotDecreased", "selfOut.tokens(1)._2 >= SELF.tokens(1)._2 && selfOut.value >= SELF.value", "nothing withdrawn", () => {
        if (selfOut.tokens.length < 2) throw new Thrown("selfOut.tokens(1) out of bounds");
        const ok = selfOut.tokens[1].amount >= SELF.tokens[1].amount && selfOut.value >= SELF.value;
        return { ok, detail: `tokens ${selfOut.tokens[1].amount} ≥ ${SELF.tokens[1].amount}, ERG ${selfOut.value} ≥ ${SELF.value}` };
      });
    } else {
      rec.add("valueNotDecreased", "selfOut.value >= SELF.value", "nothing withdrawn", () => ({ ok: selfOut.value >= SELF.value, detail: `${selfOut.value} ≥ ${SELF.value}` }));
    }
    rec.add("treePreserved", "selfOut.R5[AvlTree].get == SELF.R5[AvlTree].get", "redemption tree unchanged", () => ({ ok: reg(selfOut, "R5", "AvlTree").digest === reg(SELF, "R5", "AvlTree").digest, detail: "R5" }));
    rec.add("refundHeightValid", "selfOut.R7[Long].get >= HEIGHT", "refund height not backdated", () => {
      const r7 = reg(selfOut, "R7", "Long").value;
      return { ok: r7 >= BigInt(HEIGHT), detail: `R7 = ${r7}, HEIGHT = ${HEIGHT}` };
    });
    rec.add("refundNotStarted", "refundHeight == 0L", "no refund pending yet (one-shot)", () => ({ ok: refundHeight === 0n, detail: `current R7 = ${refundHeight}` }));
    rec.add("ownerSignature", "proveDlog(ownerKey)", "owner signs", () => ({ ok: tx.signers.includes(ownerKey), detail: tx.signers.includes(ownerKey) ? "signed by the owner" : "owner signature missing" }));
    return finish(base, rec);
  }
  if (action === 3) {
    // selfPreserved is used by three branches, so it is a ValDef evaluated before `if (action == …)` even here.
    // Its value is ignored by action 3, but a throw inside it (e.g. OUTPUTS(index) keeps the reserve script and
    // tokens but has no R4) still invalidates the spend: keep only the throws of a dry run.
    const probe = recorder();
    preservation(probe);
    for (const c of probe.checks) if (c.outcome === "throws") rec.checks.push({ ...c, detail: `${c.detail} (selfPreserved is evaluated before the action branch)` });
    rec.add("refundStarted", "refundHeight > 0L", "refund was initiated", () => ({ ok: refundHeight > 0n, detail: `R7 = ${refundHeight}` }));
    rec.add("refundPeriodOver", "HEIGHT >= refundHeight + refundPeriod", "43 200 blocks have passed", () => {
      const unlock = refundHeight + BigInt(REFUND_PERIOD_BLOCKS);
      // Long arithmetic is exact in ErgoScript: R7 + 43200 beyond Long.MaxValue throws instead of wrapping
      if (refundHeight > 0n && unlock > I64_MAX) throw new Thrown(`refundHeight + refundPeriod overflows Long (R7 = ${refundHeight})`);
      return { ok: BigInt(HEIGHT) >= unlock, detail: `HEIGHT ${HEIGHT} vs ${unlock}` };
    });
    rec.add("ownerSignature", "proveDlog(ownerKey)", "owner signs", () => ({ ok: tx.signers.includes(ownerKey), detail: tx.signers.includes(ownerKey) ? "signed by the owner" : "owner signature missing" }));
    return finish(base, rec);
  }
  rec.add("invalidAction", "sigmaProp(false)", "unknown action", () => ({ ok: false, detail: `action ${action}` }));
  return finish(base, rec);
}

function evaluateRedeem(
  tx: SimTx,
  SELF: SimBox,
  selfOut: SimBox,
  vars: Record<number, ContextVar>,
  ownerKey: Hex,
  tokenId1: Hex | null,
  refundHeight: bigint,
  HEIGHT: number,
  verifier: AvlBackend["verifier"],
  rec: Recorder,
): Partial<ReserveEval> {
  const out: Partial<ReserveEval> = { proofMode: verifier ? "verified" : "replayed" };
  // tracker data input
  let tracker: SimBox | undefined = tx.dataInputs[0];
  const trackerOk = rec.add("trackerIdCorrect", "CONTEXT.dataInputs(0).tokens(0)._1 == SELF.R6[Coll[Byte]].get", "data input is the bound tracker", () => {
    if (!tracker) throw new Thrown("CONTEXT.dataInputs(0) out of bounds");
    if (tracker.tokens.length === 0) throw new Thrown("tracker.tokens(0) out of bounds");
    reg(tracker, "R5", "AvlTree");
    reg(tracker, "R4", "GroupElement");
    const want = reg(SELF, "R6", "Coll[Byte]").value;
    return { ok: tracker.tokens[0].tokenId === want, detail: `tracker NFT ${tracker.tokens[0].tokenId.slice(0, 12)}… vs R6 ${want.slice(0, 12)}…` };
  });
  if (trackerOk === null) tracker = undefined;

  // key, amounts
  let receiver = "";
  let totalDebt = 0n;
  let timestamp = 0n;
  let key: Uint8Array | null = null;
  let rKey: Uint8Array | null = null;
  let varsOk = true;
  try {
    receiver = cvar(vars, 1, "GroupElement").value;
    totalDebt = cvar(vars, 3, "Long").value;
    timestamp = cvar(vars, 4, "Long").value;
    key = makeDebtKey(ownerKey, receiver, tokenId1 ? hexToBytes(tokenId1) : null);
    rKey = tokenId1 ? makeReserveKey(ownerKey, receiver) : key;
    out.debtKey = bytesToHex(key);
    out.reserveKey = bytesToHex(rKey);
  } catch (e) {
    varsOk = false;
    rec.add("trackerDebtCorrect", "getVar #1 / #3 / #4", "receiver, totalDebt and timestamp supplied", () => {
      throw e instanceof Thrown ? e : new Thrown((e as Error).message);
    });
  }

  // tracker tree lookup (#8)
  if (varsOk && key) {
    rec.add("trackerDebtCorrect", "byteArrayToLong(trackerTree.get(key, getVar(8).get).get) == totalDebt", "tracker tree holds exactly totalDebt", () => {
      if (!tracker) throw new Thrown("no tracker data input");
      const proof = cvar(vars, 8, "Coll[Byte]").value;
      const treeReg = reg(tracker, "R5", "AvlTree");
      let value: Uint8Array | null;
      if (verifier) value = verifier.lookup(treeDigest(treeReg), key!, hexToBytes(proof));
      else {
        if (!treeReg.tree) throw new Thrown("no tree data to replay the lookup");
        value = treeReg.tree.get(key!) ?? null;
      }
      if (value === null) throw new Thrown("trackerTree.get(key, proof) is None (.get throws): the note is not committed");
      if (value.length < 8) throw new Thrown("tracker value shorter than 8 bytes");
      const committed = readI64BE(value, 0);
      return { ok: committed === totalDebt, detail: `committed ${committed}, note says ${totalDebt}` };
    });
  } else if (varsOk) rec.skip("trackerDebtCorrect", "trackerTree.get", "tracker tree holds exactly totalDebt", "no key");

  // reserve tree lookup (#7, optional)
  let storedTimestamp = 0n;
  let redeemedDebt = 0n;
  // getVar[Coll[Byte]](7) of another type throws (InvalidType); it is NOT read as "absent"
  let lookupProofError: Thrown | null = null;
  let lookupProof: Extract<ContextVar, { type: "Coll[Byte]" }> | undefined;
  try {
    lookupProof = cvarOpt(vars, 7, "Coll[Byte]");
  } catch (e) {
    lookupProofError = e instanceof Thrown ? e : new Thrown((e as Error).message);
  }
  let lookupThrew = lookupProofError !== null;
  if (varsOk && rKey) {
    const selfTree = (() => {
      try {
        return reg(SELF, "R5", "AvlTree");
      } catch {
        return null;
      }
    })();
    rec.add("timestampCorrect", "timestamp >= storedTimestamp (from SELF.R5.get(key, #7) when #7 is given)", "note is not older than the last redemption", () => {
      if (lookupProofError) throw lookupProofError;
      if (lookupProof) {
        if (!selfTree) throw new Thrown("SELF.R5 is empty");
        let value: Uint8Array | null;
        if (verifier) value = verifier.lookup(treeDigest(selfTree), rKey!, hexToBytes(lookupProof.value));
        else value = selfTree.tree?.get(rKey!) ?? null;
        if (value === null) {
          lookupThrew = true;
          throw new Thrown("SELF.R5.get(key, #7) is None (.get throws): #7 given but the pair was never redeemed");
        }
        storedTimestamp = readI64BE(value, 0);
        redeemedDebt = readI64BE(value, 8);
      }
      return { ok: timestamp >= storedTimestamp, detail: lookupProof ? `note ts ${timestamp} vs stored ${storedTimestamp}` : "first redemption (#7 omitted): stored timestamp 0" };
    });
  }

  // tracker signature (#6) or emergency
  const enough = tracker ? HEIGHT - tracker.creationHeight > EMERGENCY_BLOCKS : false;
  let message: Uint8Array | null = null;
  if (varsOk && key) {
    try {
      message = noteMessage(key, totalDebt, timestamp, reg(SELF, "R6", "Coll[Byte]").value);
      out.message = bytesToHex(message);
    } catch {
      message = null;
    }
  }
  const trackerSig = (() => {
    try {
      return cvar(vars, 6, "Coll[Byte]").value;
    } catch {
      return null;
    }
  })();
  let trackerSigValid: boolean | null = null;
  if (varsOk) {
    trackerSigValid = rec.add(
      "trackerSigValid",
      "if (#6.size > 0) g^z == a·trackerPk^e else (HEIGHT - tracker.creationInfo._1) > 2160",
      "tracker signature valid, or emergency window open",
      () => {
        if (trackerSig === null) cvar(vars, 6, "Coll[Byte]");
        if (!tracker) throw new Thrown("no tracker data input");
        const sig = hexToBytes(trackerSig!);
        const age = HEIGHT - tracker.creationHeight;
        if (sig.length > 0) {
          out.emergency = false;
          const ok = contractSignatureHolds(reg(tracker, "R4", "GroupElement").value, message!, sig);
          return { ok, detail: ok ? "tracker co-signed this exact message" : "tracker signature does not verify" };
        }
        out.emergency = true;
        return { ok: enough, detail: `no tracker signature; tracker box age ${age} blocks ${enough ? ">" : "≤"} 2160` };
      },
      "properlyRedeemed",
    );
  }

  // amounts
  const redeemed = tokenId1
    ? (() => {
        const inAmt = SELF.tokens[1]?.amount ?? 0n;
        const outAmt = selfOut.tokens[1]?.amount;
        return outAmt === undefined ? null : inAmt - outAmt;
      })()
    : SELF.value - selfOut.value;
  out.redeemed = redeemed ?? undefined;
  if (varsOk) {
    rec.add(
      "properlyRedeemed",
      "redeemed > 0 && redeemed <= totalDebt - redeemedDebt && trackerSigValid",
      "0 < redeemed ≤ totalDebt − already redeemed",
      () => {
        if (redeemed === null) throw new Thrown("selfOut.tokens(1) out of bounds");
        if (lookupThrew) throw new Thrown("redeemedDebt read threw (see timestampCorrect)");
        const room = totalDebt - redeemedDebt;
        const ok = redeemed > 0n && redeemed <= room;
        return { ok, detail: `redeemed ${redeemed}, room ${room} (= ${totalDebt} − ${redeemedDebt})` };
      },
      "properlyRedeemed",
    );
  }

  // owner signature (#2)
  if (varsOk) {
    rec.add("properReserveSignature", "g^z == a·ownerKey^e over the 80-byte message", "issuer (owner) signed this exact note", () => {
      const sig = hexToBytes(cvar(vars, 2, "Coll[Byte]").value);
      if (!message) throw new Thrown("message could not be built");
      const ok = contractSignatureHolds(ownerKey, message, sig);
      return { ok, detail: ok ? "valid" : "does not verify for this (key, totalDebt, timestamp, NFT)" };
    });
  }

  // reserve tree update (#5)
  if (varsOk && rKey) {
    rec.add("properRedemptionTree", "SELF.R5.insert/insertOrUpdate((key, ts ‖ redeemedDebt+redeemed), #5).get == selfOut.R5", "output tree records this redemption", () => {
      const proof = hexToBytes(cvar(vars, 5, "Coll[Byte]").value);
      const selfTree = reg(SELF, "R5", "AvlTree");
      const outTree = reg(selfOut, "R5", "AvlTree");
      if (lookupThrew) throw new Thrown("redeemedDebt read threw (see timestampCorrect)");
      const newRedeemed = redeemedDebt + (redeemed ?? 0n);
      out.newRedeemedTotal = newRedeemed;
      const value = concatBytes(u64be(timestamp), u64be(newRedeemed));
      let next: Uint8Array;
      if (verifier) {
        next = lookupProof ? verifier.insertOrUpdate(treeDigest(selfTree), [[rKey!, value]], proof) : verifier.insert(treeDigest(selfTree), [[rKey!, value]], proof);
      } else {
        if (!selfTree.tree) throw new Thrown("no tree data to replay the update");
        const copy = selfTree.tree.clone();
        if (lookupProof) copy.insertOrUpdate(rKey!, value);
        else copy.insert(rKey!, value);
        next = copy.digest();
      }
      const ok = equalBytes(next, treeDigest(outTree));
      return { ok, detail: `${lookupProof ? "insertOrUpdate" : "insert"} → ${bytesToHex(next).slice(0, 16)}… vs output ${outTree.digest.slice(0, 16)}…` };
    });
  }

  rec.add("refundPreserved", "selfOut.R7[Long].getOrElse(0L) == refundHeight", "refund flag unchanged", () => {
    const o = regOpt(selfOut, "R7", "Long")?.value ?? 0n;
    return { ok: o === refundHeight, detail: `${o} vs ${refundHeight}` };
  });
  rec.add("receiverSignature", "proveDlog(receiver)", "receiver signs the transaction", () => {
    if (!receiver) throw new Thrown("getVar[GroupElement](1) is empty");
    const ok = tx.signers.includes(receiver);
    return { ok, detail: ok ? "signed by the receiver" : "receiver did not sign" };
  });
  void trackerSigValid;
  return out;
}

// ---------- reserve state ----------

export type ReserveContract = "basis" | "basis-token";

export interface ReserveHistoryEntry {
  boxId: Hex;
  txId: Hex;
  action: "create" | ActionName;
  height: number;
  value: bigint;
  tokenAmount: bigint;
  digest: Hex;
  r7: bigint;
  receiver?: Hex;
  amount?: bigint;
}

export interface ReserveInit {
  id: string;
  contract: ReserveContract;
  owner: Hex;
  trackerNftId: Hex;
  denom: DenomId;
  /** nanoERG in the box (for a token reserve: the ERG that keeps the box alive). */
  value: bigint;
  /** Token reserve: reserve token amount and the minted reserve NFT id. */
  tokenAmount?: bigint;
  reserveNftId?: Hex;
  height: number;
  boxId: Hex;
  txId: Hex;
  avl?: AvlBackend;
}

export function deriveId(tag: string, ...parts: (string | number | bigint)[]): Hex {
  return bytesToHex(blake2b256(utf8(`basis-sim/${tag}`), utf8(parts.map(String).join("|"))));
}

/** One reserve: its current box, its redemption tree and its history. */
export class ReserveSim {
  readonly id: string;
  readonly contract: ReserveContract;
  readonly owner: Hex;
  readonly trackerNftId: Hex;
  readonly denom: DenomId;
  readonly reserveNftId: Hex | null;
  readonly tokenId: Hex | null;
  box: SimBox | null;
  tree: AuthenticatedMap;
  readonly history: ReserveHistoryEntry[] = [];
  readonly avl: AvlBackend;

  constructor(init: ReserveInit) {
    this.id = init.id;
    this.contract = init.contract;
    this.owner = init.owner;
    this.trackerNftId = init.trackerNftId;
    this.denom = init.denom;
    this.avl = init.avl ?? getAvlBackend();
    this.tree = this.avl.createMap(32);
    this.tokenId = init.contract === "basis-token" ? init.denom.slice(6) : null;
    this.reserveNftId = init.contract === "basis-token" ? init.reserveNftId ?? deriveId("reserve-nft", init.boxId) : null;
    const tokens: Token[] = this.contract === "basis-token" ? [{ tokenId: this.reserveNftId!, amount: 1n }, { tokenId: this.tokenId!, amount: init.tokenAmount ?? 0n }] : [];
    this.box = {
      boxId: init.boxId,
      script: this.contract === "basis-token" ? "basis-token.es" : "basis.es",
      value: init.value,
      tokens,
      registers: {
        R4: { type: "GroupElement", value: init.owner },
        R5: { type: "AvlTree", digest: bytesToHex(this.tree.digest()), tree: this.tree },
        R6: { type: "Coll[Byte]", value: init.trackerNftId },
      },
      creationHeight: init.height,
    };
    this.history.push({ boxId: init.boxId, txId: init.txId, action: "create", height: init.height, value: init.value, tokenAmount: init.tokenAmount ?? 0n, digest: bytesToHex(this.tree.digest()), r7: 0n });
  }

  /** Independent copy (time machine checkpoints). Boxes and trees are replaced, never mutated, so they are shared. */
  clone(): ReserveSim {
    const c = Object.create(ReserveSim.prototype) as ReserveSim;
    const w = c as unknown as Record<string, unknown>;
    w.id = this.id;
    w.contract = this.contract;
    w.owner = this.owner;
    w.trackerNftId = this.trackerNftId;
    w.denom = this.denom;
    w.reserveNftId = this.reserveNftId;
    w.tokenId = this.tokenId;
    w.box = this.box;
    w.tree = this.tree;
    w.history = this.history.slice();
    w.avl = this.avl;
    return c;
  }

  get active(): boolean {
    return this.box !== null;
  }

  /** Collateral in the reserve's denomination (nanoERG or token units). */
  collateral(): bigint {
    if (!this.box) return 0n;
    return this.contract === "basis-token" ? this.box.tokens[1].amount : this.box.value;
  }

  refundHeight(): bigint {
    const r = this.box?.registers.R7;
    return r && r.type === "Long" ? r.value : 0n;
  }

  refundPending(): boolean {
    return this.refundHeight() > 0n;
  }

  /** First height at which the owner may complete the refund (null if none pending). */
  refundUnlockHeight(): number | null {
    const r = this.refundHeight();
    return r > 0n ? Number(r) + REFUND_PERIOD_BLOCKS : null;
  }

  /** What this reserve has already paid out for an (issuer = owner, receiver) pair. */
  redeemedFor(receiver: Hex): { timestamp: bigint; redeemed: bigint } | null {
    const v = this.tree.get(makeReserveKey(this.owner, receiver));
    if (!v) return null;
    return { timestamp: readI64BE(v, 0), redeemed: readI64BE(v, 8) };
  }

  digestHex(): Hex {
    return bytesToHex(this.tree.digest());
  }

  /** Register view of the current box as the node would show it (R5 digest is simulated unless a real AVL backend is active). */
  registersHex(): Record<string, Hex> {
    if (!this.box) return {};
    const out: Record<string, Hex> = {
      R4: encodeGroupElement(this.owner),
      R5: basisAvlRegister(this.tree.digest()),
      R6: encodeCollByte(this.trackerNftId),
    };
    const r7 = this.refundHeight();
    if (this.box.registers.R7) out.R7 = encodeLong(r7);
    return out;
  }

  // ---------- transaction builders ----------

  private requireBox(): SimBox {
    if (!this.box) throw new Error(`reserve ${this.id} is closed`);
    return this.box;
  }

  private outputLike(over: Partial<SimBox> & { registers?: SimBox["registers"] }, height: number, txId: Hex, index = 0): SimBox {
    const b = this.requireBox();
    return {
      boxId: deriveId("box", txId, index),
      script: b.script,
      value: b.value,
      tokens: b.tokens.map((t) => ({ ...t })),
      registers: { ...b.registers },
      creationHeight: height,
      ...over,
    };
  }

  buildRedeem(p: RedeemBuild): { tx: SimTx; nextTree: AuthenticatedMap; newRedeemedTotal: bigint } {
    const SELF = this.requireBox();
    const t = p.tamper ?? {};
    const tokenBytes = this.tokenId ? hexToBytes(this.tokenId) : null;
    const dKey = makeDebtKey(this.owner, p.receiver, tokenBytes);
    const rKey = makeReserveKey(this.owner, p.receiver);
    const prior = this.tree.get(rKey);
    const priorRedeemed = prior ? readI64BE(prior, 8) : 0n;
    const includeLookup = t.forceReserveLookup ? true : t.omitReserveLookup ? false : !!prior;
    const newRedeemed = (includeLookup ? priorRedeemed : 0n) + p.amount;
    const value = reserveTreeValue(p.timestamp, newRedeemed);
    const nextTree = this.tree.clone();
    let insertProof: Uint8Array;
    try {
      const op = includeLookup ? ("insertOrUpdate" as const) : ("insert" as const);
      insertProof = this.tree.prove([{ op, key: rKey, value }]).proof;
      nextTree[op](rKey, value);
    } catch {
      // impossible operation (e.g. insert of a present key): ship a lookup proof; the contract will throw
      insertProof = this.tree.proofFor(rKey);
    }
    const txId = deriveId("tx", "redeem", SELF.boxId, p.receiver, p.amount, p.timestamp, p.height, p.salt ?? "");
    const trackerBox = t.trackerBox ?? p.trackerBox;
    const trackerTree = trackerBox.registers.R5?.type === "AvlTree" ? trackerBox.registers.R5.tree : undefined;
    const trackerProof = t.trackerProof ?? (trackerTree ? trackerTree.proofFor(dKey) : new Uint8Array());
    const outIndex = p.outputIndex ?? 0;
    const selfOut = this.outputLike(
      {
        value: this.contract === "basis-token" ? SELF.value + (t.ergDelta ?? 0n) : SELF.value - p.amount - (t.extraTaken ?? 0n),
        tokens:
          t.outputTokens ??
          (this.contract === "basis-token" ? [{ ...SELF.tokens[0] }, { tokenId: SELF.tokens[1].tokenId, amount: SELF.tokens[1].amount - p.amount - (t.extraTaken ?? 0n) }] : SELF.tokens.map((x) => ({ ...x }))),
        registers: {
          ...SELF.registers,
          R5: { type: "AvlTree", digest: t.staleOutputTree ? bytesToHex(this.tree.digest()) : bytesToHex(nextTree.digest()), tree: t.staleOutputTree ? this.tree : nextTree },
          ...(t.outputR7 !== undefined ? (t.outputR7 === null ? { R7: undefined } : { R7: { type: "Long" as const, value: t.outputR7 } }) : {}),
        },
        script: t.outputScript ?? SELF.script,
      },
      p.height,
      txId,
      p.outputIndex ?? 0,
    );
    if (t.outputR7 === null) delete selfOut.registers.R7;
    const receiverOut: SimBox = {
      boxId: deriveId("box", txId, "receiver"),
      script: `p2pk:${p.receiver}`,
      value: this.contract === "basis-token" ? MIN_BOX_VALUE_NANOERG : p.amount,
      tokens: this.contract === "basis-token" ? [{ tokenId: this.tokenId!, amount: p.amount }] : [],
      registers: {},
      creationHeight: p.height,
    };
    const feeOut: SimBox = { boxId: deriveId("box", txId, "fee"), script: "miner-fee", value: MINER_FEE_NANOERG, tokens: [], registers: {}, creationHeight: p.height };
    const outputs: SimBox[] = [];
    outputs[outIndex] = selfOut;
    const rest = [receiverOut, feeOut];
    const total = 1 + rest.length + Math.max(0, outIndex - rest.length);
    for (let i = 0; i < total; i++) {
      if (outputs[i]) continue;
      outputs[i] = rest.shift() ?? { boxId: deriveId("box", txId, `pad${i}`), script: "other", value: MIN_BOX_VALUE_NANOERG, tokens: [], registers: {}, creationHeight: p.height };
    }
    const vars: Record<number, ContextVar> = {
      0: { type: "Byte", value: 0 * 10 + outIndex },
      1: { type: "GroupElement", value: t.receiverVar ?? p.receiver },
      2: { type: "Coll[Byte]", value: bytesToHex(p.issuerSig) },
      3: { type: "Long", value: t.totalDebtVar ?? p.totalDebt },
      4: { type: "Long", value: p.timestamp },
      5: { type: "Coll[Byte]", value: bytesToHex(t.insertProof ?? insertProof) },
      6: { type: "Coll[Byte]", value: bytesToHex(p.trackerSig) },
      8: { type: "Coll[Byte]", value: bytesToHex(trackerProof) },
    };
    if (includeLookup) vars[7] = { type: "Coll[Byte]", value: bytesToHex(t.reserveProof ?? this.tree.proofFor(rKey)) };
    if (t.dropVars) for (const id of t.dropVars) delete vars[id];
    const inputs: SimBox[] = [SELF, ...(t.extraInputs ?? [])];
    const signers = t.signers ?? [p.receiver, ...(p.extraSigners ?? [])];
    return {
      tx: { id: txId, inputs, dataInputs: [trackerBox], outputs, contextVars: { 0: vars }, signers, height: p.height },
      nextTree,
      newRedeemedTotal: newRedeemed,
    };
  }

  buildTopUp(amount: bigint, payer: Hex, height: number, salt = ""): SimTx {
    const SELF = this.requireBox();
    const txId = deriveId("tx", "topup", SELF.boxId, amount, height, payer, salt);
    const isToken = this.contract === "basis-token";
    const out = this.outputLike(
      {
        value: isToken ? SELF.value : SELF.value + amount,
        tokens: isToken ? [{ ...SELF.tokens[0] }, { tokenId: SELF.tokens[1].tokenId, amount: SELF.tokens[1].amount + amount }] : SELF.tokens.map((x) => ({ ...x })),
      },
      height,
      txId,
    );
    return { id: txId, inputs: [SELF], dataInputs: [], outputs: [out], contextVars: { 0: { 0: { type: "Byte", value: 10 } } }, signers: [payer], height };
  }

  buildInitiateRefund(r7: bigint, height: number, signers: Hex[] = [this.owner]): SimTx {
    const SELF = this.requireBox();
    const txId = deriveId("tx", "refund-init", SELF.boxId, r7, height);
    const out = this.outputLike({ registers: { ...SELF.registers, R7: { type: "Long", value: r7 } } }, height, txId);
    return { id: txId, inputs: [SELF], dataInputs: [], outputs: [out], contextVars: { 0: { 0: { type: "Byte", value: 20 } } }, signers, height };
  }

  buildCompleteRefund(height: number, signers: Hex[] = [this.owner]): SimTx {
    const SELF = this.requireBox();
    const txId = deriveId("tx", "refund-complete", SELF.boxId, height);
    const out: SimBox = { boxId: deriveId("box", txId, 0), script: `p2pk:${this.owner}`, value: SELF.value - MINER_FEE_NANOERG, tokens: SELF.tokens.map((t) => ({ ...t })), registers: {}, creationHeight: height };
    const fee: SimBox = { boxId: deriveId("box", txId, 1), script: "miner-fee", value: MINER_FEE_NANOERG, tokens: [], registers: {}, creationHeight: height };
    return { id: txId, inputs: [SELF], dataInputs: [], outputs: [out, fee], contextVars: { 0: { 0: { type: "Byte", value: 30 } } }, signers, height };
  }

  evaluate(tx: SimTx, inputIndex = 0): ReserveEval {
    return evaluateReserveSpend(tx, inputIndex, { avl: this.avl });
  }

  // ---------- state transitions (called by reducers, after validation) ----------

  applyRedeem(p: { receiver: Hex; amount: bigint; timestamp: bigint; newRedeemedTotal: bigint; boxId: Hex; txId: Hex; height: number; expectDigest?: Hex }): void {
    const b = this.requireBox();
    const rKey = makeReserveKey(this.owner, p.receiver);
    this.tree = this.tree.clone();
    this.tree.insertOrUpdate(rKey, reserveTreeValue(p.timestamp, p.newRedeemedTotal));
    const digest = bytesToHex(this.tree.digest());
    if (p.expectDigest && p.expectDigest !== digest) throw new Error(`replay diverged: reserve ${this.id} digest ${digest} ≠ ${p.expectDigest}`);
    const isToken = this.contract === "basis-token";
    this.box = {
      ...b,
      boxId: p.boxId,
      value: isToken ? b.value : b.value - p.amount,
      tokens: isToken ? [{ ...b.tokens[0] }, { tokenId: b.tokens[1].tokenId, amount: b.tokens[1].amount - p.amount }] : b.tokens,
      registers: { ...b.registers, R5: { type: "AvlTree", digest, tree: this.tree } },
      creationHeight: p.height,
    };
    this.history.push({ boxId: p.boxId, txId: p.txId, action: "redeem", height: p.height, value: this.box.value, tokenAmount: isToken ? this.box.tokens[1].amount : 0n, digest, r7: this.refundHeight(), receiver: p.receiver, amount: p.amount });
  }

  applyTopUp(p: { amount: bigint; boxId: Hex; txId: Hex; height: number }): void {
    const b = this.requireBox();
    const isToken = this.contract === "basis-token";
    this.box = {
      ...b,
      boxId: p.boxId,
      value: isToken ? b.value : b.value + p.amount,
      tokens: isToken ? [{ ...b.tokens[0] }, { tokenId: b.tokens[1].tokenId, amount: b.tokens[1].amount + p.amount }] : b.tokens,
      creationHeight: p.height,
    };
    this.history.push({ boxId: p.boxId, txId: p.txId, action: "top-up", height: p.height, value: this.box.value, tokenAmount: isToken ? this.box.tokens[1].amount : 0n, digest: this.digestHex(), r7: this.refundHeight(), amount: p.amount });
  }

  applyInitiateRefund(p: { r7: bigint; boxId: Hex; txId: Hex; height: number }): void {
    const b = this.requireBox();
    this.box = { ...b, boxId: p.boxId, registers: { ...b.registers, R7: { type: "Long", value: p.r7 } }, creationHeight: p.height };
    this.history.push({ boxId: p.boxId, txId: p.txId, action: "initiate-refund", height: p.height, value: b.value, tokenAmount: this.contract === "basis-token" ? b.tokens[1].amount : 0n, digest: this.digestHex(), r7: p.r7 });
  }

  applyCompleteRefund(p: { txId: Hex; height: number }): { value: bigint; tokens: Token[] } {
    const b = this.requireBox();
    this.history.push({ boxId: "", txId: p.txId, action: "complete-refund", height: p.height, value: 0n, tokenAmount: 0n, digest: this.digestHex(), r7: this.refundHeight() });
    this.box = null;
    return { value: b.value, tokens: b.tokens };
  }
}

export interface RedeemTamper {
  /** Omit #7 even though the pair was redeemed before (double-redemption attempt: `insert` throws). */
  omitReserveLookup?: boolean;
  /** Send #7 even on a first redemption (`get(...).get` throws). */
  forceReserveLookup?: boolean;
  trackerBox?: SimBox;
  trackerProof?: Uint8Array;
  reserveProof?: Uint8Array;
  insertProof?: Uint8Array;
  /** Take this much more from the reserve than `amount` (ERG contract: value; token contract: tokens). */
  extraTaken?: bigint;
  /** Token contract: change the ERG value of the reserve output. */
  ergDelta?: bigint;
  outputTokens?: Token[];
  /** Change R7 in the output (null removes it). */
  outputR7?: bigint | null;
  /** Leave the output's R5 as it was. */
  staleOutputTree?: boolean;
  outputScript?: ScriptId;
  extraInputs?: SimBox[];
  /** Replace the set of signers (e.g. [] = the receiver did not sign). */
  signers?: Hex[];
  /** Claim a different totalDebt in #3 than the signed one. */
  totalDebtVar?: bigint;
  receiverVar?: Hex;
  dropVars?: number[];
}

export interface RedeemBuild {
  receiver: Hex;
  totalDebt: bigint;
  timestamp: bigint;
  amount: bigint;
  issuerSig: Uint8Array;
  /** Empty array = emergency (no tracker signature). */
  trackerSig: Uint8Array;
  trackerBox: SimBox;
  height: number;
  outputIndex?: number;
  extraSigners?: Hex[];
  tamper?: RedeemTamper;
  salt?: string;
}

/** Tracker box as the reserve contract sees it in a data input. */
export function trackerBoxFor(p: { boxId: Hex; nftId: Hex; trackerPub: Hex; tree: AuthenticatedMap; creationHeight: number; digest?: Hex }): SimBox {
  return {
    boxId: p.boxId,
    script: "tracker",
    value: MIN_BOX_VALUE_NANOERG,
    tokens: [{ tokenId: p.nftId, amount: 1n }],
    registers: {
      R4: { type: "GroupElement", value: p.trackerPub },
      R5: { type: "AvlTree", digest: p.digest ?? bytesToHex(p.tree.digest()), tree: p.tree },
      R6: { type: "Coll[Byte]", value: p.nftId },
    },
    creationHeight: p.creationHeight,
  };
}

/** Joins several reserve redemptions into ONE transaction (atomic clearing); output index i = reserve i. */
export function combineRedemptions(parts: Array<{ tx: SimTx }>, height: number, extraSigners: Hex[] = []): SimTx {
  if (parts.length > 10) throw new Error("at most 10 reserve outputs per transaction: the output index is #0 % 10");
  const inputs: SimBox[] = [];
  const outputs: SimBox[] = [];
  const contextVars: SimTx["contextVars"] = {};
  const signers = new Set<Hex>(extraSigners);
  const dataInputs = parts[0]?.tx.dataInputs ?? [];
  const id = deriveId("tx", "clearing", ...parts.map((p) => p.tx.id));
  parts.forEach((p, i) => {
    inputs.push(p.tx.inputs[0]);
    const vars = { ...p.tx.contextVars[0], 0: { type: "Byte" as const, value: i } };
    contextVars[i] = vars;
    outputs[i] = { ...p.tx.outputs[0], boxId: deriveId("box", id, i) };
    for (const s of p.tx.signers) signers.add(s);
  });
  parts.forEach((p, i) => {
    outputs.push({ ...p.tx.outputs[1], boxId: deriveId("box", id, parts.length + i) });
  });
  outputs.push({ boxId: deriveId("box", id, "fee"), script: "miner-fee", value: MINER_FEE_NANOERG, tokens: [], registers: {}, creationHeight: height });
  return { id, inputs, dataInputs, outputs, contextVars, signers: [...signers], height };
}

/**
 * Context extension for the X-ray: `hex` is the raw value (Long as 8 bytes big-endian, as longToByteArray
 * shows it); `wire` is the serialised constant the transaction really carries (type code + value: Byte 02‖b,
 * Long 05‖VLQ(zigzag), GroupElement 07‖33 B, Coll[Byte] 0e‖VLQ(len)‖bytes; an empty #6 is 0e00).
 */
export function contextVarsHex(vars: Record<number, ContextVar>): Record<string, { type: string; hex: Hex; value: string; wire: Hex }> {
  const out: Record<string, { type: string; hex: Hex; value: string; wire: Hex }> = {};
  // a tampered value the serialiser cannot encode shows an empty wire form instead of breaking the X-ray
  const wireOf = (f: () => Hex): Hex => {
    try {
      return f();
    } catch {
      return "";
    }
  };
  for (const [k, v] of Object.entries(vars)) {
    switch (v.type) {
      case "Byte": {
        const b = (v.value & 0xff).toString(16).padStart(2, "0");
        out[`#${k}`] = { type: "Byte", hex: b, value: String(v.value), wire: `02${b}` };
        break;
      }
      case "Long":
        out[`#${k}`] = { type: "Long", hex: bytesToHex(u64be(v.value)), value: v.value.toString(), wire: wireOf(() => encodeLong(v.value)) };
        break;
      case "GroupElement":
        out[`#${k}`] = { type: v.type, hex: v.value, value: `${v.value.length / 2} bytes`, wire: `07${v.value.toLowerCase()}` };
        break;
      default:
        out[`#${k}`] = { type: v.type, hex: v.value, value: `${v.value.length / 2} bytes`, wire: wireOf(() => encodeCollByte(v.value)) };
    }
  }
  return out;
}

