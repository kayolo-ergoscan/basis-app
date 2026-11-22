import { describe, expect, it } from "vitest";
import { keyPairFromSecret } from "@/protocol";
import { decryptBackup, encryptSecret, PBKDF2_ITERATIONS, SANDBOX_KEY_LABEL, SandboxWallet, WalletError } from "../identity";
import { fingerprint, threeWords, threeWordsLocal, WORDS_SOURCE } from "../words";
import { memWalletStorage } from "./helpers";

const code = async (p: Promise<unknown> | (() => unknown)): Promise<string | undefined> => {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    return (e as WalletError).code;
  }
  return undefined;
};

describe("sandbox wallet", () => {
  it("creates a key with WebCrypto, labels it as a sandbox key and never exposes the secret in its state", () => {
    const storage = memWalletStorage();
    const w = new SandboxWallet(storage);
    expect(w.store.getState().status).toBe("none");
    const id = w.create({ name: "Me" });
    expect(id.sandbox).toBe(true);
    expect(id.label).toBe(SANDBOX_KEY_LABEL);
    expect(id.fingerprint).toBe(fingerprint(id.pubHex));
    expect(id.words).toHaveLength(3);
    const state = JSON.stringify(w.store.getState());
    expect(state).not.toContain(w.revealSecretHex());
    const stored = JSON.parse(storage.value!) as { label: string; format: string };
    expect(stored.label).toBe(SANDBOX_KEY_LABEL);
    expect(stored.format).toBe("basis-sandbox-key");
    expect(keyPairFromSecret(w.revealSecretHex()).pubHex).toBe(id.pubHex);
    // a second create needs replace
    expect(() => w.create()).toThrow(WalletError);
    // another instance over the same storage reads it back (a reload, or another tab)
    expect(new SandboxWallet(storage).identity?.pubHex).toBe(id.pubHex);
  });

  it("encrypted backup round-trip with the default PBKDF2-SHA256 210 000 + AES-GCM", async () => {
    const w = new SandboxWallet(memWalletStorage());
    const id = w.create({ name: "Backup test" });
    const { filename, json, backup } = await w.exportBackup("correct horse battery");
    expect(filename).toMatch(/^basis-sandbox-key-[0-9a-f]{4}-[0-9a-f]{4}-\d{4}-\d{2}-\d{2}\.json$/);
    expect(backup.kdf.iterations).toBe(PBKDF2_ITERATIONS);
    expect(json).not.toContain(w.revealSecretHex());
    expect(await w.verifyBackup(json, "correct horse battery")).toBe(true);
    expect(w.identity?.backedUp).toBe(true);

    const other = new SandboxWallet(memWalletStorage());
    const back = await other.importBackup(json, "correct horse battery");
    expect(back.pubHex).toBe(id.pubHex);
    expect(back.name).toBe("Backup test");
    expect(back.source).toBe("backup");
  });

  it("refuses a wrong passphrase, a changed file, a weak passphrase and bad hex", async () => {
    const secret = new SandboxWallet(memWalletStorage()).create() && "11".repeat(32);
    const b = await encryptSecret(secret, "a long passphrase", { iterations: 10_000 });
    expect(await code(decryptBackup(b, "another passphrase"))).toBe("wrong-passphrase");
    const tampered = { ...b, pub: keyPairFromSecret("22".repeat(32)).pubHex };
    expect(await code(decryptBackup(tampered, "a long passphrase"))).toBe("wrong-passphrase");
    expect((await decryptBackup(JSON.stringify(b), "a long passphrase")).secretHex).toBe(secret);
    expect(await code(encryptSecret(secret, "short"))).toBe("weak-passphrase");
    expect(await code(decryptBackup("{}", "a long passphrase"))).toBe("bad-backup");
    const w = new SandboxWallet(memWalletStorage());
    expect(await code(() => w.importHex("zz"))).toBe("invalid-hex");
    expect(await code(() => w.importHex("00".repeat(32)))).toBe("out-of-range");
    expect(await code(() => w.importHex("ff".repeat(32)))).toBe("out-of-range");
    expect(w.importHex(`0x${"11".repeat(32)}`).pubHex).toBe(keyPairFromSecret(secret).pubHex);
  });

  it("wipe forgets the key", () => {
    const storage = memWalletStorage();
    const w = new SandboxWallet(storage);
    w.create();
    w.wipe();
    expect(w.identity).toBeNull();
    expect(storage.value).toBeNull();
    expect(w.store.getState().status).toBe("none");
  });

  it("three words: the ui engine's words.ts is used and agrees with the local VISUAL §8.6 port", () => {
    expect(WORDS_SOURCE).toBe("ui-engine");
    for (let i = 1; i <= 20; i++) {
      const pub = keyPairFromSecret(i.toString(16).padStart(64, "0")).pubHex;
      expect(threeWords(pub)).toEqual(threeWordsLocal(pub));
    }
    // known vector: the generator point
    const g = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
    expect(threeWords(g)).toEqual(threeWordsLocal(g));
    expect(fingerprint(g)).toBe("0279…1798");
  });
});
