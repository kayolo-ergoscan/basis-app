// The inbox (inbox.ts): the token kept in this tab, the tracker's list checked note by note, and the request with a
// mocked fetch (the tracker is never called here).
import { describe, expect, it } from "vitest";
import { bigToBytes } from "@/protocol/bytes";
import { keyPairFromSecret } from "@/protocol/keys";
import { TRACKER_NFT, WALLET_DENOMS, inboxMessage, noteMessage, signBasis, signInbox, verifyBasis, type Denomination } from "@/mainnet/tx";
import { bytesToHex } from "@/protocol/bytes";
import { INBOX_TOKEN_KEY, dropToken, dropTokensExcept, inboxUntil, parseInbox, payersOf, probeInbox, readInbox, readToken, saveToken } from "./inbox";

const key = (s: bigint) => ({ secret: bigToBytes(s, 32), pub: keyPairFromSecret(s).pubHex });
const ME = key(3n);
const A = key(2n);
const B = key(5n);
const NOW_MS = 1_795_400_000_000;
const NOW_S = NOW_MS / 1000;
const TOKEN_DENOM = WALLET_DENOMS[1] as Denomination;

class MemStore implements Storage {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}

/** A stored note as the tracker serializes it, signed by `issuer` (or not, with `forge`). */
function note(issuer: typeof A, o: { to?: string; total?: bigint; ts?: number; denom?: string; forge?: boolean; committed?: boolean } = {}): string {
  const to = o.to ?? ME.pub, total = o.total ?? 500_000_000n, ts = BigInt(o.ts ?? NOW_MS - 3_600_000), denom = (o.denom ?? "erg") as Denomination;
  const sig = signBasis(noteMessage({ issuer: issuer.pub, recipient: to, totalDebt: o.forge ? total + 1n : total, timestamp: ts, trackerNft: TRACKER_NFT, denomination: denom }), issuer.secret, issuer.pub);
  const confirmation = o.committed
    ? `,"confirmation":{"status":"confirmed","confirmed_total_debt":${total},"pending_total_debt":null,"confirmed_box_id":"${"b2".repeat(32)}","confirmed_height":1923400,"pending_tx_id":null,"redeemable":true,"redeemable_amount":${total}}`
    : "";
  return `{"issuer_pubkey":"${issuer.pub}","recipient_pubkey":"${to}","amount_collected":${total},"amount_redeemed":0,"timestamp":${ts},"signature":"${bytesToHex(sig)}","tracker_nft_id":"${TRACKER_NFT}","denomination":"${denom}"${confirmation}}`;
}
const answer = (notes: string[]) => `{"success":true,"data":[${notes.join(",")}],"error":null}`;

