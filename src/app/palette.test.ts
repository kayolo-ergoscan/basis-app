// The ⌘K bar answers questions: every FAQ question is a command (→ /learn/faq#q-<id>, which opens that answer) in the
// «Вопросы»/Questions group, found by the words people type in either language («кошельки», «потерять», "real ERG").
import { describe, expect, it } from "vitest";
import { faq } from "@/content";
import overlaysSrc from "./overlays.tsx?raw";
import { faqCommands, score } from "./commands";
import i18n from "./i18n";

const best = (q: string, lang: "en" | "ru") =>
  faqCommands(faq, lang).map((c) => [c, score(c, q)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([c]) => c.to);

describe("⌘K finds FAQ questions", () => {
  it("every question is a command that opens its answer, labelled in the reader's language", () => {
    for (const lang of ["en", "ru"] as const) {
      const cmds = faqCommands(faq, lang);
      expect(cmds).toHaveLength(faq.length);
      for (const [i, c] of cmds.entries()) {
        expect(c.to).toBe(`/learn/faq#q-${faq[i].id}`);
        expect(c.group).toBe("faq");
        expect(c.label).toBe(faq[i].q[lang]);
      }
    }
  });

  it("finds the answers people look for, in both languages", () => {
    expect(best("кошельки Ergo", "ru")[0]).toBe("/learn/faq#q-nautilus");
    expect(best("regular Ergo wallets", "en")[0]).toBe("/learn/faq#q-nautilus");
    expect(best("потерять", "ru")).toContain("/learn/faq#q-lose-money");
    expect(best("lose money", "en")[0]).toBe("/learn/faq#q-lose-money");
    expect(best("настоящими ERG", "ru")[0]).toBe("/learn/faq#q-launched");
    expect(best("real ERG", "en")[0]).toBe("/learn/faq#q-launched");
    expect(best("трекер исчезнет", "ru")[0]).toBe("/learn/faq#q-tracker-disappears");
  });

  it("the bar loads the questions lazily, shows them only for a query, and names their group", () => {
    expect(overlaysSrc).toContain('import("@/content/faq")');
    expect(overlaysSrc).toContain('c.group !== "faq"');
    expect(overlaysSrc).toMatch(/const order = \[[^\]]*"faq"[^\]]*\]/);
    expect([i18n.en["app.cmd.group.faq"], i18n.ru["app.cmd.group.faq"]]).toEqual(["Questions", "Вопросы"]);
  });
});
