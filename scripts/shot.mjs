// Screenshot a page of the app. Always closes the browser.
//   node scripts/shot.mjs <path-or-url> <out.png> [desktop|operator|phone|laptop|WxH] [--full] [--light] [--ru] [--wait=1500] [--click=<css>] [--eval=<js>]
// Paths are resolved against the shared dev server http://127.0.0.1:5180 (start it with scripts/dev.sh).
// Prints JSON: page errors, console errors, failed requests, horizontal overflow (scrollWidth > viewport) — all must be empty/false.
import { chromium } from "playwright-core";
const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith("--"));
const flag = (n) => args.find((a) => a === `--${n}` || a.startsWith(`--${n}=`));
const val = (n, d) => { const f = flag(n); return f && f.includes("=") ? f.slice(f.indexOf("=") + 1) : d; };
const [target, out, preset = "desktop"] = pos;
if (!target || !out) { console.error("usage: node scripts/shot.mjs <path> <out.png> [desktop|operator|phone|laptop|WxH] [--full] [--light] [--ru]"); process.exit(2); }
const sizes = { desktop: [1920, 1200, 1], operator: [1771, 891, 1.5], laptop: [1280, 720, 1.5], phone: [390, 844, 2] };
let [W, H, DPR] = sizes[preset] || [...preset.split("x").map(Number), 1];
const url = /^https?:/.test(target) ? target : "http://127.0.0.1:5180" + (target.startsWith("/") ? target : "/" + target);
const b = await chromium.launch({ executablePath: "/usr/bin/chromium-browser", args: ["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const mobile = W <= 480;
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, isMobile: mobile, hasTouch: mobile,
    colorScheme: flag("light") ? "light" : "dark", locale: flag("ru") ? "ru-RU" : "en-US" });
  if (flag("light") || flag("ru")) await ctx.addInitScript(([light, ru]) => { try { if (light) localStorage.setItem("basis.theme", "cotton"); if (ru) localStorage.setItem("basis.lang", "ru"); } catch {} }, [!!flag("light"), !!flag("ru")]);
  const p = await ctx.newPage();
  const errs = [], failed = [];
  p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 300)); });
  p.on("requestfailed", (r) => failed.push(r.url().slice(0, 160) + " " + (r.failure()?.errorText || "")));
  p.on("response", (r) => { if (r.status() >= 400) failed.push(r.status() + " " + r.url().slice(0, 160)); });
  await p.goto(url, { waitUntil: "load", timeout: 60000 });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(+val("wait", 1500));
  const click = val("click"); if (click) { await p.click(click); await p.waitForTimeout(800); }
  const ev = val("eval"); if (ev) { await p.evaluate(ev); await p.waitForTimeout(800); }
  await p.screenshot({ path: out, fullPage: !!flag("full") });
  const m = await p.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: innerWidth, height: document.documentElement.scrollHeight, title: document.title }));
  console.log(JSON.stringify({ out, url, viewport: `${W}x${H}@${DPR}`, overflowX: m.scrollWidth > m.innerWidth + 1, ...m, errors: errs, failed }));
} finally { await b.close(); }
