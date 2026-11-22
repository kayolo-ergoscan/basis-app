// The small parts: base64 and the leak scan, passphrase rules, key parsing, the record and backup parsers.
// Random test keys and test scalars only.
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { describe, expect, it } from "vitest";
import { backupFilename, checkExtras, MAX_CONTACT_NAME, MAX_CONTACTS, MAX_WATCHED, parseBackup } from "../backup";
import { fromB64, holdsSecret, sameBytes, toB64, wipe } from "../bytes";
import { BACKUP_FORMAT, KDF_MAX_ITERATIONS, KEY_FORMAT } from "../constants";
import { isVaultError } from "../errors";
import { isPublicKeyHex, randomSecret, secretFromHex } from "../keys";
import { checkPassphrase, normalizePassphrase } from "../passphrase";
import { addressOf, backupAad, extrasAad, keyAad, parseKeyRecord } from "../record";
import { b64, randomPub } from "./helpers";

const syncCode = (fn: () => unknown): string => {
  try {
    fn();
    return "ok";
  } catch (e) {
    return isVaultError(e) ? e.code : "other";
  }
};
const N = "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141";
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));

describe("bytes", () => {
  it("base64 is strict: standard alphabet, padded, exact or ranged length", () => {
    const x = rand(32);
    expect(fromB64(toB64(x))).toEqual(x);
    expect(fromB64("AAAA")).toEqual(new Uint8Array(3));
    expect(fromB64("AA==", 1)).toEqual(new Uint8Array(1));
    for (const bad of ["AAA", "AA=", "A A=", "-_8=", "AAAA\n", 5, null]) expect(fromB64(bad)).toBeNull();
    expect(fromB64("AA==", 2)).toBeNull();
    expect(fromB64(toB64(rand(15)), [16, 64])).toBeNull();
    expect(fromB64(toB64(rand(16)), [16, 64])).not.toBeNull();
    expect(sameBytes(x, x.slice())).toBe(true);
    expect(sameBytes(x, x.slice(1))).toBe(false);
    const y = x.slice();
    y[31] ^= 1;
    expect(sameBytes(x, y)).toBe(false);
    wipe(y, null, undefined);
    expect(y.every((b) => b === 0)).toBe(true);
  });
});

describe("the leak scan (holdsSecret)", () => {
  const sk = secp256k1.utils.randomPrivateKey();
  const hex = bytesToHex(sk);
  const scalar = BigInt(`0x${hex}`);

  it("finds the bytes, in any container, also inside larger buffers and views", () => {
    const big = new Uint8Array(100);
    big.set(sk, 37);
    const found: unknown[] = [
      sk,
      sk.slice(),
      big,
      big.subarray(30, 80),
      new DataView(big.buffer, 10, 80),
      new Uint16Array(big.buffer.slice(0, 100)),
      big.buffer,
      Array.from(sk),
      [7, 300, ...Array.from(sk), -1],
      { a: { b: [{ c: sk.slice() }] } },
      new Map([[sk.slice(), 1]]),
      new Map([["k", sk.slice()]]),
      new Set([sk.slice()]),
      Object.assign(new Error("x"), { extra: sk.slice() }),
      new Error("wrapped", { cause: sk.slice() }),
      new AggregateError([new Error(`k ${hex}`)], "many"),
    ];
    for (const [i, v] of found.entries()) expect(holdsSecret(v, sk), `case ${i}`).toBe(true);
  });

  it("finds it written as text: hex (any case, any offset), base64, base64url, byte lists, decimal; and as a bigint", () => {
    const shifted = new Uint8Array(40);
    shifted.set(sk, 5);
    const url = toB64(shifted).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const found: unknown[] = [
      hex,
      hex.toUpperCase(),
      `x${hex}y`,
      `a${hex}`,
      `0x${hex.slice(0, 30).toUpperCase()}${hex.slice(30)}`,
      toB64(sk),
      toB64(sk).replace(/=+$/, ""),
      `data:${toB64(shifted)}`,
      `key${toB64(shifted)}`,
      url,
      JSON.stringify(Array.from(sk)),
      `[1, 2, ${Array.from(sk).join(", ")}]`,
      scalar.toString(),
      scalar,
      { [hex]: 1 },
    ];
    for (const [i, v] of found.entries()) expect(holdsSecret(v, sk), `case ${i}`).toBe(true);
  });

  it("does not flag what merely looks alike", () => {
    const other = sk.slice();
    other[0] ^= 0xff;
    const near = hex.slice(0, 63);
    const clean: unknown[] = [
      other,
      bytesToHex(other),
      near,
      `${hex.slice(0, 32)}-${hex.slice(32)}`,
      toB64(other),
      JSON.stringify(Array.from(sk).slice(1)),
      scalar + 1n,
      { a: [1, 2, 3], b: "text", c: null, d: true, e: 4.5 },
      bytesToHex(secp256k1.getPublicKey(sk, true)),
      "",
      42,
      undefined,
    ];
    for (const [i, v] of clean.entries()) expect(holdsSecret(v, sk), `case ${i}`).toBe(false);
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(holdsSecret(cyclic, sk)).toBe(false);
  });

  it("fails closed for what it cannot check: functions, promises, deep or huge values", () => {
    let deep: unknown = "leaf";
    for (let i = 0; i < 20; i++) deep = [deep];
    const wide = Array.from({ length: 60_000 }, (_, i) => `v${i}`);
    const unchecked: unknown[] = [() => 1, { f: () => 1 }, Promise.resolve(1), { then: () => undefined }, deep, wide, "a".repeat((1 << 20) + 1)];
    for (const [i, v] of unchecked.entries()) expect(holdsSecret(v, sk), `case ${i}`).toBe(true);
  });

  it("a tiny test scalar is not matched in decimal (it would match everything)", () => {
    const one = hexToBytes("00".repeat(31) + "01");
    expect(holdsSecret("the 1st of 1000 numbers, 12345678901234567890123456789012345678901234567890", one)).toBe(false);
    expect(holdsSecret("00".repeat(31) + "01", one)).toBe(true);
  });
});

