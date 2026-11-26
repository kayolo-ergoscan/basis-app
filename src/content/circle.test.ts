// The developer circle's list (circle.json): every entry reads (key, links, lengths, one line, the check date, no
// duplicates), every public key is a point on secp256k1, and each entry's button is the wallet's own request link.
import { describe, expect, it } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import { OUR_TRACKER } from "@/chain/ours/types";
import { MEMO_MAX, NAME_MAX, cleanLabel, labelledRequestLink, openRequest } from "@/features/wallet/mainnet/reqlink";
import { denomOfSlug } from "@/mainnet/tx";
import raw from "./circle.json";
import { CIRCLE, CIRCLE_GITHUB, CIRCLE_LIMITS, circleLink, readCircle, type CircleEntry } from "./circle";

const TODAY = new Date().toISOString().slice(0, 10);
const ORIGIN = "https://basis.ergoscan.me";
// public test keys (secrets 1, 2 and 3): no funds, never used to sign anything here
const K1 = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const K2 = "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5";
const K3 = "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";

const good = (over: Record<string, unknown> = {}) => ({
  name: "Лена",
  project: "ergo-tools",
  url: "https://github.com/example/ergo-tools",
  about: "Утилиты для разработчиков Ergo: разбор боксов и регистров",
  key: K2,
  checked: "2026-11-26",
  ...over,
});
const problemsOf = (list: unknown) => readCircle(list, { today: TODAY }).problems;
const onePoint = (hex: string) => { try { secp256k1.ProjectivePoint.fromHex(hex).assertValidity(); return true; } catch { return false; } };

describe("circle.json", () => {
  it("is an array, and every entry reads with no problem", () => {
    expect(Array.isArray(raw)).toBe(true);
    const r = readCircle(raw, { today: TODAY });
    expect(r.problems).toEqual([]);
    expect(r.entries).toHaveLength((raw as unknown[]).length);
    expect(CIRCLE).toEqual(r.entries);
  });

  it("every key is a point on secp256k1 and not the tracker's own key", () => {
    for (const e of CIRCLE) {
      expect(onePoint(e.key), e.name).toBe(true);
      expect(e.key, e.name).not.toBe(OUR_TRACKER.key);
    }
  });

  it("every entry's button is the wallet's request link, and the wallet reads it back unchanged", () => {
    for (const e of CIRCLE) for (const d of e.denoms) expectWalletLink(e, d);
  });

  it("names the file on the published branch", () => {
    expect(CIRCLE_GITHUB.file).toBe("https://github.com/kayolo-ergoscan/basis-app/blob/main/src/content/circle.json");
    expect(CIRCLE_GITHUB.edit).toBe("https://github.com/kayolo-ergoscan/basis-app/edit/main/src/content/circle.json");
  });
});

function expectWalletLink(e: CircleEntry, d: CircleEntry["denoms"][number]) {
  const denom = denomOfSlug(d)!;
  const req = { to: e.key, amount: null, nft: OUR_TRACKER.nft, ...(denom === "erg" ? {} : { denom }) };
  const link = circleLink(ORIGIN, e, d);
  expect(link).toBe(labelledRequestLink(ORIGIN, req, { name: e.name, memo: e.project }));
  expect(link).not.toMatch(/[\s()]/); // nothing in it breaks a Markdown link
  const o = openRequest(link.slice(link.indexOf("#")));
  expect(o?.req).toEqual(req);
  expect(o?.labels).toEqual({ name: e.name, memo: e.project });
  expect(circleLink("", e, d)).toBe(link.slice(ORIGIN.length));
}

