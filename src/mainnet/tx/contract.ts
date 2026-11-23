// L2 (design §3.4): the reserve contract, rule by rule, on the real transaction. The app's contract engine
// (protocol/reserve.ts `evaluateReserveSpend`) runs on a SimTx mapped from the real bytes, with the STATELESS
// verifier of avl.wasm (the stock ergo_avltree_rust, strict like the chain):
//   • the #8 lookup proof against the tracker box R5 digest (the note is committed at exactly #3);
//   • the #7 lookup against the reserve's own tree (the last redeemed total), when present;
//   • the #5 proof: `insert` on a first redemption, `insertOrUpdate` later, must give output 0's R5, with the value
//     timestamp ‖ (redeemed so far + this amount);
//   • the issuer (#2) and tracker (#6) signatures with the contract's signed-integer reading.
// This is what catches the known divergence: the tracker's vendored AVL turns `insert` into an upsert, so it can
// build a replay the chain rejects (KNOWLEDGE D16).
//
// The verifier is passed in; the global sandbox AVL backend is never switched. `loadContractAvl()` loads avl.wasm
// once (lazily: it is only needed on the redemption review).
import type { AvlBackend } from "../../protocol/avl";
import { decodeRegister, encodeAvlTree } from "../../protocol/registerCodec";
import { encodeCollByte, encodeLong, type AvlTreeRegister } from "../../protocol/registers";
import { evaluateReserveSpend, type ContextVar, type RegisterValue, type ReserveCheckId, type ReserveEval, type ScriptId, type SimBox, type SimTx } from "../../protocol/reserve";
import { FEE_TREE_HEX, RESERVE_TREE_HEX, p2pkKeyOfTree } from "./constants";
import { REGISTER_NAMES, type BoxCandidate, type ErgoBox, type ExtensionEntry, type Hex, type UnsignedTx } from "./model";
import type { ChainBoxes, CheckedRedemption } from "./redemption";
import type { ReserveActionKind } from "./reserveaction";
import { computeTxId, outputBoxes } from "./serialize";

/** Loads avl.wasm once and returns its backend (with the stateless verifier). Does not switch the global backend. */
export async function loadContractAvl(): Promise<AvlBackend> {
  const m = await import("../../protocol/avl-wasm");
  return m.loadErgoAvlBackend();
}

export interface ContractInput {
  tx: UnsignedTx;
  /** The boxes the transaction spends, in its order (the /v1 copies, ids checked by L1). */
  inputs: readonly ErgoBox[];
  dataInputs: readonly ErgoBox[];
  /** Keys whose proveDlog the signed transaction carries: the receiver (and fee-input owners in old layouts). */
  signers: readonly Hex[];
  /** HEIGHT the contract sees: the block that includes it (tip + 1 before broadcast). */
  height: number;
  /** The reserve input (default 0). */
  inputIndex?: number;
}

/** "adapter": the real transaction cannot be mapped faithfully; the others are the contract's own checks. */
export type L2Rule = "adapter" | "verifier" | "tree-params" | "redeem-shape" | "redeemed-total" | "action-shape" | ReserveCheckId;

export interface L2Result {
  ok: boolean;
  /** The engine's report (every check, in contract order): feed it to the contract X-ray. Null if not evaluated. */
  eval: ReserveEval | null;
  /** The first failure. */
  rule?: L2Rule;
  message?: string;
}

class Unmappable extends Error {}

function scriptOf(tree: Hex): ScriptId {
  if (tree === RESERVE_TREE_HEX) return "basis.es";
  if (tree === FEE_TREE_HEX) return "miner-fee";
  const pk = p2pkKeyOfTree(tree);
  return pk ? `p2pk:${pk}` : "other";
}

/** One register as the engine reads it. Refuses anything that is not exactly one constant of a type Basis uses. */
function registerValue(hex: Hex, where: string): RegisterValue {
  let d;
  try {
    d = decodeRegister(hex);
  } catch (e) {
    throw new Unmappable(`${where}: ${(e as Error).message}`);
  }
  switch (d.type) {
    case "GroupElement":
      return { type: "GroupElement", value: d.value };
    case "Coll[Byte]":
      if (encodeCollByte(d.value) !== hex) break;
      return { type: "Coll[Byte]", value: d.value };
    case "Long":
      if (encodeLong(d.value) !== hex) break;
      return { type: "Long", value: d.value };
    case "AvlTree":
      if (encodeAvlTree(d) !== hex) break;
      return { type: "AvlTree", digest: d.digest };
    default:
      throw new Unmappable(`${where} holds a constant type the engine does not model (${hex.slice(0, 2)})`);
  }
  throw new Unmappable(`${where} is not exactly one canonical constant`);
}