describe("the inbox token", () => {
  it("keeps only until and the signature, per key, while it is valid", () => {
    const s = new MemStore();
    const token = signInbox(ME.secret, ME.pub, TRACKER_NFT, inboxUntil(NOW_MS, NOW_MS)!);
    expect(token.until).toBe(String(NOW_S + 12 * 3600));
    saveToken(ME.pub, token, s);
    expect([...s.m.keys()]).toEqual([`${INBOX_TOKEN_KEY}.${ME.pub}`]);
    expect(JSON.parse(s.m.get(`${INBOX_TOKEN_KEY}.${ME.pub}`)!)).toEqual({ until: token.until, sig: token.sig });
    expect(readToken(ME.pub, NOW_S, s)).toEqual(token);
    expect(readToken(A.pub, NOW_S, s)).toBeNull();
    // nearly expired, expired: dropped
    expect(readToken(ME.pub, NOW_S + 12 * 3600 - 60, s)).toBeNull();
    expect(s.m.size).toBe(0);
  });

  it("drops what it cannot read", () => {
    const s = new MemStore();
    const k = `${INBOX_TOKEN_KEY}.${ME.pub}`;
    for (const bad of ["x", "{}", `{"until":"1","sig":"${"0".repeat(130)}"}`, `{"until":"${NOW_S + 3600}","sig":"zz"}`, `{"until":"${NOW_S + 3600}","sig":"${"a".repeat(130)}","secret":"1"}`, `{"until":"${NOW_S + 3 * 86400}","sig":"${"a".repeat(130)}"}`]) {
      s.setItem(k, bad);
      expect(readToken(ME.pub, NOW_S, s)).toBeNull();
      expect(s.getItem(k)).toBeNull();
    }
    saveToken(ME.pub, { until: String(NOW_S + 3600), sig: "a".repeat(130) }, s);
    dropToken(ME.pub, s);
    expect(s.m.size).toBe(0);
    // no storage at all (private mode): nothing kept, nothing thrown
    expect(readToken(ME.pub, NOW_S, null)).toBeNull();
    expect(() => saveToken(ME.pub, { until: "1", sig: "a" }, null)).not.toThrow();
  });

  it("is this key's signature over the inbox message for our tracker", () => {
    const token = signInbox(ME.secret, ME.pub, TRACKER_NFT, inboxUntil(NOW_MS, NOW_MS)!);
    expect(verifyBasis(ME.pub, inboxMessage(TRACKER_NFT, ME.pub, BigInt(token.until)), token.sig)).toBe(true);
    expect(verifyBasis(ME.pub, inboxMessage("5a".repeat(32), ME.pub, BigInt(token.until)), token.sig)).toBe(false);
  });

  it("valid_until: the earlier of the two clocks (the server's at most 5 minutes ahead), none past an hour apart", () => {
    const at = (serverMs: number, localMs: number) => inboxUntil(serverMs, localMs);
    expect(at(NOW_MS, NOW_MS)).toBe(BigInt(NOW_S + 12 * 3600));
    // the server behind the device: the server's time
    expect(at(NOW_MS - 600_000, NOW_MS)).toBe(BigInt(NOW_S - 600 + 12 * 3600));
    // the server ahead of the device: at most 5 minutes of it
    expect(at(NOW_MS + 120_000, NOW_MS)).toBe(BigInt(NOW_S + 120 + 12 * 3600));
    expect(at(NOW_MS + 1_800_000, NOW_MS)).toBe(BigInt(NOW_S + 300 + 12 * 3600));
    expect(at(NOW_MS + 3_600_000, NOW_MS)).toBe(BigInt(NOW_S + 300 + 12 * 3600));
    // more than an hour apart, either way: nothing is signed
    expect(at(NOW_MS + 3_600_001, NOW_MS)).toBeNull();
    expect(at(NOW_MS - 3_600_001, NOW_MS)).toBeNull();
    expect(at(Number.NaN, NOW_MS)).toBeNull();
  });

  it("all tokens but the key's own go when the key changes, every one when it is wiped", () => {
    const s = new MemStore();
    const t = { until: String(NOW_S + 3600), sig: "a".repeat(130) };
    saveToken(ME.pub, t, s);
    saveToken(A.pub, t, s);
    s.setItem("basis.theme", "cotton");
    dropTokensExcept(ME.pub, s);
    expect([...s.m.keys()].sort()).toEqual([`${INBOX_TOKEN_KEY}.${ME.pub}`, "basis.theme"].sort());
    dropTokensExcept(null, s);
    expect([...s.m.keys()]).toEqual(["basis.theme"]);
    expect(() => dropTokensExcept(null, null)).not.toThrow();
  });
});

describe("the tracker's list", () => {
  it("shows the notes that check out, newest first, and counts the rest", () => {
    const text = answer([
      note(A, { ts: NOW_MS - 7_200_000 }),
      note(B, { denom: TOKEN_DENOM, total: 2500n, ts: NOW_MS - 600_000, committed: true }),
      note(B, { to: A.pub }), // to another key
      note(A, { forge: true, denom: TOKEN_DENOM }), // the signature covers another total
      note(A, { denom: `token:${"7c".repeat(32)}` }), // a token this wallet does not know
      note(A, { ts: NOW_MS + 3_600_000 }), // dated after the tracker's clock (and a second ERG note of A)
      `{"issuer_pubkey":"zz"}`,
    ]);
    const r = parseInbox(text, ME.pub, NOW_MS)!;
    expect(r.items.map((x) => [x.issuer, x.denom, x.view.total, x.view.stage])).toEqual([
      [B.pub, TOKEN_DENOM, 2500n, "committed"],
      [A.pub, "erg", 500_000_000n, "local"],
    ]);
    expect(r.items[0].view.redeemableNow).toBe(2500n);
    expect(r.refused).toBe(5);
    expect(payersOf(r.items)).toEqual([{ pk: B.pub, denoms: [TOKEN_DENOM] }, { pk: A.pub, denoms: ["erg"] }]);
  });

  it("one payer in two denominations is one payer", () => {
    const r = parseInbox(answer([note(A), note(A, { denom: TOKEN_DENOM, total: 100n })]), ME.pub, NOW_MS)!;
    expect(r.refused).toBe(0);
    expect(payersOf(r.items)).toEqual([{ pk: A.pub, denoms: ["erg", TOKEN_DENOM] }]);
  });

  it("an empty list, and answers that are no list", () => {
    expect(parseInbox(answer([]), ME.pub, NOW_MS)).toEqual({ items: [], refused: 0 });
    expect(parseInbox(`{"success":false,"data":null,"error":"no"}`, ME.pub, NOW_MS)).toBeNull();
    expect(parseInbox(`{"success":true,"data":{}}`, ME.pub, NOW_MS)).toBeNull();
    expect(parseInbox("<html>", ME.pub, NOW_MS)).toBeNull();
  });
});

