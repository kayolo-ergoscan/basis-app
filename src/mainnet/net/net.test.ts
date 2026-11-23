// The wallet's network layer with fake raw clients: problems named as design §6.3 wants, bodies the front would
// refuse never sent, answers kept as text, /v1 pages read strictly. Nothing leaves the process.
import { describe, expect, it } from "vitest";
import { createServerClock } from "../../chain/ours/clock";
import type { RawAnswer, RawOptions } from "../../chain/ours/raw";
import { RESERVE_TEMPLATE_HASH, p2pkTree } from "../tx";
import { p2pkBox } from "../tx/testkit";
import { ISSUER_A, R3_RESERVE_IN, TEXT } from "../tx/fixtures/chain";
import { backoffMs, problemOf, reasonOf } from "./problems";
import { REDEMPTION_TIMEOUT_MS, chainReserveValue, createWalletNet, parseBroadcast, parseMempool, parseUnspentPage, mempoolInflow, type WalletNet } from "./wallet";

const ME = "03" + "ab".repeat(32);
const OTHER = "02" + "cd".repeat(32);
const TX = "5b88633ea0467f2333ce3b5b878d85620341b2984659011dcda27ac700edf518";
const ans = (status: number, text: string, retryAfterMs: number | null = null): RawAnswer => ({ ok: true, status, text, retryAfterMs, sentAt: 0, receivedAt: 1 });
const env = (error: string) => JSON.stringify({ success: false, data: null, error });

