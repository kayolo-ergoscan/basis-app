// The Sandbox town (PRODUCT §4.1): a deterministic genesis. Same seed + same genesis time → the same economy,
// byte for byte (state hash, event log), on either AVL backend (each backend has its own digests).
//
// Cast: the town tracker T-01 and its operator, five humans (Alice, Bob, Carol, Dan, Eve), two businesses
// (Café, Bakery) and two AI agents (Scout, Quill). Denominations: ERG and the sandbox stable "sUSE".
// Reserves: Alice ≈ 175 % (healthy), Bakery ≈ 110 % (thin), Café in sUSE, the agents; Dan is a pure-credit
// issuer (no reserve). A short history (payments, commits, a redemption) so no list starts empty.
import {
  blake2b256,
  bytesToHex,
  collateralPolicy,
  cowPolicy,
  defaultCollateralPolicy,
  Economy,
  erg,
  tokenDenomination,
  utf8,
  type AcceptanceConfig,
  type AvlBackend,
  type DenomId,
  type DenominationInfo,
  type Hex,
  type ParticipantKind,
} from "@/protocol";

export const TOWN_SEED = "sandbox-town/v1";
/** Tracker id inside the town economy (also its display code). */
export const TOWN_TRACKER = "T-01";
export const TOWN_TRACKER_NAME = "Town tracker";
export const TOWN_OPERATOR = "op";
/** Participant id of the wallet identity once it has joined. */
export const YOU = "you";

/** The sandbox stable token "sUSE" (PRODUCT §4.1): its id is derived from a sandbox label, so it is no real token. 3 decimals. */
export const SUSE: DenominationInfo = tokenDenomination(blake2b256(utf8("basis-sandbox/token/sUSE/v1")), "sUSE", 3, "Sandbox stable token (play money)");
export const SUSE_ID: DenomId = SUSE.id;

export interface Resident {
  id: string;
  name: string;
  kind: ParticipantKind;
  /** One line about the persona (EN; RU in i18n `world.cast.<id>.about`). */
  about: string;
  erg: bigint;
  suse?: bigint;
}

export const RESIDENTS: readonly Resident[] = [
  { id: TOWN_OPERATOR, name: "Mira (tracker operator)", kind: "tracker-operator", about: "Runs the town tracker T-01: witnesses notes, commits digests, co-signs redemptions.", erg: erg(25) },
  { id: "alice", name: "Alice", kind: "human", about: "Keeps a well-funded reserve and pays for most things with notes.", erg: erg(40) },
  { id: "bob", name: "Bob", kind: "human", about: "Trusts Alice and Dan; accepts anyone else only when fully backed.", erg: erg(6) },
  { id: "carol", name: "Carol", kind: "human", about: "Sells flour and beans. Cautious: 150 % backing, or a short trusted list.", erg: erg(12) },
  { id: "dan", name: "Dan", kind: "human", about: "No reserve: everything he owes is pure credit. Accepts any note.", erg: erg(3) },
  { id: "eve", name: "Eve", kind: "human", about: "Works at the bakery; trusts her employer and Alice up to a cap.", erg: erg(8), suse: 100_000n },
  { id: "cafe", name: "Café", kind: "business", about: "Takes backed notes, keeps a tab for regulars, pays suppliers in sUSE.", erg: erg(4), suse: 800_000n },
  { id: "bakery", name: "Bakery", kind: "business", about: "A thin reserve (about 110 %): takes only fully backed notes.", erg: erg(15) },
  { id: "scout", name: "Scout", kind: "agent", about: "AI search agent: pays Quill per call, accepts only backed notes.", erg: erg(4) },
  { id: "quill", name: "Quill", kind: "agent", about: "AI writing agent: pays Scout per call, accepts only backed notes.", erg: erg(4) },
];

export const HUMANS = ["alice", "bob", "carol", "dan", "eve"] as const;
export const BUSINESSES = ["cafe", "bakery"] as const;
export const AGENTS = ["scout", "quill"] as const;

export interface TownGenesisOptions {
  seed?: string;
  /** Wall time of the genesis block (ms). Default: a fixed instant (deterministic). */
  genesisTimeMs?: bigint;
  /** Default: SANDBOX_GENESIS_HEIGHT. */
  genesisHeight?: number;
  avl?: AvlBackend;
}

/** First block of every sandbox chain the site builds (town, /play runs, Home, Learn labs). Ergo mainnet is near
 *  block 2 000 000, so sandbox blocks counted from 1 are never mistaken for real Ergo blocks. The engine's own
 *  default (DEFAULT_GENESIS_HEIGHT, 1 600 000) stays for its tests; a stored town keeps the height it was built with. */
export const SANDBOX_GENESIS_HEIGHT = 1;

/** 2026-11-01T00:00:00Z — default genesis time (tests, deterministic builds). */
export const DEFAULT_TOWN_GENESIS_MS = 1_793_491_200_000n;

/** Blocks the genesis history spans (used to place genesis in the past so the history ends "now"). */
export const GENESIS_HISTORY_BLOCKS = 46;

const E = (x: number | string) => erg(x);
const S = (x: number) => BigInt(Math.round(x * 1000)); // sUSE has 3 decimals

/** The Café's sign: regulars on a tab, anyone fully backed. `newcomers` get a small tab of their own. */
export function cafePolicy(pubs: { regulars: Hex[]; newcomers: Hex[] }): AcceptanceConfig {
  const predicates: AcceptanceConfig["predicates"] = [
    { type: "whitelist", name: "regulars", holders: pubs.regulars, max_debt: E(3) },
    { type: "collateralization", name: "backed", min_ratio: 1.0 },
  ];
  const any = ["regulars", "backed"];
  if (pubs.newcomers.length) {
    predicates.push({ type: "whitelist", name: "newcomers", holders: pubs.newcomers, max_debt: E(2) });
    any.push("newcomers");
  }
  predicates.push({ type: "any_of", name: "cafe_sign", predicates: any });
  return { default: "reject", root: "cafe_sign", predicates };
}