describe("the request", () => {
  const queue = { wait: async () => {} };
  type Seen = { url: string; headers: Record<string, string>; credentials?: string; method?: string };
  const fake = (status: number, body: string, seen: Seen[] = []) => {
    const f = async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) }, credentials: init?.credentials, method: init?.method });
      return new Response(body, { status, headers: { "content-type": "application/json" } });
    };
    return f as typeof fetch;
  };
  const token = { until: String(NOW_S + 3600), sig: "ab".repeat(65) };

  it("carries the two headers to the recipient route, and nothing else of the key", async () => {
    const seen: Seen[] = [];
    const r = await readInbox(ME.pub, token, NOW_MS, { fetchImpl: fake(200, answer([note(A)]), seen), queue });
    expect(r.kind).toBe("list");
    expect(seen).toEqual([{ url: `/api/tracker/notes/recipient/${ME.pub}`, method: "GET", credentials: "omit", headers: { Accept: "application/json", "X-Basis-Inbox-Until": token.until, "X-Basis-Inbox-Sig": token.sig } }]);
  });

  it("401 and 404 close it quietly; 429 is busy; others fail", async () => {
    expect(await readInbox(ME.pub, token, NOW_MS, { fetchImpl: fake(401, `{"success":false,"data":null,"error":"the inbox signature has expired"}`), queue })).toEqual({ kind: "closed", status: 401, reason: "the inbox signature has expired" });
    expect(await readInbox(ME.pub, token, NOW_MS, { fetchImpl: fake(401, "<html>"), queue })).toEqual({ kind: "closed", status: 401, reason: null });
    expect(await readInbox(ME.pub, token, NOW_MS, { fetchImpl: fake(404, `{"success":false,"data":null,"error":"not found"}`), queue })).toEqual({ kind: "closed", status: 404, reason: null });
    expect(await readInbox(ME.pub, token, NOW_MS, { fetchImpl: fake(429, "{}"), queue })).toEqual({ kind: "busy" });
    expect((await readInbox(ME.pub, token, NOW_MS, { fetchImpl: fake(503, "{}"), queue })).kind).toBe("failed");
    expect((await readInbox(ME.pub, token, NOW_MS, { fetchImpl: fake(200, "<html>"), queue })).kind).toBe("failed");
    const down = (async () => { throw new TypeError("network"); }) as unknown as typeof fetch;
    expect(await readInbox(ME.pub, token, NOW_MS, { fetchImpl: down, queue })).toEqual({ kind: "failed", reason: "network" });
    expect((await readInbox("nope", token, NOW_MS, { fetchImpl: fake(200, answer([])), queue })).kind).toBe("failed");
  });

  it("the probe sends a signature no key makes: only 401 is an inbox, 404 none, the rest busy or failed", async () => {
    const seen: Seen[] = [];
    expect(await probeInbox(ME.pub, NOW_MS, { fetchImpl: fake(401, "{}", seen), queue })).toBe("open");
    expect(seen[0].headers["X-Basis-Inbox-Sig"]).toBe("0".repeat(130));
    expect(seen[0].headers["X-Basis-Inbox-Until"]).toBe(String(NOW_S + 60));
    expect(await probeInbox(ME.pub, NOW_MS, { fetchImpl: fake(404, "{}"), queue })).toBe("closed");
    expect(await probeInbox(ME.pub, NOW_MS, { fetchImpl: fake(429, "{}"), queue })).toBe("busy");
    for (const status of [200, 403, 500, 502, 503]) expect(await probeInbox(ME.pub, NOW_MS, { fetchImpl: fake(status, "{}"), queue })).toBe("failed");
    const down = (async () => { throw new TypeError("network"); }) as unknown as typeof fetch;
    expect(await probeInbox(ME.pub, NOW_MS, { fetchImpl: down, queue })).toBe("failed");
  });
});