describe("passphrases", () => {
  it("needs 12 code points after NFKC; the strength is a hint only", () => {
    expect(checkPassphrase("eleven char")).toMatchObject({ ok: false, length: 11, strength: 0, issues: expect.arrayContaining(["too-short"]) });
    expect(checkPassphrase("twelve chars")).toMatchObject({ ok: true, length: 12 });
    expect(checkPassphrase("😀".repeat(12))).toMatchObject({ ok: true, length: 12, issues: expect.arrayContaining(["repeats"]) });
    expect(checkPassphrase("ﬁ".repeat(6)).length).toBe(12); // the "fi" ligature is two letters after NFKC
    expect(normalizePassphrase("ﬁ")).toBe("fi");
    expect(normalizePassphrase("café")).toBe("café");
    expect(normalizePassphrase("  spaces kept  ")).toBe("  spaces kept  ");
    expect(checkPassphrase(42 as never)).toMatchObject({ ok: false, length: 0 });
  });

  it("flags weak patterns and grades long mixed phrases higher", () => {
    expect(checkPassphrase("password1234").issues).toEqual(expect.arrayContaining(["common", "sequence"]));
    expect(checkPassphrase("aaaaaaaaaaaa").issues).toEqual(expect.arrayContaining(["one-kind", "repeats"]));
    expect(checkPassphrase("qwertyqwerty").issues).toContain("sequence");
    const weak = checkPassphrase("aaaaaaaaaaaa").strength;
    const strong = checkPassphrase("Velvet-otter 42 sings Loudly!").strength;
    expect(strong).toBeGreaterThan(weak);
    expect(strong).toBe(4);
  });
});