/**
 * One box as the engine sees it. Reserve-tree boxes, outputs and data inputs are mapped strictly (the contract reads
 * them); another input's registers are opaque to the contract (basis.es reads only SELF, its output and the tracker
 * box), so a register of a type the engine does not model (an Int, a SigmaProp, a Coll[Coll[Byte]] on one of the
 * payer's own boxes) is left out instead of refusing an honest transaction.
 */
function simBox(b: BoxCandidate & { boxId: Hex }, where: string, opaque = false): SimBox {
  const registers: SimBox["registers"] = {};
  const lenient = opaque && b.ergoTree !== RESERVE_TREE_HEX;
  b.registers.forEach((hex, i) => {
    try {
      registers[REGISTER_NAMES[i]] = registerValue(hex, `${where} ${REGISTER_NAMES[i]}`);
    } catch (e) {
      if (!lenient || !(e instanceof Unmappable)) throw e;
    }
  });
  return { boxId: b.boxId, script: scriptOf(b.ergoTree), value: b.value, tokens: b.tokens.map((t) => ({ ...t })), registers, creationHeight: b.creationHeight };
}

function avlOf(hex: Hex | undefined): AvlTreeRegister | null {
  if (!hex) return null;
  try {
    const d = decodeRegister(hex);
    return d.type === "AvlTree" ? d : null;
  } catch {
    return null;
  }
}

/** One context variable. Byte 02‖b (signed), GroupElement 07‖33, Coll[Byte] and Long exactly. */
function contextVar(e: ExtensionEntry, where: string): ContextVar {
  const h = e.value;
  if (/^02[0-9a-f]{2}$/.test(h)) return { type: "Byte", value: (parseInt(h.slice(2), 16) << 24) >> 24 };
  if (h.startsWith("07")) {
    if (h.length !== 2 * 34) throw new Unmappable(`${where} is not a 33-byte GroupElement`);
    return { type: "GroupElement", value: h.slice(2) };
  }
  if (h.startsWith("0e") || h.startsWith("05")) {
    const r = registerValue(h, where);
    if (r.type === "Coll[Byte]" || r.type === "Long") return r;
  }
  throw new Unmappable(`${where} holds a constant type the engine does not model (${h.slice(0, 2)})`);
}

/** The SimTx the engine evaluates, from the real transaction. Throws Unmappable. */
function toSimTx(c: ContractInput): SimTx {
  if (c.inputs.length !== c.tx.inputs.length || c.dataInputs.length !== c.tx.dataInputs.length) throw new Unmappable("one box per input and data input");
  c.tx.inputs.forEach((inp, i) => {
    if (c.inputs[i].boxId !== inp.boxId) throw new Unmappable(`input ${i} is not box ${inp.boxId}`);
  });
  c.tx.dataInputs.forEach((id, i) => {
    if (c.dataInputs[i].boxId !== id) throw new Unmappable(`data input ${i} is not box ${id}`);
  });
  const id = computeTxId(c.tx);
  const contextVars: SimTx["contextVars"] = {};
  c.tx.inputs.forEach((inp, i) => {
    const vars: Record<number, ContextVar> = {};
    for (const e of inp.extension) vars[e.key] = contextVar(e, `input ${i} context var #${e.key}`);
    contextVars[i] = vars;
  });
  return {
    id,
    inputs: c.inputs.map((b, i) => simBox(b, `input ${i}`, true)),
    dataInputs: c.dataInputs.map((b, i) => simBox(b, `data input ${i}`)),
    outputs: outputBoxes(c.tx, id).map((b, i) => simBox(b, `output ${i}`)),
    contextVars,
    signers: [...c.signers],
    height: c.height,
  };
}

/**
 * The real transaction as the review screens' TxLens shows it (the same mapping L2 evaluates), or null when a box or a
 * context variable holds a constant the engine does not model (then the screen lists the boxes itself). Never throws
 * for such input.
 */
export function simTxOf(c: ContractInput): SimTx | null {
  try {
    return toSimTx(c);
  } catch (e) {
    if (e instanceof Unmappable) return null;
    throw e;
  }
}

/**
 * Runs the ERG reserve contract on input `inputIndex` of a real transaction. `avl` must carry a stateless verifier
 * (avl.wasm: `loadContractAvl()`); the engine never falls back to replaying trees here.
 */
