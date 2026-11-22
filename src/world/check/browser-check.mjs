// Browser check of the platform contract the world layer relies on, in real Chromium, with no dev server:
// a throwaway http server on 127.0.0.1 (ephemeral port, closed at the end) serves a blank check page and the
// AVL+ wasm (src/protocol/avl-wasm/avl.wasm, and the emitted dist/assets/avl-*.wasm when a build exists) with a
// deliberately wrong MIME type. Two tabs of one browser profile check:
//   Web Locks election (leader / follower / promotion on close), BroadcastChannel order + bigint structured
//   clone, IndexedDB bigint round-trip, localStorage, WebCrypto (random, PBKDF2-SHA256 210 000 + AES-GCM),
//   WebAssembly.compile + instantiate + ABI handshake of the wasm bytes, requestAnimationFrame cadence.
// Usage: nice -n 15 node src/world/check/browser-check.mjs [/root/basis/qa/world]
// Prints JSON; writes browser-check.json and browser-check.png into the output folder. Always closes everything.
import { createServer } from "node:http";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const OUT = process.argv[2] ?? "/root/basis/qa/world";
const APP = "/root/basis/app";
const SRC_WASM = `${APP}/src/protocol/avl-wasm/avl.wasm`;

async function distWasm() {
  try {
    const names = (await readdir(`${APP}/dist/assets`)).filter((n) => /^avl-[\w-]+\.wasm$/.test(n));
    if (!names.length) return null;
    return { name: names[0], bytes: await readFile(`${APP}/dist/assets/${names[0]}`) };
  } catch {
    return null;
  }
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>World browser check</title>
<style>body{font:14px/1.45 system-ui,sans-serif;background:#101317;color:#e8eaed;margin:24px}table{border-collapse:collapse}
td{padding:4px 12px;border-bottom:1px solid #2a2f36;vertical-align:top}.ok{color:#7bd88f}.bad{color:#ff6b6b}h1{font-size:18px}</style>
</head><body><h1>Sandbox world · browser platform check</h1><div id="out">running…</div></body></html>`;

const server = createServer(async (req, res) => {
  try {
    if (req.url === "/" || req.url?.startsWith("/tab")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(PAGE);
    }
    if (req.url === "/favicon.ico") {
      res.writeHead(204);
      return res.end();
    }
    if (req.url === "/src/avl.wasm") {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      return res.end(await readFile(SRC_WASM));
    }
    if (req.url === "/dist/avl.wasm") {
      const d = await distWasm();
      if (!d) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end(d.bytes);
    }
    res.writeHead(404);
    res.end();
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const results = [];
const rec = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail: String(detail) });
const errors = [];

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium-browser", args: ["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 }, colorScheme: "dark" });
  const a = await ctx.newPage();
  const b = await ctx.newPage();
  for (const p of [a, b]) {
    p.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    p.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text().slice(0, 200)}`));
  }
  await a.goto(`${base}/tab/a`);
  await b.goto(`${base}/tab/b`);
  const env = await b.evaluate(() => ({ secure: isSecureContext, locks: !!navigator.locks, bc: typeof BroadcastChannel, idb: typeof indexedDB, subtle: !!crypto.subtle, ua: navigator.userAgent }));
  rec("secure context (127.0.0.1)", env.secure, env.ua.replace(/^.*(Chrome\/[\d.]+).*$/, "$1"));

  // --- Web Locks: the first tab leads, the second follows, and takes over when the first closes ---
  const lockName = "basis-world:town/check";
  const leaderA = await a.evaluate(
    (name) =>
      new Promise((res) => {
        navigator.locks.request(name, { ifAvailable: true }, (lock) => {
          res(!!lock);
          return lock ? new Promise(() => {}) : undefined; // hold while the tab lives
        });
      }),
    lockName,
  );
  const leaderB = await b.evaluate((name) => navigator.locks.request(name, { ifAvailable: true }, (lock) => !!lock), lockName);
  rec("Web Locks: first tab is the leader, second is a follower", leaderA === true && leaderB === false, `a=${leaderA} b=${leaderB}`);
  await b.evaluate((name) => {
    window.__promotedAfter = null;
    const t0 = performance.now();
    navigator.locks.request(name, () => {
      window.__promotedAfter = performance.now() - t0;
      return new Promise(() => {});
    });
  }, lockName);

  // --- BroadcastChannel: order and bigint structured clone ---
  await b.evaluate((name) => {
    window.__got = [];
    const ch = new BroadcastChannel(name);
    ch.onmessage = (e) => window.__got.push(e.data);
  }, lockName);
  await a.evaluate((name) => {
    const ch = new BroadcastChannel(name);
    for (let i = 0; i < 50; i++) ch.postMessage({ t: "events", base: i, events: [{ seq: i, amount: 1_000_000_000n * BigInt(i), big: 2n ** 70n + BigInt(i) }] });
  }, lockName);
  await b.waitForFunction(() => window.__got.length >= 50, null, { timeout: 5000 });
  const bc = await b.evaluate(() => {
    const g = window.__got;
    const ordered = g.every((m, i) => m.base === i);
    const bigints = g.every((m, i) => typeof m.events[0].amount === "bigint" && m.events[0].big === 2n ** 70n + BigInt(i));
    return { n: g.length, ordered, bigints };
  });
  rec("BroadcastChannel: 50 messages in order, bigint survives structured clone", bc.ordered && bc.bigints && bc.n === 50, JSON.stringify(bc));

  // promotion: close the leader tab
  await a.close();
  await b.waitForFunction(() => window.__promotedAfter !== null, null, { timeout: 5000 }).catch(() => {});
  const promoted = await b.evaluate(() => window.__promotedAfter);
  rec("Web Locks: the follower is promoted when the leader tab closes", promoted !== null, promoted === null ? "not promoted" : "promoted");

  // --- IndexedDB and localStorage ---
  const idb = await b.evaluate(
    () =>
      new Promise((resolve) => {
        const r = indexedDB.open("basis-world-check", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("kv");
        r.onerror = () => resolve({ ok: false, err: String(r.error) });
        r.onsuccess = () => {
          const db = r.result;
          const v = { json: '[{"$n":"5"}]', meta: { epoch: "e1", savedEvents: 7, total: 123456789012345678901234567890n } };
          const tx = db.transaction("kv", "readwrite");
          tx.objectStore("kv").put(v, "town/check#000000");
          tx.oncomplete = () => {
            const rt = db.transaction("kv", "readonly").objectStore("kv").get("town/check#000000");
            rt.onsuccess = () => {
              const back = rt.result;
              db.close();
              indexedDB.deleteDatabase("basis-world-check");
              resolve({ ok: back.meta.total === v.meta.total && typeof back.meta.total === "bigint" && back.json === v.json });
            };
          };
        };
      }),
  );
  rec("IndexedDB: chunk put/get, bigint kept", idb.ok, idb.err ?? "");
  const ls = await b.evaluate(() => {
    localStorage.setItem("basis.world.check", JSON.stringify({ label: "SANDBOX KEY · play money only" }));
    const ok = JSON.parse(localStorage.getItem("basis.world.check")).label.startsWith("SANDBOX");
    localStorage.removeItem("basis.world.check");
    return ok;
  });
  rec("localStorage available", ls);

  // --- WebCrypto: the wallet's backup format ---
  const wc = await b.evaluate(async () => {
    const secret = crypto.getRandomValues(new Uint8Array(32));
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const t0 = performance.now();
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode("correct horse battery"), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 210_000 }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const kdfMs = performance.now() - t0;
    const aad = new TextEncoder().encode("basis-sandbox-key-backup/v1");
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, key, secret);
    const pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, key, ct));
    let wrongRejected = false;
    try {
      await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode("other"), tagLength: 128 }, key, ct);
    } catch {
      wrongRejected = true;
    }
    return { roundTrip: pt.every((x, i) => x === secret[i]), wrongRejected, kdfMs: Math.round(kdfMs) };
  });
  rec("WebCrypto: PBKDF2-SHA256 210 000 + AES-GCM round-trip, tampering rejected", wc.roundTrip && wc.wrongRejected, `key derivation ${wc.kdfMs} ms`);

  // --- WebAssembly: the AVL+ module from bytes, whatever the MIME type ---
  const built = await distWasm();
  if (!built) rec("WebAssembly: emitted dist asset", true, "skipped: no dist/assets/avl-*.wasm (no build output yet)");
  for (const [label, path] of [
    ["src/protocol/avl-wasm/avl.wasm served as application/octet-stream", "/src/avl.wasm"],
    ...(built ? [[`emitted dist asset ${built.name} served as text/plain`, "/dist/avl.wasm"]] : []),
  ]) {
    const w = await b.evaluate(async (p) => {
      const res = await fetch(p);
      if (!res.ok) return { skipped: true, status: res.status };
      const bytes = new Uint8Array(await res.arrayBuffer());
      const t0 = performance.now();
      const mod = await WebAssembly.compile(bytes);
      const inst = await WebAssembly.instantiate(mod, {});
      const ms = performance.now() - t0;
      const ex = inst.exports;
      const abi = typeof ex.avl_init === "function" ? ex.avl_init() : null;
      return { bytes: bytes.length, abi, exports: WebAssembly.Module.exports(mod).length, ms: Math.round(ms), mime: res.headers.get("content-type") };
    }, path);
    if (w.skipped) rec(`WebAssembly: ${label}`, true, `skipped (no build output: HTTP ${w.status})`);
    else rec(`WebAssembly: ${label}`, w.abi === 1, `${w.bytes} bytes, ${w.exports} exports, ABI ${w.abi}, compile+instantiate ${w.ms} ms`);
  }
  if (built) {
    const src = await readFile(SRC_WASM);
    rec("dist asset bytes equal the protocol's avl.wasm", Buffer.compare(src, built.bytes) === 0, built.name);
  }

  // --- requestAnimationFrame: the store batches to one notification per frame ---
  const raf = await b.evaluate(
    () =>
      new Promise((resolve) => {
        const ts = [];
        const f = (t) => {
          ts.push(t);
          if (ts.length < 31) requestAnimationFrame(f);
          else resolve(ts.slice(1).map((x, i) => x - ts[i]));
        };
        requestAnimationFrame(f);
      }),
  );
  const mean = raf.reduce((s, x) => s + x, 0) / raf.length;
  rec("requestAnimationFrame runs (frame batching)", raf.length === 30 && mean > 0, `mean frame ${mean.toFixed(1)} ms`);

  // render and screenshot
  await b.evaluate((rows) => {
    const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
    document.getElementById("out").innerHTML = `<table>${rows.map((r) => `<tr><td class="${r.ok ? "ok" : "bad"}">${r.ok ? "pass" : "FAIL"}</td><td>${esc(r.name)}</td><td>${esc(r.detail)}</td></tr>`).join("")}</table>`;
  }, results);
  await mkdir(OUT, { recursive: true });
  await b.screenshot({ path: `${OUT}/browser-check.png`, fullPage: true });
  await ctx.close();
} catch (e) {
  rec("check script", false, e?.stack ?? String(e));
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
const summary = { ok: results.every((r) => r.ok) && errors.length === 0, results, errors, screenshot: `${OUT}/browser-check.png` };
await writeFile(`${OUT}/browser-check.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
