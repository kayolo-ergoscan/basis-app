// /tracker pure parts: health bands, updater cycles, the beats window, fee runway, the server-shaped JSON
// printer and its line split, register parts, and the copy rules for every tracker string (EN + RU).
import { describe, expect, it } from "vitest";
import { F64, jsonLines, printJson, tokenizeJson, currentP2s } from "./mirror";
import { avlFlags, bandOf, beatsOf, beatsWindow, BEATS, cycleWithDepth, LATE_BLOCKS, nextCycleAfter, registerParts, SILENT_BLOCKS } from "./model";
import { commitsPerDay, runwayDays } from "./runway";
import strings from "./strings";

describe("health bands", () => {
  it("moves from on time to emergency at the documented ages", () => {
    expect(bandOf(0)).toBe("ontime");
    expect(bandOf(LATE_BLOCKS - 1)).toBe("ontime");
    expect(bandOf(LATE_BLOCKS)).toBe("late");
    expect(bandOf(SILENT_BLOCKS)).toBe("silent");
    expect(bandOf(2159)).toBe("silent");
    expect(bandOf(2160)).toBe("emergency");
  });
});

describe("updater cycles", () => {
  it("aligns the next cycle to the town's genesis", () => {
    expect(nextCycleAfter(100, 100, 5)).toBe(105);
    expect(nextCycleAfter(104, 100, 5)).toBe(105);
    expect(nextCycleAfter(105, 100, 5)).toBe(110);
  });
  it("waits whole cycles until the newest box is deep enough", () => {
    const box = { creationHeight: 100, confirmedHeight: null };
    expect(cycleWithDepth(100, 5, box, 2)).toBe(105);
    expect(cycleWithDepth(101, 5, box, 2)).toBe(101);
    expect(cycleWithDepth(100, 5, { creationHeight: 100, confirmedHeight: 102 }, 2)).toBe(100);
    expect(cycleWithDepth(100, 5, null, 2)).toBe(100);
  });
});

describe("beats window", () => {
  it("keeps only the last 720 blocks, oldest first", () => {
    const rows = [
      { height: 2000, heartbeat: false, seq: 3 },
      { height: 1500, heartbeat: true, seq: 2 },
      { height: 1000, heartbeat: false, seq: 1 },
    ];
    const b = beatsOf(rows, 2000);
    expect(b.map((x) => x.height)).toEqual([1500, 2000]);
    expect(b[0]).toEqual({ index: 1500 - (2000 - BEATS + 1), height: 1500, heartbeat: true });
    expect(b[1]!.index).toBe(BEATS - 1);
  });
  it("starts at genesis while the town is younger than the window", () => {
    // 47 blocks old: every block since genesis, one bar per block
    expect(beatsWindow(1_600_047, 1_600_000, 5)).toEqual({ from: 1_600_000, back: 47, young: true, bucket: 1 });
    // older than 144 blocks: one bar per updater cycle, still from genesis
    expect(beatsWindow(1_600_300, 1_600_000, 5)).toEqual({ from: 1_600_000, back: 300, young: true, bucket: 5 });
    // a full window: the last 720 blocks
    expect(beatsWindow(1_601_000, 1_600_000, 5)).toEqual({ from: 1_601_000 - BEATS + 1, back: BEATS, young: false, bucket: 5 });
    // the window never reaches before genesis, and a bar is at least 4 blocks once bars are cycles
    expect(beatsWindow(1_600_000 + BEATS - 1, 1_600_000, 2)).toEqual({ from: 1_600_000, back: BEATS, young: false, bucket: 4 });
  });
});

describe("fee runway", () => {
  it("counts commitments and redemptions at 0.001 ERG", () => {
    expect(commitsPerDay(600)).toBe(144);
    expect(runwayDays(1.44, 144, 0)).toBeCloseTo(10, 9);
    expect(runwayDays(5, 144, 10)).toBeCloseTo(5 / 0.154, 9);
    expect(runwayDays(5, 0, 0)).toBeNull();
    expect(runwayDays(Number.NaN, 144, 0)).toBeNull();
  });
});

describe("server-shaped JSON", () => {
  it("prints like serde: f64 keeps .0, u64 stays exact, undefined is skipped", () => {
    const s = printJson({ a: new F64(999999), b: 12345678901234567890n, c: undefined, d: [], e: null, f: new F64(1.5) });
    expect(s).toBe('{\n  "a": 999999.0,\n  "b": 12345678901234567890,\n  "d": [],\n  "e": null,\n  "f": 1.5\n}');
  });
  it("splits tokens into lines whose indent rebuilds the text", () => {
    const body = printJson({ data: { key: "ab", n: 3, ok: true, list: [1, { x: null }] }, error: null });
    const lines = jsonLines(tokenizeJson(body));
    const rebuilt = lines.map((l) => " ".repeat(l.ind) + l.toks.map((x) => x.t).join("")).join("\n");
    expect(rebuilt).toBe(body);
    expect(lines.find((l) => l.toks.some((x) => x.k === "key" && x.t === '"key"'))?.ind).toBe(4);
  });
  it("derives the two current reserve addresses from their trees", () => {
    const p = currentP2s();
    expect(p.erg.startsWith("2XoR96")).toBe(true);
    expect(p.token.startsWith("8LeDK9")).toBe(true);
  });
});

describe("tracker box registers", () => {
  it("cuts R5 into type, root, height, flags and lengths", () => {
    const root = "ab".repeat(32);
    const parts = registerParts({ R4: "07" + "02".repeat(33), R5: "64" + root + "04" + "03" + "20" + "00", R6: "0e20" + "cd".repeat(32) });
    expect(parts.R5.map((p) => [p.id, p.hex.length / 2])).toEqual([
      ["type", 1],
      ["root", 32],
      ["height", 1],
      ["flags", 1],
      ["keyLength", 1],
      ["valueLength", 1],
    ]);
    expect(parts.R6.find((p) => p.id === "nft")?.hex).toBe("cd".repeat(32));
    expect(avlFlags("03")).toEqual({ insert: true, update: true, remove: false });
    expect(avlFlags("07")).toEqual({ insert: true, update: true, remove: true });
  });
});

describe("tracker strings", () => {
  const en = strings.en as Record<string, string>;
  const ru = strings.ru as Record<string, string>;
  it("has every key in both languages", () => {
    const base = (k: string) => k.replace(/_(one|few|many|other)$/, "");
    const enBase = new Set(Object.keys(en).map(base));
    const ruBase = new Set(Object.keys(ru).map(base));
    expect([...enBase].filter((k) => !ruBase.has(k))).toEqual([]);
    expect([...ruBase].filter((k) => !enBase.has(k))).toEqual([]);
  });
  it("keeps the copy rules", () => {
    const banned = [/trustless/i, /\bsafe(ly)?\b/i, /guarantee/i, /\blaunched\b/i, /\bofficial\b/i, /\b2\s?%\s?fee/i, /\b7 days\b/i, /bearer/i];
    const bannedRu = [/безопасн/i, /гарант/i, /официальн/i, /7 дней/i, /на предъявителя/i];
    const hits = [
      ...Object.entries(en).filter(([, v]) => banned.some((r) => r.test(v))),
      ...Object.entries(ru).filter(([, v]) => bannedRu.some((r) => r.test(v))),
    ].map(([k]) => k);
    expect(hits).toEqual([]);
  });
  it("never shows a bare hyphen as a minus before a number", () => {
    const hits = Object.entries({ ...en, ...ru }).filter(([, v]) => /(^|[\s(])-\d/.test(v)).map(([k]) => k);
    expect(hits).toEqual([]);
  });
});