describe("problems", () => {
  it("names the front's 429 as busy (Retry-After, else the backoff) and a tracker cap as a cap", () => {
    expect(problemOf("notes", ans(429, env("too many requests, slow down")))).toMatchObject({ kind: "busy", retryInMs: 30_000 });
    expect(problemOf("state", ans(429, env("slow"), 120_000))).toMatchObject({ kind: "busy", retryInMs: 120_000 });
    const cap = problemOf("notes", ans(429, env(`issuer ${ME} already has 50 recipients, the most this tracker accepts per issuer (server.notes_max_recipients_per_issuer = 50)`)));
    expect(cap).toMatchObject({ kind: "cap", status: 429, retryInMs: null });
    expect(cap!.reason).toContain("server.notes_max_recipients_per_issuer");
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(3)).toBe(120_000);
    expect(backoffMs(20)).toBe(600_000);
  });

  it("503 by route: restarting on create, low funds on a build, unavailable elsewhere", () => {
    expect(problemOf("reserves-create", ans(503, env("tracker unavailable, try again shortly")))!.kind).toBe("restarting");
    expect(problemOf("build", ans(503, env("the tracker keeps 0.05 ERG of commit funds; refusing")))!.kind).toBe("low-funds");
    expect(problemOf("build", ans(503, env("Too many outstanding redemption builds; try again shortly.")))!.kind).toBe("unavailable");
    expect(problemOf("state", ans(502, "<html>")))!.toMatchObject({ kind: "unavailable", reason: "" });
  });

  it("409: C8 waiting for the chain (with the tx), a replaced build on submit, the tracker's reason otherwise", () => {
    const c8 = problemOf("build", ans(409, env(`the reserve of issuer ${ME} in erg has redemption ${TX} waiting for the chain; build again once it is confirmed, or once it is dropped (about 10 minutes in no mempool)`)));
    expect(c8).toMatchObject({ kind: "waiting-chain", txId: TX });
    const c8b = problemOf("build", ans(409, env(`reserve ${"7".repeat(64)} has redemption ${TX} waiting for the chain`)));
    expect(c8b).toMatchObject({ kind: "waiting-chain", txId: TX });
    expect(problemOf("submit", ans(409, env("unknown build")))!.kind).toBe("replaced");
    expect(problemOf("notes", ans(409, env("issuer has no active reserve under this tracker")))).toMatchObject({ kind: "conflict", reason: "issuer has no active reserve under this tracker" });
  });

  it("the tracker's build and submit answers about timestamps and broadcasts, in its exact words (8f8fb76)", () => {
    const skew = problemOf("build", ans(400, env("request_timestamp 1795000000000 is more than 120 s away from the tracker's clock (1795000300000 ms); sign the request again with the current time")));
    expect(skew).toMatchObject({ kind: "clock-skew", trackerNowMs: 1795000300000 });
    const stale = problemOf("build", ans(409, env("request_timestamp 1795000000000 is not greater than this recipient's previous build request (1795000005000): sign every build request with a new, later timestamp")));
    expect(stale).toMatchObject({ kind: "stale-ts", previousTs: 1795000005000 });
    expect(problemOf("notes", ans(400, env("request_timestamp 1 is more than 120 s away from the tracker's clock (5 ms)")))!.kind).toBe("refused");
    const unknown = problemOf("submit", ans(500, env(`the node did not answer for redemption ${TX}; the tracker watches the chain for it and records it if it is mined. Its reserve builds nothing until then, or until it can no longer be mined`)));
    expect(unknown!.kind).toBe("submit-unknown");
    expect(problemOf("submit", ans(500, env(`the node did not accept redemption ${TX}; build it again with POST /redemption/build`)))!.kind).toBe("not-submitted");
    expect(problemOf("submit", ans(500, env(`the tracker cannot record redemption ${TX}, so it did not submit it; build it again with POST /redemption/build`)))!.kind).toBe("not-submitted");
    expect(problemOf("submit", ans(500, env("something else")))!.kind).toBe("http");
    expect(problemOf("submit", ans(409, env("Unknown, expired or already-used unsigned_tx. Call POST /redemption/build again to obtain a fresh one.")))!.kind).toBe("replaced");
    expect(problemOf("submit", ans(408, "")))!.toMatchObject({ kind: "http", status: 408 });
  });

  it("400: future and past timestamps, other refusals; the reason is cut to 300 characters", () => {
    expect(problemOf("notes", ans(400, env("Future timestamp")))!.kind).toBe("future-ts");
    expect(problemOf("notes", ans(400, env("Past timestamp")))!.kind).toBe("past-ts");
    const long = problemOf("notes", ans(400, env("x".repeat(1000))))!;
    expect(long.kind).toBe("refused");
    expect(long.reason.length).toBe(300);
    expect(reasonOf(`{"error":400,"reason":"Malformed transaction","detail":"Scripts of all transaction inputs should pass verification"}`))
      .toBe("Malformed transaction: Scripts of all transaction inputs should pass verification");
    expect(problemOf("v1", { ok: false, kind: "timeout", message: "x", sentAt: 0 })).toMatchObject({ kind: "timeout", retryInMs: 30_000 });
    expect(problemOf("v1", ans(200, "{}"))).toBeNull();
  });
});

function fakeNet(routes: Record<string, RawAnswer | RawAnswer[]>) {
  const calls: { route: string; o: RawOptions }[] = [];
  const raw = async (route: string, o: RawOptions = {}): Promise<RawAnswer> => {
    calls.push({ route, o });
    const key = Object.keys(routes).find((k) => k === route || (k.endsWith("*") && route.startsWith(k.slice(0, -1))));
    if (!key) return ans(404, env("not found"));
    const a = routes[key];
    return Array.isArray(a) ? (a.length > 1 ? a.shift()! : a[0]) : a;
  };
  const saved: string[] = [];
  const net: WalletNet = createWalletNet({ tracker: { raw, clock: createServerClock() }, v1: { raw }, saveFixture: (n) => saved.push(n) });
  return { net, calls, saved };
}

const v1Box = (b: ReturnType<typeof p2pkBox>, height: number | null, extra = "") =>
  `{"boxId":"${b.boxId}","transactionId":"${b.transactionId}","blockId":"aa","value":"${b.value}","index":${b.index},"globalIndex":1,"creationHeight":${b.creationHeight},` +
  `"settlementHeight":${height ?? "null"},"ergoTree":"${b.ergoTree}","address":"x","assets":[${b.tokens.map((t) => `{"tokenId":"${t.tokenId}","index":0,"amount":"${t.amount}","name":"T","decimals":0,"type":"EIP-004"}`).join(",")}],` +
  `"additionalRegisters":{},"spentTransactionId":null,"mainChain":true${extra}}`;

