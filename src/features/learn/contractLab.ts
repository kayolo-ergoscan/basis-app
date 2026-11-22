// The contract lab's sandbox runs: one small economy per run (Alice's reserve, a note to Bob, the tracker T-01),
// then one spending path, honest or not. Pure functions over @/protocol, so the tests can run every path.
import {
  Economy, erg, tokenDenomination, type ActionOutcome, type AvlBackend, type DenomId, type DenominationInfo, type RedemptionOutcome,
} from "@/protocol";

export type PathId = 0 | 1 | 2 | 3;
export type RunKind = "ok" | "bad";
export type LabContract = "basis" | "basis-token";

/** A sandbox token with 3 decimals ("LAB"); its id spells "learn" and is not a token on Ergo. */
export const LAB_TOKEN: DenominationInfo = tokenDenomination("6c6561726e" + "00".repeat(25) + "0001", "LAB", 3, "sandbox token");

/** Amounts per path, in display units (ERG or LAB). */
export const AMOUNTS = {
  reserve: "5",
  owed: "2",
  redeemOk: "0.8",
  redeemBad: "2.5",
  topUpOk: "1",
  topUpBad: { erg: "0.05", token: "0" },
} as const;

function units(token: boolean, v: string): bigint {
  if (!token) return erg(v);
  const [i, f = ""] = v.split(".");
  return BigInt(i) * 1000n + BigInt((f + "000").slice(0, 3));
}

export interface LabRun {
  contract: LabContract;
  action: PathId;
  kind: RunKind;
  outcome: RedemptionOutcome | ActionOutcome;
  /** The sandbox block the path was evaluated at. */
  height: number;
  /** Refused before the contract ran (wallet or tracker stage), with the engine's code. */
  before?: string;
}

function base(backend: AvlBackend, token: boolean): { eco: Economy; denom: DenomId | undefined } {
  const eco = new Economy({ seed: token ? "learn-contract-token" : "learn-contract", avl: backend });
  const denom = token ? eco.addDenomination(LAB_TOKEN).id : undefined;
  const tok = (n: bigint): Array<[DenomId, bigint]> => (token ? [[LAB_TOKEN.id, n]] : []);
  eco.addParticipant({ id: "op", name: "T-01 operator", kind: "tracker-operator", erg: erg(5) });
  eco.addParticipant({ id: "alice", name: "Alice", kind: "human", erg: erg(12), tokens: tok(10_000n) });
  eco.addParticipant({ id: "bob", name: "Bob", kind: "human", erg: erg(4) });
  eco.addParticipant({ id: "carol", name: "Carol", kind: "human", erg: erg(6), tokens: tok(3_000n) });
  eco.createTracker({ id: "t1", name: "T-01", operator: "op", ...(token ? { denoms: [LAB_TOKEN.id] } : {}) });
  const made = eco.createReserve({ owner: "alice", amount: units(token, AMOUNTS.reserve), id: "alice-res", ...(denom ? { denom } : {}) });
  if (!made.ok) throw new Error(`contract lab: reserve (${made.code}: ${made.message})`);
  return { eco, denom };
}

/** Runs one spending path in a fresh sandbox economy. */
export function runPath(backend: AvlBackend, contract: LabContract, action: PathId, kind: RunKind): LabRun {
  const token = contract === "basis-token";
  const { eco, denom } = base(backend, token);
  const d = denom ? { denom } : {};
  let outcome: RedemptionOutcome | ActionOutcome;
  switch (action) {
    case 0: {
      const paid = eco.pay({ from: "alice", to: "bob", amount: units(token, AMOUNTS.owed), ...d });
      if (!paid.ok) throw new Error(`contract lab: pay (${paid.code})`);
      eco.mine(10);
      outcome = kind === "ok"
        ? eco.redeem({ receiver: "bob", issuer: "alice", amount: units(token, AMOUNTS.redeemOk), ...d })
        : eco.redeem({ receiver: "bob", issuer: "alice", amount: units(token, AMOUNTS.redeemBad), force: true, ...d });
      break;
    }
    case 1:
      eco.mine(1);
      outcome = eco.topUp({ reserve: "alice-res", by: "carol", amount: units(token, kind === "ok" ? AMOUNTS.topUpOk : token ? AMOUNTS.topUpBad.token : AMOUNTS.topUpBad.erg) });
      break;
    case 2:
      eco.mine(1);
      outcome = kind === "ok" ? eco.initiateRefund({ reserve: "alice-res" }) : eco.initiateRefund({ reserve: "alice-res", signer: "bob" });
      break;
    case 3: {
      eco.mine(1);
      const started = eco.initiateRefund({ reserve: "alice-res" });
      if (!started.ok) throw new Error(`contract lab: initiate (${started.code})`);
      eco.mine(kind === "ok" ? 43_201 : 1);
      outcome = eco.completeRefund({ reserve: "alice-res" });
      break;
    }
  }
  const stage = (outcome as RedemptionOutcome).stage;
  return {
    contract,
    action,
    kind,
    outcome,
    height: eco.clock.height,
    before: !outcome.ok && !outcome.eval && (stage === "wallet" || stage === "tracker" || !stage) ? outcome.code ?? "refused" : undefined,
  };
}

/** The label amount for a path's button (display units). */
export function amountOf(action: PathId, kind: RunKind, token: boolean): string | null {
  if (action === 0) return kind === "ok" ? AMOUNTS.redeemOk : AMOUNTS.redeemBad;
  if (action === 1) return kind === "ok" ? AMOUNTS.topUpOk : token ? AMOUNTS.topUpBad.token : AMOUNTS.topUpBad.erg;
  return null;
}