export function checkReserveContract(c: ContractInput, avl: AvlBackend): L2Result {
  const idx = c.inputIndex ?? 0;
  if (!avl.verifier) return { ok: false, eval: null, rule: "verifier", message: "this AVL backend cannot verify proofs statelessly" };
  const self = c.inputs[idx];
  if (!self || self.ergoTree !== RESERVE_TREE_HEX) return { ok: false, eval: null, rule: "adapter", message: `input ${idx} is not under the pinned ERG reserve contract` };
  let sim: SimTx;
  try {
    sim = toSimTx(c);
  } catch (e) {
    if (e instanceof Unmappable) return { ok: false, eval: null, rule: "adapter", message: e.message };
    throw e;
  }
  const ev = evaluateReserveSpend(sim, idx, { avl });
  if (!ev.ok) {
    const rule = (ev.error?.check ?? ev.failed[0] ?? "adapter") as L2Rule;
    return { ok: false, eval: ev, rule, message: ev.error?.message ?? "the contract does not accept this spend" };
  }
  // only a redemption reads AVL proofs; top-up and refund compare R5 whole and never touch a proof
  if (ev.action === 0 && ev.proofMode !== "verified") return { ok: false, eval: ev, rule: "verifier", message: "the AVL proofs were not verified statelessly" };

  // The contract compares whole AvlTree values: SELF.R5.insert…(…).get == selfOut.R5 keeps SELF's flags, key length
  // and value length, and insert / insertOrUpdate need the matching flags. The engine compares digests only.
  if (ev.action === 0 && ev.outputIndex !== null) {
    const inTree = avlOf(self.registers[1]);
    const outTree = avlOf(c.tx.outputs[ev.outputIndex]?.registers[1]);
    if (!inTree || !outTree) return { ok: false, eval: ev, rule: "tree-params", message: "R5 is not an AvlTree" };
    if (inTree.flags !== outTree.flags || inTree.keyLength !== outTree.keyLength || inTree.valueLength !== outTree.valueLength) {
      return { ok: false, eval: ev, rule: "tree-params", message: "output R5 changes the tree's flags, key length or value length" };
    }
    const update = c.tx.inputs[idx].extension.some((e) => e.key === 7);
    if ((inTree.flags & 0x01) === 0 || (update && (inTree.flags & 0x02) === 0)) return { ok: false, eval: ev, rule: "tree-params", message: "the reserve tree does not allow this update" };
  }
  return { ok: true, eval: ev };
}

/**
 * L2 for a build that passed L1: the contract accepts the spend as a redemption into output 0, signed by the
 * receiver, at `height` (tip + 1), and its arithmetic agrees with the build: it redeems exactly the amount and the
 * reserve tree records exactly the build's `new_already_redeemed`.
 */
export function checkRedemptionContract(checked: CheckedRedemption, chain: ChainBoxes, height: number, avl: AvlBackend): L2Result {
  const r = checkReserveContract({ tx: checked.build.unsigned, inputs: chain.inputs, dataInputs: chain.dataInputs, signers: [checked.expect.recipient], height }, avl);
  if (!r.ok || !r.eval) return r;
  const ev = r.eval;
  if (ev.action !== 0 || ev.outputIndex !== 0 || ev.emergency !== false) return { ok: false, eval: ev, rule: "redeem-shape", message: "the contract does not see a tracker-signed redemption into output 0" };
  if (ev.redeemed !== checked.expect.amount) return { ok: false, eval: ev, rule: "redeemed-total", message: `the contract sees ${ev.redeemed} nanoERG redeemed, not ${checked.expect.amount}` };
  if (ev.newRedeemedTotal !== checked.build.newAlreadyRedeemed) {
    return { ok: false, eval: ev, rule: "redeemed-total", message: `the reserve tree records ${ev.newRedeemedTotal} redeemed in total; the build says ${checked.build.newAlreadyRedeemed}` };
  }
  return r;
}

/**
 * L2 for a top-up, a refund start or a completion that passed L1 (reserveaction.ts): the contract accepts input 0 as
 * exactly this action into output 0, at `height` (tip + 1), with `signers` (the wallet's key) as the transaction's
 * proveDlog. The engine also reports, for the review, every check it ran.
 */
export function checkReserveActionContract(tx: UnsignedTx, inputs: readonly ErgoBox[], kind: ReserveActionKind, signers: readonly Hex[], height: number, avl: AvlBackend): L2Result {
  const r = checkReserveContract({ tx, inputs, dataInputs: [], signers, height }, avl);
  if (!r.ok || !r.eval) return r;
  const want = kind === "topup" ? 1 : kind === "refund-start" ? 2 : 3;
  if (r.eval.action !== want || r.eval.outputIndex !== 0) return { ok: false, eval: r.eval, rule: "action-shape", message: `the contract sees action ${r.eval.action} into output ${r.eval.outputIndex}, not ${want} into 0` };
  // the engine compares R5 digests only; the contract compares whole AvlTree values (l. 442, 453): L1 already holds R5
  // byte for byte, this keeps the rule next to the contract's
  if (kind !== "refund-end" && tx.outputs[0]?.registers[1] !== inputs[0]?.registers[1]) return { ok: false, eval: r.eval, rule: "treePreserved", message: "output 0's R5 is not the reserve's R5 byte for byte" };
  return r;
}
