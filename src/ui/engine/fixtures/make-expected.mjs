// Records the reference output of the style tile's engine (design/final/intaglio.js) for the snapshot tests.
// Run once, from /root/basis/app:   node src/ui/engine/fixtures/make-expected.mjs
// It evaluates the tile's own file (our design reference, not downloaded code) and writes expected.json next to it:
// SHA-256 of every SVG string for 16 fixed keys × 6 variants, plus key seals, the brand seal and formatting samples.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync("/root/basis/design/final/intaglio.js", "utf8");
const window = {};
new Function("window", src)(window);
const I = window.Intaglio;
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

const NAMES = ["Alice", "Bob", "Carol", "Dan", "Eve", "render·ai", "search·ai"];
const PK = Object.fromEntries(NAMES.map((n) => [n, I.demoKey(n)]));
const gallery = [["Alice", "Bob"], ["Bob", "Alice"], ["Bob", "Carol"], ["Eve", "Bob"], ["Alice", "render·ai"], ["Carol", "Dan"]];

const keys = [
  new Uint8Array(32),
  new Uint8Array(32).fill(255),
  Uint8Array.from({ length: 32 }, (_, i) => i),
  ...gallery.map(([a, b]) => I.pairKey(PK[a], PK[b])),
  I.blake2b(I.utf8("basis"), 32),
  ...Array.from({ length: 6 }, (_, i) => I.blake2b(I.utf8("basis-snapshot:" + i), 32)),
];

const hashes = {};
keys.forEach((key, i) => {
  const sigA = I.demoSig(I.concat(key, I.utf8("issuer"))), sigT = I.demoSig(I.concat(key, I.utf8("tracker")));
  const micro = (`ALICE OWES BOB 1240.00 ERG · KEY ${I.hex(key)} · SIG ${sigA} · `).repeat(2);
  hashes[`${i}:pair-1`] = sha(I.pairSeal(key, { detail: 1, px: 190 }));
  hashes[`${i}:pair-.6`] = sha(I.pairSeal(key, { detail: 0.6, px: 84 }));
  hashes[`${i}:person`] = sha(I.sealSVG(key, { kind: "person", detail: 0.35 }));
  hashes[`${i}:agent`] = sha(I.sealSVG(key, { kind: "agent", detail: 0.35, px: 56 }));
  hashes[`${i}:noteLite`] = sha(I.noteArt(key, { lite: true, sigA, sigT, uid: "u1" }));
  hashes[`${i}:noteFull`] = sha(I.noteArt(key, { sigA, sigT, micro, uid: "u2" }));
});

const keySeals = {};
for (const n of NAMES) {
  keySeals[n] = sha(I.keySeal(PK[n], { agent: n.endsWith("·ai") }));
  keySeals[n + "@56"] = sha(I.keySeal(PK[n], { agent: n.endsWith("·ai"), px: 56 }));
}
const brand = sha(I.sealSVG(I.blake2b(I.utf8("basis"), 32), { kind: "pair", detail: 0.35, px: 30, inks: { a: { c: "#17171A" }, b: { c: "#4A463F" } } }));
const params = Object.fromEntries(keys.map((k, i) => [i, I.sealParams(k)]));
const money = Object.fromEntries([1240, -320, 0.0004, 1921400, 2575.76, 0, 1e9 + 0.005, 12.6042].map((v) => [String(v), I.money(v, v < 0.01 && v > 0 ? 4 : 2)]));

const out = { source: "design/final/intaglio.js", algo: { seal: "seal@1", note: "note@1" }, keys: keys.map((k) => I.hex(k)), demoKeys: PK, hashes, keySeals, brand, params, money };
writeFileSync(join(here, "expected.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`wrote ${Object.keys(hashes).length} note/seal hashes, ${Object.keys(keySeals).length} key seals → ${join(here, "expected.json")}`);
