// Demo stand-ins used by the style tile and the /kit page (sample data only, never real keys):
// a 33-byte compressed-looking key per name, and a 65-byte signature-looking blob per message.
import { blake2bN, concat, hex, utf8 } from "./bytes";
import { pairKey } from "./seal";

export const demoKey = (name: string): string => {
  const h = blake2bN(utf8("basis-intaglio-demo:" + name), 32);
  return (h[31] & 1 ? "03" : "02") + hex(h);
};
export const demoSig = (msg: Uint8Array): string => {
  const h = blake2bN(msg, 64);
  return (h[0] & 1 ? "03" : "02") + hex(h).slice(0, 128);
};

/** The tile's sample circle: five people and two agents, tracker T-01. */
export const DEMO_NAMES = ["Alice", "Bob", "Carol", "Dan", "Eve", "render·ai", "search·ai"] as const;
export type DemoName = (typeof DEMO_NAMES)[number];
export const DEMO_PK: Record<string, string> = Object.fromEntries(DEMO_NAMES.map((n) => [n, demoKey(n)]));
export const isDemoAgent = (n: string): boolean => n.endsWith("·ai");
export const DEMO_TRACKER_NFT = hex(blake2bN(utf8("basis-intaglio-demo:tracker:T-01"), 32));
export const demoPair = (a: string, b: string): Uint8Array => pairKey(DEMO_PK[a] ?? demoKey(a), DEMO_PK[b] ?? demoKey(b));
/** The tile's issuer / tracker signatures of a note: demoSig(key ‖ "issuer"), demoSig(key ‖ "tracker"). */
export const demoNoteSigs = (key: Uint8Array): { sigA: string; sigT: string } => ({
  sigA: demoSig(concat(key, utf8("issuer"))),
  sigT: demoSig(concat(key, utf8("tracker"))),
});
