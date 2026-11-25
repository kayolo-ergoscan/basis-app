// The seed-phrase import (seed.ts): BIP39 words → BIP32 along EIP-3's m/44'/429'/0'/0/i, checked against vectors from
// two implementations outside the app (ergo-lib-wasm-nodejs 0.28.0 and @fleet-sdk/wallet 0.12.0, equal on every
// value; seed-vectors.json, made by /root/basis/qa/seed-import-2026-11-25/make-vectors.mjs). Every phrase there is a
// throwaway test phrase from fresh random entropy.
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { describe, expect, it } from "vitest";
import { p2pkAddress } from "../../../chain/decode";
import { checkMnemonic, deriveSecretAt, normalizeMnemonic, SEED_MAX_INDEX, seedFromMnemonic, seedKeys, seedSecret } from "../seed";
import V from "./seed-vectors.json";

interface Vec { note: string; words: number; mnemonic: string; password: string; seed: string; keys: { index: number; secret: string; pub: string; address: string }[] }
const VECTORS = V.vectors as Vec[];
const H = 0x80000000;
const byNote = (s: string) => VECTORS.find((v) => v.note.startsWith(s))!;

describe("seed import: vectors from two other implementations", () => {
  it("has every word count, passwords, the leading-zero cases and BIP32 vector 2", () => {
    expect(new Set(VECTORS.map((v) => v.words))).toEqual(new Set([12, 15, 18, 21, 24]));
    expect(VECTORS.some((v) => v.password && v.password !== v.password.normalize("NFKD"))).toBe(true);
    expect(VECTORS.some((v) => v.note.startsWith("hardened parent"))).toBe(true);
    expect(VECTORS.some((v) => v.keys.some((k) => k.secret.startsWith("00")))).toBe(true);
    expect(V.bip32tv2.levels).toHaveLength(6);
  });

  for (const v of VECTORS) {
    it(`${v.note}: the seed, and each key's secret, public key and address`, async () => {
      expect(checkMnemonic(v.mnemonic)).toEqual({ ok: true, phrase: v.mnemonic, count: v.words });
      const seed = await seedFromMnemonic(v.mnemonic, v.password);
      expect(bytesToHex(seed)).toBe(v.seed);
      for (const k of v.keys) {
        expect(seedKeys(seed, k.index, 1)).toEqual([{ index: k.index, pub: k.pub, address: k.address }]);
        const sk = seedSecret(seed, k.index);
        expect(sk.length).toBe(32);
        expect(bytesToHex(sk)).toBe(k.secret);
        expect(bytesToHex(secp256k1.getPublicKey(sk, true))).toBe(k.pub);
        expect(p2pkAddress(k.pub)).toBe(k.address);
      }
    });
  }

  it("BIP32 test vector 2, every level (soft and hardened steps, the spec's own seed)", () => {
    const seed = hexToBytes(V.bip32tv2.seed);
    const path: number[] = [];
    for (const l of V.bip32tv2.levels) {
      if (l.path !== "m") {
        const c = l.path.split("/").pop()!;
        path.push(c.endsWith("'") ? H + Number(c.slice(0, -1)) : Number(c));
      }
      const r = deriveSecretAt(seed, path);
      expect([l.path, bytesToHex(r.secret), bytesToHex(r.chain)]).toEqual([l.path, l.secret, l.chain]);
      expect(bytesToHex(secp256k1.getPublicKey(r.secret, true))).toBe(l.pub);
    }
  });
});