describe("keys", () => {
  it("parses an expert's hex: 0x, spaces, capitals; refuses bad length, 0 and n", () => {
    const sk = secp256k1.utils.randomPrivateKey();
    const hex = bytesToHex(sk);
    for (const form of [hex, hex.toUpperCase(), `0x${hex}`, `0X${hex.toUpperCase()}`, ` ${hex.replace(/(.{8})/g, "$1 ")}\n`]) expect(secretFromHex(form)).toEqual(sk);
    for (const bad of ["", hex.slice(1), `${hex}0`, `${hex.slice(2)}zz`, `0x0x${hex.slice(4)}`]) expect(syncCode(() => secretFromHex(bad))).toBe("invalid-hex");
    expect(syncCode(() => secretFromHex(42 as never))).toBe("invalid-hex");
    expect(syncCode(() => secretFromHex("00".repeat(32)))).toBe("out-of-range");
    expect(syncCode(() => secretFromHex(N))).toBe("out-of-range");
    const nMinus1 = (BigInt(`0x${N}`) - 1n).toString(16);
    expect(secretFromHex(nMinus1)).toEqual(hexToBytes(nMinus1));
  });

  it("draws a uniform secret by rejection, wiping the draws it rejects", () => {
    const draws: Uint8Array[] = [];
    const queue = [new Uint8Array(32), hexToBytes(N), hexToBytes("ff".repeat(32)), hexToBytes("00".repeat(31) + "07")];
    const rng = {
      getRandomValues<T extends ArrayBufferView | null>(a: T): T {
        const next = queue.shift()!;
        (a as unknown as Uint8Array).set(next);
        draws.push(a as unknown as Uint8Array);
        return a;
      },
    };
    const sk = randomSecret(rng);
    expect(bytesToHex(sk)).toBe("00".repeat(31) + "07");
    expect(draws).toHaveLength(4);
    for (const d of draws.slice(0, 3)) expect(d.every((b) => b === 0)).toBe(true);
    const broken = { getRandomValues: <T extends ArrayBufferView | null>(a: T): T => a };
    expect(syncCode(() => randomSecret(broken))).toBe("unsupported");
    expect(isPublicKeyHex(bytesToHex(secp256k1.getPublicKey(randomSecret(crypto), true)))).toBe(true);
  });

  it("accepts only compressed, lowercase public keys that are points", () => {
    const pub = randomPub();
    expect(isPublicKeyHex(pub)).toBe(true);
    for (const bad of [pub.toUpperCase(), pub.slice(2), `04${pub.slice(2)}`, `02${"00".repeat(32)}`, `${pub}00`, 42, null]) expect(isPublicKeyHex(bad)).toBe(false);
  });
});

