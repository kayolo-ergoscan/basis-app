// /learn/signature — the 80-byte message, the verifier step by step (tap a byte to tamper), signing with lab keys
// (every nonce retry shown) and the four test vectors from the spec, all in the browser.
import { useMemo } from "react";
import { rich, useT } from "@/app";
import { Callout, Key } from "@/ui";
import { SelfTest, SignLab, SignatureXray, LAB_DEFAULT_TS, LAB_TRACKER_NFT, labKey } from "@/viz";
import { debtKey, erg, noteMessage, sign } from "@/protocol";
import { chapters, faq, pick } from "@/content";
import { BookHead, Fact, Pager, Sec, Side, SourceLinks, Terms, inline, plainTitle, useBookSections } from "../layout";
import { MessageFig } from "../figures/how";

export default function SignaturePage() {
  const t = useT();
  const L = t.lang;
  const ch = chapters.find((c) => c.id === "signatures")!;
  // the FAQ answer is the one place this fact lives; the chapter reads it from there
  const wallets = faq.find((q) => q.id === "nautilus");
  const demo = useMemo(() => {
    const alice = labKey("Alice");
    const msg = noteMessage(debtKey(alice.pub, labKey("Bob").pub), erg("1240"), LAB_DEFAULT_TS, LAB_TRACKER_NFT);
    return { pub: alice.pub, msg, sig: sign(msg, alice) };
  }, []);
  useBookSections([
    { id: "message", label: pick({ en: "What Alice signs", ru: "Что подписывает Алиса" }, L) },
    { id: "xray", label: pick({ en: "Check it by hand", ru: "Проверка вручную" }, L) },
    { id: "sign", label: pick({ en: "Sign it yourself", ru: "Подпишите сами" }, L) },
    { id: "vectors", label: pick({ en: "Test vectors", ru: "Тестовые векторы" }, L) },
    { id: "wallets", label: pick({ en: "Wallets", ru: "Кошельки" }, L) },
  ]);
  return (
    <article>
      <BookHead id="signature" lede={t("learn.sg.lede")} />

      <Sec id="message" first title={rich(t("learn.sg.s.message"))} lede={inline(pick(ch.lede, L))}>
        <Side label={t("learn.words")}><Terms ids={ch.terms} /></Side>
        {ch.body.map((p, i) => <p className="lrn-p" key={i}>{inline(pick(p, L))}</p>)}
        <MessageFig n="1" />
        <Fact text={ch.fact} lines={ch.lines} />
      </Sec>

      <Sec id="xray" title={rich(t("learn.sg.s.xray"))} lede={t("learn.sg.s.xray.lede")} side={<p>{rich(t("learn.sg.side.retry"))}</p>}>
        <div className="lrn-fig" style={{ marginTop: 8 }}>
          <SignatureXray pub={demo.pub} message={demo.msg} signature={demo.sig} signer="issuer" />
        </div>
      </Sec>

      <Sec id="sign" title={rich(t("learn.sg.s.sign"))} lede={t("learn.sg.s.sign.lede")} side={<p>{rich(t("learn.sg.side.nft"))}</p>}>
        <div className="lrn-fig" style={{ marginTop: 8 }}>
          <SignLab />
        </div>
      </Sec>

      <Sec id="vectors" title={rich(t("learn.sg.s.tv"))} lede={t("learn.sg.s.tv.lede")}>
        <div className="lrn-fig" style={{ marginTop: 8 }}>
          <SelfTest />
        </div>
        <SourceLinks ids={["bt-spec-schnorr"]} />
      </Sec>

      <Sec id="wallets" title={rich(t("learn.sg.s.wallets"))} lede={wallets ? pick(wallets.short, L) : undefined}>
        {wallets?.a.map((p, i) => <p className="lrn-p" key={i}>{inline(pick(p, L))}</p>)}
        <Callout tone="info" className="lrn-callout">{t("learn.sg.wallets.p")}</Callout>
        <div className="lrn-try">
          <Key size="sm" icon="right" to="/learn/tools#verify">{t("learn.page.tools.title")} · {plainTitle(t("learn.tl.s.verify"))}</Key>
          <Key size="sm" variant="quiet" icon="right" to="/learn/trust">{t("learn.page.trust.title")}</Key>
        </div>
      </Sec>

      <Pager id="signature" />
    </article>
  );
}