describe("seed import: the words", () => {
  const v12 = byNote("12 words, no password");
  const w = v12.mnemonic.split(" ");

  it("tolerates extra spaces, tabs, line breaks, no-break and zero-width spaces, and capitals; NFKD", async () => {
    const messy = `  ${w.slice(0, 4).join("  ").toUpperCase()}\n${w.slice(4, 8).join("\t")}\r\n ${w.slice(8, 11).join(" ")}​ ${w[11][0].toUpperCase()}${w[11].slice(1)}  \n`;
    expect(normalizeMnemonic(messy)).toBe(v12.mnemonic);
    expect(checkMnemonic(messy)).toMatchObject({ ok: true, phrase: v12.mnemonic, count: 12 });
    expect(bytesToHex(await seedFromMnemonic(messy, ""))).toBe(v12.seed);
    // full-width letters fold to ASCII under NFKD (compatibility forms)
    expect(normalizeMnemonic(w.map((x) => [...x].map((ch) => String.fromCharCode(ch.charCodeAt(0) + 0xfee0)).join("")).join(" "))).toBe(v12.mnemonic);
  });

  it("refuses: nothing, an unknown word (by its number), a wrong count, a bad checksum", () => {
    expect(checkMnemonic("")).toEqual({ ok: false, reason: "empty" });
    expect(checkMnemonic(" \n\t ")).toEqual({ ok: false, reason: "empty" });
    // the first word outside the English list, counted from 1, before the count is looked at
    expect(checkMnemonic([...w.slice(0, 4), "basis", ...w.slice(5)].join(" "))).toEqual({ ok: false, reason: "word", at: 5 });
    expect(checkMnemonic([...w.slice(0, 11), w[11] + "x"].join(" "))).toEqual({ ok: false, reason: "word", at: 12 });
    expect(checkMnemonic(["1.", ...w].join(" "))).toEqual({ ok: false, reason: "word", at: 1 });
    expect(checkMnemonic(w.slice(0, 7).join(" ") + " ünïcödé")).toEqual({ ok: false, reason: "word", at: 8 });
    for (const n of [1, 11, 13, 14, 16, 23, 25]) {
      const words = Array.from({ length: n }, (_, i) => w[i % 12]);
      expect(checkMnemonic(words.join(" "))).toEqual({ ok: false, reason: "count", count: n });
    }
    // every length: words 1 and 2 swapped, and the last word replaced, break the checksum (checked with @scure/bip39
    // 1.6.0 outside the app)
    for (const n of [12, 15, 18, 21, 24]) {
      const x = VECTORS.find((y) => y.words === n)!.mnemonic.split(" ");
      expect(checkMnemonic([x[1], x[0], ...x.slice(2)].join(" "))).toEqual({ ok: false, reason: "checksum" });
      expect(checkMnemonic([...x.slice(0, -1), "abandon"].join(" "))).toEqual({ ok: false, reason: "checksum" });
    }
  });

  it("derives nothing from words that do not pass", async () => {
    await expect(seedFromMnemonic(w.slice(0, 11).join(" "), "")).rejects.toMatchObject({ code: "bad-input" });
    await expect(seedFromMnemonic([w[1], w[0], ...w.slice(2)].join(" "), "")).rejects.toMatchObject({ code: "bad-input" });
  });
});

describe("seed import: the mnemonic password", () => {
  const none = byNote("12 words, no password (pair");
  const ascii = byNote("same 12 words, ASCII password");
  const uni = byNote("same 12 words, non-ASCII password");

  it("changes every key; the same words and password always give the same keys", () => {
    expect(ascii.mnemonic).toBe(none.mnemonic);
    expect(uni.mnemonic).toBe(none.mnemonic);
    const pubs = (v: Vec) => v.keys.map((k) => k.pub);
    for (const [a, b] of [[none, ascii], [none, uni], [ascii, uni]]) {
      expect(a.seed).not.toBe(b.seed);
      for (const p of pubs(a)) expect(pubs(b)).not.toContain(p);
    }
  });

  it("is taken as typed: NFKD (composed and decomposed forms agree), never trimmed or folded to lower case", async () => {
    const seedOf = async (p: string) => bytesToHex(await seedFromMnemonic(none.mnemonic, p));
    expect(await seedOf(uni.password)).toBe(uni.seed);
    expect(await seedOf(uni.password.normalize("NFD"))).toBe(uni.seed);
    expect(await seedOf(uni.password.normalize("NFKD"))).toBe(uni.seed);
    expect(await seedOf(ascii.password)).toBe(ascii.seed);
    expect(await seedOf(` ${ascii.password}`)).not.toBe(ascii.seed);
    expect(await seedOf(ascii.password.toLowerCase())).not.toBe(ascii.seed);
    expect(await seedOf("")).toBe(none.seed);
  });
});

describe("seed import: addresses 0–49", () => {
  it("lists exactly indexes 0 … 49 in order, public data only, matching the vectors where they have the index", async () => {
    const v = byNote("24 words");
    const seed = await seedFromMnemonic(v.mnemonic, v.password);
    const keys = seedKeys(seed);
    expect(SEED_MAX_INDEX).toBe(50);
    expect(keys.map((k) => k.index)).toEqual([...Array(50).keys()]);
    for (const k of keys) expect(Object.keys(k).sort()).toEqual(["address", "index", "pub"]);
    expect(new Set(keys.map((k) => k.pub)).size).toBe(50);
    for (const k of v.keys) expect(keys[k.index]).toEqual({ index: k.index, pub: k.pub, address: k.address });
    // a later window is the same as the full list
    expect(seedKeys(seed, 45, 5)).toEqual(keys.slice(45));
    // the secret of none of them is in what was listed
    const listed = JSON.stringify(keys);
    for (const k of v.keys) expect(listed).not.toContain(k.secret);
    expect(listed).not.toContain(v.seed);
  });

  it("refuses an index outside 0–49 and a malformed seed", async () => {
    const v = byNote("12 words, no password");
    const seed = await seedFromMnemonic(v.mnemonic, "");
    expect(() => seedKeys(seed, 0, 51)).toThrow(/address index/);
    expect(() => seedKeys(seed, 50, 1)).toThrow(/address index/);
    expect(() => seedKeys(seed, -1, 1)).toThrow(/address index/);
    expect(() => seedSecret(seed, 50)).toThrow(/address index/);
    expect(() => seedSecret(seed, 1.5)).toThrow(/address index/);
    expect(() => seedKeys(new Uint8Array(8))).toThrow(/16 to 64 bytes/);
    expect(() => deriveSecretAt(seed, [2 ** 32])).toThrow(/32-bit/);
  });
});