describe("stored record and backup file parsers", () => {
  const pub = randomPub();
  const record = () => ({
    format: KEY_FORMAT,
    v: 1,
    network: "mainnet",
    pub,
    address: addressOf(pub),
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 600_000, salt: b64(rand(16)) },
    cipher: { name: "AES-GCM", iv: b64(rand(12)), tagLength: 128, aad: keyAad(pub) },
    ct: b64(rand(48)),
    createdAt: 1_795_000_000_000,
    backedUpAt: null as number | null,
    source: "created",
  });
  const file = () => ({
    format: BACKUP_FORMAT,
    v: 1,
    network: "mainnet",
    pub,
    address: addressOf(pub),
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 600_000, salt: b64(rand(16)) },
    cipher: { name: "AES-GCM", iv: b64(rand(12)), tagLength: 128, aad: backupAad(pub) },
    ct: b64(rand(48)),
    createdAt: "2026-11-22T10:00:00.000Z",
    howToDecrypt: "recipe",
  });

  it("a record is checked field by field and against itself", () => {
    expect(parseKeyRecord(record(), 600_000)).toMatchObject({ pub, source: "created", backedUpAt: null });
    expect(parseKeyRecord({ ...record(), backedUpAt: 5 }, 600_000)?.backedUpAt).toBe(5);
    const r = record();
    const bad: unknown[] = [
      null,
      [],
      { ...r, format: "basis-sandbox-key" },
      { ...r, v: 2 },
      { ...r, network: "testnet" },
      { ...r, pub: randomPub() },
      { ...r, address: addressOf(randomPub()) },
      { ...r, kdf: { ...r.kdf, iterations: 599_999 } },
      { ...r, kdf: { ...r.kdf, iterations: KDF_MAX_ITERATIONS + 1 } },
      { ...r, kdf: { ...r.kdf, hash: "SHA-1" } },
      { ...r, kdf: { ...r.kdf, salt: b64(rand(8)) } },
      { ...r, cipher: { ...r.cipher, aad: backupAad(pub) } },
      { ...r, cipher: { ...r.cipher, iv: b64(rand(16)) } },
      { ...r, cipher: { ...r.cipher, tagLength: 96 } },
      { ...r, ct: b64(rand(32)) },
      { ...r, createdAt: -1 },
      { ...r, createdAt: "today" },
      { ...r, backedUpAt: "yes" },
      { ...r, source: "magic" },
    ];
    for (const [i, x] of bad.entries()) expect(parseKeyRecord(x, 600_000), `case ${i}`).toBeNull();
  });

  it("a backup file is checked before any work; sandbox files and other networks are refused", () => {
    expect(parseBackup(JSON.stringify(file()), 600_000)).toMatchObject({ pub, createdAt: "2026-11-22T10:00:00.000Z", howToDecrypt: "recipe" });
    const f = file();
    const bad: unknown[] = [
      "",
      "x".repeat(300 * 1024),
      "[]",
      JSON.stringify({ ...f, format: "basis-sandbox-key-backup" }),
      JSON.stringify({ ...f, format: KEY_FORMAT }),
      JSON.stringify({ ...f, v: 2 }),
      JSON.stringify({ ...f, network: "testnet" }),
      JSON.stringify({ ...f, pub: f.pub.toUpperCase() }),
      JSON.stringify({ ...f, address: addressOf(randomPub()) }),
      JSON.stringify({ ...f, kdf: { ...f.kdf, iterations: 1000 } }),
      JSON.stringify({ ...f, cipher: { ...f.cipher, aad: keyAad(pub) } }),
      JSON.stringify({ ...f, ct: b64(rand(47)) }),
      JSON.stringify({ ...f, createdAt: "not a date" }),
      42,
    ];
    for (const [i, x] of bad.entries()) expect(syncCode(() => parseBackup(x, 600_000)), `case ${i}`).toBe("bad-backup");
    // a weaker work factor is fine for a vault that accepts it (tests), never above the ceiling
    expect(syncCode(() => parseBackup(JSON.stringify({ ...f, kdf: { ...f.kdf, iterations: 1000 } }), 1000))).toBe("ok");
    expect(backupFilename(pub, Date.UTC(2026, 10, 22, 23, 59))).toBe(`basis-mainnet-key-${pub.slice(2, 10)}-2026-11-22.json`);
  });

  it("sealed extras: a well-formed envelope is kept; a malformed one becomes null and the key still parses", () => {
    const f = file();
    const sealed = { cipher: { name: "AES-GCM", iv: b64(rand(12)), tagLength: 128, aad: extrasAad(pub) }, ct: b64(rand(64)) };
    expect(extrasAad(pub)).toBe(`basis-mainnet-key-backup/v1|${pub}|extras`);
    expect(parseBackup(JSON.stringify({ ...f, extras: sealed }), 600_000).extras).toEqual(sealed);
    expect(parseBackup(JSON.stringify(f), 600_000).extras).toBeUndefined();
    const malformed: unknown[] = [
      { watchedIssuers: [randomPub()] },
      { ...sealed, cipher: { ...sealed.cipher, aad: backupAad(pub) } },
      { ...sealed, cipher: { ...sealed.cipher, iv: b64(rand(8)) } },
      { ...sealed, ct: b64(rand(8)) },
      { ...sealed, ct: "not base64!" },
      { ...sealed, ct: toB64(new Uint8Array(128 * 1024 + 17)) }, // over the plaintext limit
      "x",
      null,
    ];
    for (const [i, x] of malformed.entries()) expect(parseBackup(JSON.stringify({ ...f, extras: x }), 600_000).extras, `case ${i}`).toBeNull();
  });

  it("extras: strict for a new file, lenient (dropped, cut to the limits) for a file being read", () => {
    const keys = Array.from({ length: MAX_WATCHED + 5 }, () => randomPub());
    expect(syncCode(() => checkExtras({ watchedIssuers: keys }, "strict"))).toBe("bad-input");
    expect(checkExtras({ watchedIssuers: keys }, "lenient")!.watchedIssuers).toEqual(keys.slice(0, MAX_WATCHED));
    const contacts = Array.from({ length: MAX_CONTACTS + 1 }, () => ({ pub: randomPub() }));
    expect(checkExtras({ contacts }, "lenient")!.contacts).toHaveLength(MAX_CONTACTS);
    expect(syncCode(() => checkExtras({ contacts: [{ pub: keys[0], name: "x".repeat(MAX_CONTACT_NAME + 1) }] }, "strict"))).toBe("bad-input");
    expect(checkExtras({ contacts: [{ pub: keys[0], name: "   " }] }, "strict")).toEqual({ contacts: [{ pub: keys[0] }] });
    expect(checkExtras({ contacts: [{ pub: keys[0], name: "A" }, { pub: keys[0], name: "B" }] }, "strict")).toEqual({ contacts: [{ pub: keys[0], name: "A" }] });
    expect(checkExtras("x", "lenient")).toBeUndefined();
    expect(checkExtras({ watchedIssuers: "x" }, "lenient")).toBeUndefined();
    expect(checkExtras(undefined, "strict")).toBeUndefined();
    expect(checkExtras({}, "strict")).toEqual({});
  });
});
