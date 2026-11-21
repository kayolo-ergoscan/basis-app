import { describe, expect, it } from "vitest";
import {
  adaptAvlMap,
  AvlOperationError,
  AvlProofError,
  createAuthenticatedMap,
  describeProof,
  EMPTY_AVL_DIGEST,
  getAvlBackend,
  listAvlBackends,
  onAvlBackendChange,
  setAvlBackend,
  SIMULATED_AVL,
  simulatedVerifier,
  type MinimalAvlMap,
} from "./avl";
import { blake2b256, bytesToHex, utf8 } from "./bytes";
import { ERGO_AVL_WASM } from "./index";
import { EMPTY_AVL_DIGEST_HEX } from "./registers";

const key = (s: string) => blake2b256(utf8(s));
const val = (n: number) => Uint8Array.of(0, 0, 0, 0, 0, 0, n >> 8, n & 0xff);

describe("simulated AuthenticatedMap", () => {
  it("empty digest is the real empty Ergo AVL+ digest", () => {
    expect(bytesToHex(EMPTY_AVL_DIGEST)).toBe(EMPTY_AVL_DIGEST_HEX);
    expect(bytesToHex(SIMULATED_AVL.createMap(32).digest())).toBe(EMPTY_AVL_DIGEST_HEX);
  });

  it("insert / update / insertOrUpdate semantics", () => {
    const m = SIMULATED_AVL.createMap(32);
    m.insert(key("a"), val(1));
    expect(() => m.insert(key("a"), val(2))).toThrow(AvlOperationError);
    expect(() => m.update(key("b"), val(2))).toThrow(AvlOperationError);
    m.update(key("a"), val(3));
    m.insertOrUpdate(key("b"), val(4));
    expect(m.get(key("a"))).toEqual(val(3));
    expect(m.size).toBe(2);
    expect(m.simulated).toBe(true);
    expect(m.digest().length).toBe(33);
    expect(() => m.get(new Uint8Array(31))).toThrow(AvlOperationError);
  });

  it("lookup proofs verify against the digest and catch tampering", () => {
    const m = SIMULATED_AVL.createMap(32);
    for (let i = 0; i < 50; i++) m.insert(key(`k${i}`), val(i));
    const d = m.digest();
    const p = m.proofFor(key("k7"));
    expect(simulatedVerifier.lookup(d, key("k7"), p)).toEqual(val(7));
    expect(simulatedVerifier.lookup(d, key("absent"), m.proofFor(key("absent")))).toBeNull();
    const bad = p.slice();
    bad[bad.length - 1] ^= 1;
    expect(() => simulatedVerifier.lookup(d, key("k7"), bad)).toThrow(AvlProofError);
    const other = SIMULATED_AVL.createMap(32);
    other.insert(key("k7"), val(7));
    expect(() => simulatedVerifier.lookup(other.digest(), key("k7"), p)).toThrow(AvlProofError);
    expect(describeProof(p)!.parts.length).toBe(1);
  });

  it("insert proofs: prove() does not apply, the verifier computes the next digest", () => {
    const m = SIMULATED_AVL.createMap(32);
    m.insert(key("x"), val(1));
    const before = m.digest();
    const r = m.prove([{ op: "insert", key: key("y"), value: val(2) }]);
    expect(m.digest()).toEqual(before);
    const after = simulatedVerifier.insert(before, [[key("y"), val(2)]], r.proof);
    const copy = m.clone();
    copy.insert(key("y"), val(2));
    expect(after).toEqual(copy.digest());
    expect(r.digestAfter).toEqual(copy.digest());
    // inserting an existing key through a proof fails
    const p2 = m.prove([{ op: "lookup", key: key("x") }]).proof;
    expect(() => simulatedVerifier.insert(before, [[key("x"), val(9)]], p2)).toThrow();
    const up = m.prove([{ op: "insertOrUpdate", key: key("x"), value: val(5) }]);
    expect(simulatedVerifier.insertOrUpdate(before, [[key("x"), val(5)]], up.proof)).toEqual(up.digestAfter);
  });

  it("clones are independent", () => {
    const m = SIMULATED_AVL.createMap(32);
    m.insert(key("a"), val(1));
    const c = m.clone();
    c.insert(key("b"), val(2));
    expect(m.size).toBe(1);
    expect(c.size).toBe(2);
    expect(m.digest()).not.toEqual(c.digest());
  });
});

describe("backend registry", () => {
  it("lists the simulated and the WASM backend; switching notifies listeners", () => {
    expect(listAvlBackends()).toEqual(expect.arrayContaining(["simulated", ERGO_AVL_WASM]));
    const seen: string[] = [];
    const off = onAvlBackendChange((b) => seen.push(b.id));
    setAvlBackend(SIMULATED_AVL);
    off();
    expect(seen).toEqual(["simulated"]);
    expect(getAvlBackend().id).toBe("simulated");
    expect(createAuthenticatedMap(32).backend).toBe("simulated");
  });

  it("adaptAvlMap wraps a minimal foreign map; clone replays the op log", () => {
    const factory = (): MinimalAvlMap => {
      const inner = SIMULATED_AVL.createMap(32);
      return {
        get: (k) => inner.get(k),
        insert: (k, v) => inner.insert(k, v),
        update: (k, v) => inner.update(k, v),
        insertOrUpdate: (k, v) => inner.insertOrUpdate(k, v),
        digest: () => inner.digest(),
        proofFor: (k) => inner.proofFor(k),
      };
    };
    const m = adaptAvlMap("foreign", factory, 32);
    m.insert(key("a"), val(1));
    m.insertOrUpdate(key("b"), val(2));
    const c = m.clone();
    expect(c.digest()).toEqual(m.digest());
    c.insert(key("c"), val(3));
    expect(m.size).toBe(2);
    expect(c.size).toBe(3);
    expect(m.backend).toBe("foreign");
  });
});