/** Builds the town economy with its genesis history. Pure and deterministic. */
export function buildTown(o: TownGenesisOptions = {}): Economy {
  const eco = new Economy({ seed: o.seed ?? TOWN_SEED, genesisTimeMs: o.genesisTimeMs ?? DEFAULT_TOWN_GENESIS_MS, genesisHeight: o.genesisHeight ?? SANDBOX_GENESIS_HEIGHT, avl: o.avl });
  eco.addDenomination(SUSE);
  for (const r of RESIDENTS) {
    eco.addParticipant({ id: r.id, name: r.name, kind: r.kind, avatarSeed: `town/${r.id}`, erg: r.erg, tokens: r.suse ? [[SUSE_ID, r.suse]] : [], meta: { about: r.about } });
  }
  eco.createTracker({ id: TOWN_TRACKER, name: TOWN_TRACKER_NAME, operator: TOWN_OPERATOR, denoms: [SUSE_ID], globalPolicy: defaultCollateralPolicy() });
  const pub = (id: string) => eco.p(id).pub;

  // reserves (basis.es for ERG, basis-token.es for sUSE)
  eco.createReserve({ owner: "alice", amount: E(26), id: "alice-erg" });
  eco.createReserve({ owner: "bakery", amount: E(11), id: "bakery-erg" });
  eco.createReserve({ owner: "cafe", amount: S(600), denom: SUSE_ID, id: "cafe-suse" });
  eco.createReserve({ owner: "scout", amount: E(2), id: "scout-erg" });
  eco.createReserve({ owner: "quill", amount: E(2), id: "quill-erg" });

  // acceptance policies (the tracker's format) and credit lines (outstanding caps)
  eco.setPolicy("alice", cowPolicy([pub("bob"), pub("carol"), pub("eve")], 1.0, E(5)));
  eco.setPolicy("bob", cowPolicy([pub("alice"), pub("dan")], 1.0, null));
  eco.setPolicy("carol", cowPolicy([pub("bob"), pub("bakery")], 1.5, E(6)));
  eco.setPolicy("eve", cowPolicy([pub("bakery"), pub("alice")], 1.2, E(6)));
  eco.setPolicy("cafe", cafePolicy({ regulars: [pub("dan")], newcomers: [] }));
  eco.setPolicy("bakery", collateralPolicy(1.0, true));
  eco.setPolicy("scout", collateralPolicy(1.0, true));
  eco.setPolicy("quill", collateralPolicy(1.0, true));
  eco.setCreditLine("bob", "dan", E(2));

  const pay = (from: string, to: string, amount: bigint, memo: string, denom?: DenomId) => {
    const r = eco.pay({ from, to, amount, denom, memo });
    if (!r.ok) throw new Error(`town genesis: ${from} → ${to} refused (${r.code}: ${r.message})`);
  };

  // morning
  eco.mine(3);
  pay("alice", "cafe", E("0.6"), "flat white + croissant");
  pay("alice", "bakery", E("0.8"), "sourdough loaf");
  pay("dan", "cafe", E("0.9"), "lunch on the tab");
  pay("scout", "quill", E("0.012"), "summary call");
  pay("quill", "scout", E("0.008"), "search call");
  pay("cafe", "bakery", S(120), "bread delivery", SUSE_ID);
  pay("bakery", "carol", E(3), "flour, 25 kg");
  pay("bakery", "eve", E(2), "wages, week 1");
  pay("scout", "quill", E("0.009"), "summary call");
  eco.mine(12);

  // midday
  pay("alice", "bob", E(6), "bike, second hand");
  pay("alice", "eve", E(3), "garden work");
  pay("alice", "cafe", E("1.2"), "team lunch");
  pay("cafe", "carol", S(120), "coffee beans", SUSE_ID);
  pay("dan", "bob", E("1.2"), "concert tickets");
  pay("bob", "carol", E("1.5"), "eggs and honey");
  pay("alice", "bakery", E("1.6"), "birthday cake");
  pay("quill", "scout", E("0.011"), "search call");
  pay("scout", "quill", E("0.014"), "summary call");
  eco.mine(12);

  // Bob cashes part of Alice's note in: tracker co-signs, the reserve contract checks every rule
  const red = eco.redeem({ receiver: "bob", issuer: "alice", amount: E(2) });
  if (!red.ok) throw new Error(`town genesis: redemption refused (${red.code}: ${red.message})`);

  // afternoon
  eco.mine(4);
  pay("alice", "cafe", E("2.4"), "catering");
  pay("bakery", "carol", E(3), "flour, 25 kg");
  pay("bakery", "eve", E(2), "wages, week 2");
  pay("cafe", "bakery", S(120), "bread delivery", SUSE_ID);
  pay("quill", "scout", E("0.006"), "search call");
  eco.mine(12);

  // just now: these are still local (not yet in a committed digest)
  eco.mine(3);
  pay("scout", "quill", E("0.007"), "summary call");
  pay("dan", "cafe", E("0.3"), "espresso on the tab");
  return eco;
}

/** Stable id for a town: seed + genesis time (the persistence key and the multi-tab channel use it). */
export function townFingerprint(seed: string, genesisTimeMs: bigint): string {
  return bytesToHex(blake2b256(utf8(`town|${seed}|${genesisTimeMs}`))).slice(0, 16);
}
