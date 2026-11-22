// Typed command outcomes and toast descriptors. Outcomes are plain data (structured-clone safe), so a command
// run by the leader tab can be returned to a follower tab unchanged, and pages can keep them in state.
import type { AcceptanceResult, ComplianceResult, DenomId, Hex, RedemptionStage, ReserveEval, SimTx } from "@/protocol";
import type { NoteSummary } from "./views";

/** VISUAL §12.10 toast materials: proof (holo), up, metal, alarm; plus a neutral info. */
export type ToastKind = "proof" | "up" | "metal" | "alarm" | "info";

export interface Toast {
  kind: ToastKind;
  /** i18n keys in the `world.` bundle (src/world/i18n.ts); render with worldText(key, params, lang). */
  titleKey: string;
  detailKey?: string;
  params: Record<string, string>;
  /** Alarm toasts stay until dismissed (VISUAL §12.10). */
  sticky?: boolean;
  /** Relevant participant / reserve / note ids, for click-through. */
  refs?: { participant?: string; reserve?: string; noteKey?: Hex; requestId?: string; txId?: Hex };
}

export type CommandKind =
  | "join"
  | "faucet"
  | "pay"
  | "self-note"
  | "request"
  | "request.cancel"
  | "redeem"
  | "reserve.create"
  | "reserve.top-up"
  | "reserve.initiate-refund"
  | "reserve.complete-refund"
  | "novate"
  | "exchange"
  | "policy"
  | "credit-line"
  | "contact"
  | "tracker"
  | "clock"
  | "reset";

export interface OutcomeBase {
  ok: boolean;
  kind: CommandKind;
  /** Engine or world refusal code ("policy-rejected", "note-not-confirmed", "not-joined", …). */
  code?: string;
  /** Engine message (English, technical). Show `worldText("world.code." + code)` to people instead. */
  message?: string;
  /** seq range (inclusive) of the events this command appended; null when it appended none. */
  events: { from: number; to: number } | null;
  toast: Toast;
}

export interface PayOutcome extends OutcomeBase {
  kind: "pay" | "self-note" | "novate";
  to: string;
  denom: DenomId;
  /** The increment Δ asked for. */
  delta: bigint;
  /** Cumulative total of the edge before / after (after = before when refused). */
  totalBefore: bigint;
  totalAfter: bigint;
  note?: NoteSummary;
  /** The receiver's policy decision with its trace (when a policy was evaluated). */
  acceptance?: AcceptanceResult;
  /** Who refused: the receiver's policy, a credit line, the tracker or the issuer's own wallet. */
  by?: "receiver" | "credit-line" | "tracker" | "issuer";
}

export interface RedeemOutcome extends OutcomeBase {
  kind: "redeem";
  issuer: string;
  denom: DenomId;
  amount?: bigint;
  stage?: RedemptionStage;
  emergency?: boolean;
  reserve?: string;
  /** Contract X-ray: every check of basis.es / basis-token.es in order. */
  eval?: ReserveEval;
  /** Transaction lens: inputs, data input, outputs, registers, context variables. */
  tx?: SimTx;
  compliance?: ComplianceResult | null;
  txId?: Hex;
}

export interface ReserveOutcome extends OutcomeBase {
  kind: "reserve.create" | "reserve.top-up" | "reserve.initiate-refund" | "reserve.complete-refund";
  reserve?: string;
  amount?: bigint;
  eval?: ReserveEval;
  tx?: SimTx;
  txId?: Hex;
  /** Refund: height at which completion unlocks (R7 + 43 200). */
  unlockHeight?: number | null;
}

export interface ExchangeOutcomeView extends OutcomeBase {
  kind: "exchange";
  exchangeId?: string;
  http?: number;
}

export interface RequestOutcome extends OutcomeBase {
  kind: "request" | "request.cancel";
  requestId?: string;
  dueHeight?: number;
}

export interface SimpleOutcome extends OutcomeBase {
  kind: "join" | "faucet" | "policy" | "credit-line" | "contact" | "tracker" | "clock" | "reset";
  detail?: Record<string, unknown>;
}

export type AnyOutcome = PayOutcome | RedeemOutcome | ReserveOutcome | ExchangeOutcomeView | RequestOutcome | SimpleOutcome;

/**
 * Deep copy that keeps only plain data: primitives (incl. bigint), Uint8Array, arrays and plain objects.
 * Class instances (AVL trees, ReserveSim, …) and functions are dropped, so the result is structured-clone
 * safe and cannot leak live engine objects (or the wasm heap) into page state.
 */
export function toPlain<T>(v: T, depth = 0): T {
  if (v === null || v === undefined) return v;
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean" || t === "bigint") return v;
  if (t === "function" || t === "symbol") return undefined as T;
  if (depth > 14) return undefined as T;
  if (v instanceof Uint8Array) return new Uint8Array(v) as T;
  if (Array.isArray(v)) return v.map((x) => toPlain(x, depth + 1)) as T;
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return undefined as T;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    const y = toPlain(x, depth + 1);
    if (y !== undefined) out[k] = y;
  }
  return out as T;
}