describe("wallet routes", () => {
  it("POSTs with user priority, refuses bodies the front would refuse, and never re-stringifies", async () => {
    const { net, calls, saved } = fakeNet({ "/notes": ans(201, `{"success":true,"data":null,"error":null}`), "/redemption/build": ans(200, `{"success":true, "data":{"b":1,"a":2}}`) });
    expect(await net.postNote(`{"x":1}`)).toEqual({ ok: true, value: null });
    expect(calls[0]).toMatchObject({ route: "/notes", o: { method: "POST", body: `{"x":1}`, priority: "user" } });
    const big = await net.postNote(`{"x":"${"a".repeat(5000)}"}`);
    expect(big).toMatchObject({ ok: false, problem: { kind: "too-large" } });
    expect(calls).toHaveLength(1);
    const b = await net.build(`{"q":1}`);
    expect(b).toEqual({ ok: true, value: `{"success":true, "data":{"b":1,"a":2}}` });
    expect(saved[0]).toMatch(/^wallet-canary-build-200-\d+\.json$/);
    // a build or submit waits longer than the tracker's own 30 s limit (money P1-2); other routes keep the default
    await net.submit(`{"s":1}`);
    expect(calls.map((c) => [c.route, c.o.timeoutMs])).toEqual([["/notes", undefined], ["/redemption/build", REDEMPTION_TIMEOUT_MS], ["/redemption/submit", REDEMPTION_TIMEOUT_MS]]);
    expect(REDEMPTION_TIMEOUT_MS).toBeGreaterThanOrEqual(35_000);
  });

  it("broadcast: the node's id string is the answer; its error body is the reason", async () => {
    const { net } = fakeNet({ "/node/transactions": [ans(200, `"${TX}"`), ans(400, `{"error":400,"reason":"Double spending attempt","detail":"box spent"}`)] });
    expect(await net.broadcast("{}")).toEqual({ ok: true, value: TX });
    expect(await net.broadcast("{}")).toMatchObject({ ok: false, problem: { kind: "refused", reason: "Double spending attempt: box spent" } });
    expect(parseBroadcast(`"nope"`)).toBeNull();
  });

  it("pair note: text when there is one, null on 404; reserves of a key with exact amounts", async () => {
    const { net } = fakeNet({
      [`/notes/issuer/${ME}/recipient/${OTHER}`]: ans(200, TEXT.frontNote),
      [`/reserves/issuer/${ME}`]: ans(200, `{"success":true,"data":[{"box_id":"${"aa".repeat(32)}","owner_pubkey":"${ME}","collateral_amount":9007199254740993,"total_debt":0,"tracker_nft_id":"f5178dc4063042bdf77cd0f4a55d0893d6dbcf0b3d14eb4de25282b2c4e3f29f","last_updated_height":1,"last_updated_timestamp":1,"collateralization_ratio":null,"refund_initiation_height":0}],"error":null}`),
    });
    expect(await net.pairNote(ME, OTHER)).toEqual({ ok: true, value: TEXT.frontNote });
    expect(await net.pairNote(OTHER, ME)).toEqual({ ok: true, value: null });
    const r = await net.reservesOf(ME);
    expect(r.ok && r.value[0].collateral).toBe(9007199254740993n);
    expect(await net.reservesOf("02abc")).toMatchObject({ ok: false, problem: { kind: "refused" } });
  });

  it("unspent: pages of 50, only confirmed unspent boxes at the key, strictly read", async () => {
    const b1 = p2pkBox(ME, 1_100_000_000n);
    const b2 = p2pkBox(ME, 5_000_000n, { index: 1 });
    const foreign = p2pkBox(OTHER, 7n);
    const page = (items: string[], more: boolean) => `{"items":[${items.join(",")}],"total":3,"offset":0,"limit":50,"hasMore":${more},"nextCursor":null,"source":"indexer"}`;
    const { net, calls } = fakeNet({ "/boxes/unspent/byAddress/*": [ans(200, page([v1Box(b1, 1922300), v1Box(foreign, 1)], true)), ans(200, page([v1Box(b2, 1922301), "{\"broken\":1}"], false))] });
    const r = await net.unspent("9addr", p2pkTree(ME));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.boxes.map((u) => [u.box.boxId, u.height])).toEqual([[b1.boxId, 1922300], [b2.boxId, 1922301]]);
    expect(r.value.boxes[0].box.value).toBe(1_100_000_000n);
    expect(r.value).toMatchObject({ complete: true, skipped: 2 });
    expect(calls.map((c) => c.route)).toEqual(["/boxes/unspent/byAddress/9addr?limit=50", "/boxes/unspent/byAddress/9addr?limit=50&offset=50"]);
    expect(calls.every((c) => c.o.priority === "poll" && c.o.method === "GET")).toBe(true);
    expect(parseUnspentPage("not json", p2pkTree(ME))).toBeNull();
  });

  it("mempool and transaction status", async () => {
    const mem = `{"items":[{"id":"${TX}","inputs":[{"boxId":"${"11".repeat(32)}","address":"9a"}],"outputs":[{"boxId":"${"22".repeat(32)}","value":"1100000000","ergoTree":"${p2pkTree(ME)}","address":"9me"},{"value":1000000,"ergoTree":"1005"}]}],"total":1,"offset":0,"limit":50,"source":"mempool-ram"}`;
    const { net } = fakeNet({
      "/mempool/transactions/byAddress/*": ans(200, mem),
      [`/transactions/${TX}`]: [ans(200, `{"id":"${TX}","inclusionHeight":1922314,"numConfirmations":3}`), ans(404, `{"error":"not_found","status":404}`)],
    });
    const m = await net.mempool("9me");
    expect(m.ok && m.value[0]).toMatchObject({ id: TX, spends: ["11".repeat(32)] });
    if (m.ok) expect(mempoolInflow(m.value[0], p2pkTree(ME), "9me")).toBe(1_100_000_000n);
    expect(await net.txStatus(TX)).toEqual({ ok: true, value: { inclusionHeight: 1922314, confirmations: 3 } });
    expect(await net.txStatus(TX)).toEqual({ ok: true, value: null });
    expect(parseMempool(`{"items":[{"id":"zz"}]}`)).toBeNull();
    // inputs keep their tree and address; R4 in both explorer shapes; no registers = unknown
    const regs = parseMempool(`{"items":[{"id":"${TX}","inputs":[{"boxId":"${"11".repeat(32)}","ergoTree":"ABCD","address":"9a"}],"outputs":[` +
      `{"value":1,"ergoTree":"00","additionalRegisters":{"R4":"07${ME}"}},{"value":2,"ergoTree":"01","additionalRegisters":{"R4":{"serializedValue":"07AB"}}},` +
      `{"value":3,"ergoTree":"02","additionalRegisters":{}},{"value":4,"ergoTree":"03"}]}]}`)!;
    expect(regs[0].inputs).toEqual([{ boxId: "11".repeat(32), ergoTree: "abcd", address: "9a" }]);
    expect(regs[0].outputs.map((o) => o.r4)).toEqual([`07${ME}`, "07ab", null, undefined]);
  });

  it("reserves on chain: the pinned contract under its template, R4 = the owner, R6 = our NFT, ids checked", async () => {
    const unspent = TEXT.r3ReserveIn.replace(/"spentTransactionId":"[0-9a-f]{64}"/, `"spentTransactionId":null`);
    const forged = unspent.replace(`"value":"650000000"`, `"value":"6500000000"`); // its id no longer holds
    const page = (items: string[], more: boolean) => `{"items":[${items.join(",")}],"total":9,"offset":0,"limit":50,"hasMore":${more},"nextCursor":null,"source":"indexer"}`;
    const { net, calls } = fakeNet({ "/boxes/unspent/byErgoTreeTemplateHash/*": ans(200, page([unspent, forged, TEXT.r3ReserveIn], false)) });
    const r = await net.reservesOnChain(ISSUER_A);
    expect(r.ok && r.value).toMatchObject({ complete: true });
    expect(r.ok && r.value.boxes.map((u) => u.box.boxId)).toEqual([R3_RESERVE_IN.boxId]);
    expect(calls[0]).toMatchObject({ route: `/boxes/unspent/byErgoTreeTemplateHash/${RESERVE_TEMPLATE_HASH}?limit=50`, o: { method: "GET", priority: "poll" } });
    expect(chainReserveValue(r.ok ? r.value : null)).toBe(650_000_000n);
    const none = await net.reservesOnChain(OTHER);
    expect(none.ok && none.value.boxes).toEqual([]);
    expect(chainReserveValue(none.ok ? none.value : null)).toBe(0n);
    expect(chainReserveValue(null)).toBe(0n);
    expect(await net.reservesOnChain("02ab")).toMatchObject({ ok: false, problem: { kind: "refused" } });
    // more reserves than four pages: a missing one is no proof
    const many = fakeNet({ "/boxes/unspent/byErgoTreeTemplateHash/*": ans(200, page([], true)) });
    expect(await many.net.reservesOnChain(ISSUER_A)).toEqual({ ok: true, value: { boxes: [], complete: false } });
    expect(many.calls).toHaveLength(4);
  });

  it("box: re-read from the chain with its spender", async () => {
    const { net } = fakeNet({ "/boxes/*": ans(200, TEXT.r3ReserveIn) });
    const id = JSON.parse(TEXT.r3ReserveIn).boxId as string;
    const r = await net.box(id);
    expect(r.ok && r.value.box.boxId).toBe(id);
    expect(r.ok && r.value.text).toBe(TEXT.r3ReserveIn);
    expect(await net.box("11".repeat(32))).toMatchObject({ ok: false, problem: { kind: "shape" } });
  });

  it("reserve by NFT: the one unspent box that holds it, any tree, id checked; none, two, or a forged one", async () => {
    const unspent = TEXT.r3ReserveIn.replace(/"spentTransactionId":"[0-9a-f]{64}"/, `"spentTransactionId":null`);
    const nft = R3_RESERVE_IN.tokens[0].tokenId;
    const page = (items: string[], more = false) => `{"items":[${items.join(",")}],"total":${items.length},"offset":0,"limit":5,"hasMore":${more}}`;
    const one = fakeNet({ "/boxes/unspent/byTokenId/*": ans(200, page([unspent])) });
    const r = await one.net.reserveByNft(nft);
    expect(r.ok && r.value?.box.boxId).toBe(R3_RESERVE_IN.boxId);
    expect(one.calls[0]).toMatchObject({ route: `/boxes/unspent/byTokenId/${nft}?limit=5`, o: { method: "GET" } });
    expect(await fakeNet({ "/boxes/unspent/byTokenId/*": ans(200, page([])) }).net.reserveByNft(nft)).toEqual({ ok: true, value: null });
    expect(await fakeNet({ "/boxes/unspent/byTokenId/*": ans(404, "") }).net.reserveByNft(nft)).toEqual({ ok: true, value: null });
    expect(await fakeNet({ "/boxes/unspent/byTokenId/*": ans(200, page([unspent, unspent])) }).net.reserveByNft(nft)).toMatchObject({ ok: false, problem: { kind: "shape" } });
    const forged = unspent.replace(`"value":"650000000"`, `"value":"6500000000"`);
    expect(await fakeNet({ "/boxes/unspent/byTokenId/*": ans(200, page([forged])) }).net.reserveByNft(nft)).toMatchObject({ ok: false, problem: { kind: "shape" } });
    expect(await one.net.reserveByNft("zz")).toMatchObject({ ok: false, problem: { kind: "refused" } });
  });
});
