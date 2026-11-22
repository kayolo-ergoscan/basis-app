// The sandbox key and the mainnet key never cross (keys review P2-7): the sandbox keeps its secret as plain text in
// localStorage, so the mainnet vault refuses to import it, and the sandbox refuses to import the mainnet key.
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex } from "@noble/hashes/utils";
import { afterEach, describe, expect, it } from "vitest";
import { MAINNET_PUB_STORAGE_KEY, SANDBOX_WALLET_STORAGE_KEY, mainnetPubInBrowser, sandboxPubInBrowser, setMainnetPubMarker } from "../../key-markers";
import { SandboxWallet, WALLET_STORAGE_KEY, WalletError } from "../../../world/identity";
import { FakeBrowser, PASS } from "./fakes";
import { code, openTab } from "./helpers";

const SK = "2e".repeat(32);
const PUB = bytesToHex(secp256k1.getPublicKey(SK, true));

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() };
}
const g = globalThis as { localStorage?: unknown };
const before = g.localStorage;
afterEach(() => { g.localStorage = before; });

describe("sandbox and mainnet keys", () => {
  it("the mainnet vault refuses this browser's sandbox key", async () => {
    const b = new FakeBrowser();
    const v = await openTab(b, "a", { env: b.env("a", { sandboxPub: () => PUB }) });
    expect(await code(v.importHex(SK, PASS))).toBe("sandbox-key-refused");
    expect(v.getState().status).toBe("none");
    const w = await openTab(b, "b", { env: b.env("b", { sandboxPub: () => "03" + "11".repeat(32) }) });
    expect((await w.importHex(SK, PASS)).state.key?.pub).toBe(PUB);
    v.close();
    w.close();
  });

  it("the sandbox refuses the mainnet key; each side reads only the other's public key", () => {
    g.localStorage = memoryStorage();
    expect(SANDBOX_WALLET_STORAGE_KEY).toBe(WALLET_STORAGE_KEY);
    setMainnetPubMarker(PUB);
    expect(mainnetPubInBrowser()).toBe(PUB);
    const sandbox = new SandboxWallet();
    let err: unknown = null;
    try { sandbox.importHex(SK); } catch (e) { err = e; }
    expect(err instanceof WalletError && err.code).toBe("mainnet-key");
    setMainnetPubMarker(null);
    expect((g.localStorage as Storage).getItem(MAINNET_PUB_STORAGE_KEY)).toBeNull();
    expect(sandbox.importHex(SK).pubHex).toBe(PUB);
    expect(sandboxPubInBrowser()).toBe(PUB);
  });
});
