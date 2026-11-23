// The note's microprint (the guilloche line repeated in its art) speaks the page's language, like the face around it:
// «АЛИСА OWES БОБА» on a Russian page mixed two languages.
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addI18n, setLang } from "@/app/lang";
import uiStrings from "../i18n";
import { Note } from "./Note";

beforeAll(() => addI18n(uiStrings));
afterAll(() => setLang("en"));

const art = (html: string) => {
  const live = html.match(/<span class="note-art"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? "";
  return live.replace(/&amp;/g, "&");
};

describe("Note microprint", () => {
  it("is Russian on a Russian page, with the receiver as the face names him", () => {
    setLang("ru");
    const out = art(renderToStaticMarkup(<Note issuer="Алиса" receiver="Боб" amount={1240} live />));
    expect(out).toContain("АЛИСА В ДОЛГУ У БОБА 1240,00 ERG · КЛЮЧ ");
    expect(out).toContain("· ПОДПИСЬ ");
    expect(out).not.toMatch(/OWES|KEY |SIG /);
  });

  it("is English on an English page", () => {
    setLang("en");
    const out = art(renderToStaticMarkup(<Note issuer="Alice" receiver="Bob" amount={1240} live />));
    expect(out).toContain("ALICE OWES BOB 1240.00 ERG · KEY ");
    expect(out).toContain("· SIG ");
  });
});
