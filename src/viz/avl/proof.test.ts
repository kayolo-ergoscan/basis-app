import { beforeAll, describe, expect, it } from "vitest";
import { blake2b256, utf8, type AvlBackend } from "@/protocol";
import { loadErgoAvlBackend, type ErgoAvlMap } from "@/protocol/avl-wasm";
import { digestGlyph } from "./glyph";
import { proofAnatomy, rootMatches } from "./proof";

let backend: AvlBackend;
beforeAll(async () => {
  backend = await loadErgoAvlBackend();
});

const value = (i: number) => new Uint8Array([0, 0, 0, 0, 0, 0, 0, i]);

describe("AVL proof anatomy (real Ergo AVL+)", () => {
  it("recomputes the committed root label from a lookup proof, like the verifier", () => {
    const m = backend.createMap(32);
    for (let i = 0; i < 12; i++) m.insert(blake2b256(utf8(`k${i}`)), value(i));
    const key = blake2b256(utf8("k5"));
    const proof = m.proofFor(key);
    const a = proofAnatomy(proof, backend);
    expect(a.format).toBe("ergo-avl");
    expect(a.wellFormed).toBe(true);
    expect(rootMatches(a, m.digest())).toBe(true);
    expect(backend.verifier!.lookup(m.digest(), key, proof)).toEqual(value(5));
    expect(a.segments.reduce((s, x) => s + x.length, 0)).toBe(proof.length);
  });
  it("proves absence against the same root", () => {
    const m = backend.createMap(32);
    for (let i = 0; i < 5; i++) m.insert(blake2b256(utf8(`k${i}`)), value(i));
    const absent = blake2b256(utf8("nobody"));
    const p = m.proofFor(absent);
    expect(rootMatches(proofAnatomy(p, backend), m.digest())).toBe(true);
    expect(backend.verifier!.lookup(m.digest(), absent, p)).toBeNull();
  });
  it("a flipped label or value byte no longer recomputes the root", () => {
    const m = backend.createMap(32);
    for (let i = 0; i < 9; i++) m.insert(blake2b256(utf8(`k${i}`)), value(i));
    const key = blake2b256(utf8("k3"));
    const proof = m.proofFor(key);
    const a = proofAnatomy(proof, backend);
    const leaf = a.segments.find((s) => s.kind === "leaf")!;
    const bad = proof.slice();
    bad[leaf.from + leaf.length - 1] ^= 1;
    expect(rootMatches(proofAnatomy(bad, backend), m.digest())).toBe(false);
    expect(() => backend.verifier!.lookup(m.digest(), key, bad)).toThrow();
  });
  it("leaf labels match the tree dump", () => {
    const m = backend.createMap(32) as ErgoAvlMap;
    for (let i = 0; i < 4; i++) m.insert(blake2b256(utf8(`k${i}`)), value(i));
    const root = m.prover.dump();
    const leaves: Array<Extract<typeof root, { kind: "leaf" }>> = [];
    const walk = (n: typeof root): void => {
      if (n.kind === "leaf") leaves.push(n);
      else if (n.kind === "internal") {
        walk(n.left);
        walk(n.right);
      }
    };
    walk(root);
    for (const l of leaves) expect(blake2b256(new Uint8Array([0]), l.key, l.value, l.nextKey)).toEqual(l.label);
  });
});

describe("digest glyph", () => {
  it("is deterministic and moves one spoke per changed byte", () => {
    const d = blake2b256(utf8("x"));
    const a = digestGlyph(new Uint8Array([...d, 3]));
    const b = digestGlyph(new Uint8Array([...d, 3]));
    expect(a).toEqual(b);
    const e = new Uint8Array([...d, 3]);
    e[7] ^= 0xff;
    const c = digestGlyph(e);
    expect(c.spokes.filter((s, i) => s.join() !== a.spokes[i].join()).length).toBe(1);
    expect(a.rings.length).toBe(3);
  });
});