describe("readCircle", () => {
  it("takes a right entry, with the defaults for denoms and readme", () => {
    const r = readCircle([good()], { today: TODAY });
    expect(r.problems).toEqual([]);
    expect(r.entries).toEqual([{ ...good(), denoms: ["erg"], readme: good().url }]);
    const t = readCircle([good({ denoms: ["sigusd", "erg"], readme: "https://example.org/ergo-tools/readme" })], { today: TODAY });
    expect(t.entries[0].denoms).toEqual(["sigusd", "erg"]);
    expect(t.entries[0].readme).toBe("https://example.org/ergo-tools/readme");
  });

  it("refuses anything but an array of objects", () => {
    expect(problemsOf({})).toEqual(["the file must hold a JSON array of entries"]);
    expect(problemsOf([null, "x", []])).toHaveLength(3);
  });

  it("refuses a bad key", () => {
    for (const key of [K2.toUpperCase(), K2.slice(0, 64), "04" + K2.slice(2), K2 + "00", "", 7, undefined]) {
      expect(problemsOf([good({ key })]).join("\n"), String(key)).toMatch(/key: must be a public key/);
    }
    expect(problemsOf([good({ key: OUR_TRACKER.key })]).join("\n")).toMatch(/tracker's own key/);
  });

  it("refuses bad links", () => {
    for (const url of [
      "http://github.com/a/b", "ftp://github.com/a", "javascript:alert(1)", "https://github.com/a b", "github.com/a/b",
      "https://user:pw@github.com/a", "https://github.com:8443/a", "https://127.0.0.1/a", "https://[::1]/a", "https://localhost/a",
      `https://github.com/${"a".repeat(CIRCLE_LIMITS.url)}`, 42,
    ]) {
      expect(problemsOf([good({ url })]).join("\n"), String(url)).toMatch(/^entry 1 \(Лена\): url: /m);
      expect(problemsOf([good({ readme: url })]).join("\n"), String(url)).toMatch(/^entry 1 \(Лена\): readme: /m);
    }
  });

  it("caps the lengths and wants one plain line", () => {
    expect(problemsOf([good({ name: "я".repeat(CIRCLE_LIMITS.name) })])).toEqual([]);
    expect(problemsOf([good({ name: "я".repeat(CIRCLE_LIMITS.name + 1) })]).join()).toMatch(/name: is longer than 24/);
    expect(problemsOf([good({ project: "p".repeat(CIRCLE_LIMITS.project + 1) })]).join()).toMatch(/project: is longer than 40/);
    expect(problemsOf([good({ about: "a".repeat(CIRCLE_LIMITS.about + 1) })]).join()).toMatch(/about: is longer than 100/);
    for (const name of ["", "  ", " Лена", "Лена ", "Ле  на", "Ле\nна", "Ле\tна", "Ле\u202Eна", "Ле\u200Bна", "Ле\u00A0на", "Ле\u0308на" /* ё as е and a combining mark: not NFC */]) {
      expect(problemsOf([good({ name })]).length, JSON.stringify(name)).toBeGreaterThan(0);
    }
  });

  it("the caps fit the request link: a name and a project come back from the link as written", () => {
    expect(CIRCLE_LIMITS.name).toBe(NAME_MAX);
    expect(CIRCLE_LIMITS.project).toBeLessThanOrEqual(MEMO_MAX);
    const e = readCircle([good({ name: "Лена · ergo-tools", project: "ergo-tools (CLI) & co" })], { today: TODAY }).entries[0];
    expect(cleanLabel(e.name, NAME_MAX)).toBe(e.name);
    expect(cleanLabel(e.project, MEMO_MAX)).toBe(e.project);
    expectWalletLink(e, "erg");
  });

  it("builds the link for every denomination the wallet knows", () => {
    const e = readCircle([good({ denoms: ["erg", "sigusd", "rsada"] })], { today: TODAY }).entries[0];
    for (const d of e.denoms) expectWalletLink(e, d);
    expect(circleLink(ORIGIN, e, "sigusd")).toContain("&d=sigusd&");
    expect(circleLink(ORIGIN, e)).not.toContain("&d=");
  });

  it("refuses unknown or repeated denominations, and unknown fields", () => {
    for (const denoms of [[], ["usd"], ["ERG"], ["erg", "erg"], "erg"]) {
      expect(problemsOf([good({ denoms })]).join(), JSON.stringify(denoms)).toMatch(/denoms: /);
    }
    expect(problemsOf([good({ denom: ["erg"] })]).join()).toMatch(/denom: is not a field/);
  });

  it("wants the check date from review: a real day, not before the list began, not in the future", () => {
    for (const checked of [undefined, "", "26.11.2026", "2026-02-30", "2026-11-25", "2999-01-01", 20261126]) {
      expect(problemsOf([good({ checked })]).join(), String(checked)).toMatch(/checked: /);
    }
    // the page itself does not judge by a visitor's clock
    expect(readCircle([good({ checked: "2999-01-01" })]).problems).toEqual([]);
  });

  it("keeps one entry per key and per project link", () => {
    const r = readCircle([good(), good({ url: "https://example.org/other" }), good({ key: K3, url: "https://GitHub.com/example/ergo-tools/" }), good({ key: K1, url: "https://example.org/third" })], { today: TODAY });
    expect(r.entries.map((e) => e.key)).toEqual([K2, K1]);
    expect(r.problems).toEqual([
      "entry 2 (Лена): key: already in entry 1",
      "entry 3 (Лена): url: already in entry 1",
    ]);
  });

  it("the test keys are curve points; a 02-prefixed hex that is not one is caught by the file test", () => {
    for (const k of [K1, K2, K3]) expect(onePoint(k)).toBe(true);
    expect(onePoint("02" + "00".repeat(32))).toBe(false);
  });
});
