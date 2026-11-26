// «Thanks with a note»: a support button for a project's README or site, on Receive. The button is a static image on
// this site (public/badge.svg, public/badge-ru.svg) and its link is this key's payment request (the same link as
// «Ask for a payment», with the name and memo after #): ready Markdown and HTML, the link and its QR code. Said plainly:
// only a key with a reserve can pay on ErgoScan's tracker today (notes_require_reserve), and a payment shows here once
// the payer sends the receipt.
import { useState } from "react";
import { useLang, useT } from "@/app/lang";
import { AmountInput, Card, CopyButton, Field, Key, Seg, TextInput } from "@/ui";
import { TRACKER_NFT } from "@/mainnet/tx";
import { parseUnits } from "@/mainnet/flows";
import { QrCode } from "../lib/qr";
import { LONG_LINK, MEMO_MAX, NAME_MAX, labelledRequestLink } from "./reqlink";

/** The button's image and its alt text, in the button's own language (not the page's). */
export const BADGES = {
  en: { file: "badge.svg", alt: "Support with a Basis note" },
  ru: { file: "badge-ru.svg", alt: "Поддержать распиской Basis" },
} as const;
type BadgeLang = keyof typeof BADGES;
type Format = "md" | "html";

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The snippet for a README (Markdown) or a site (HTML). */
export function badgeSnippet(origin: string, link: string, lang: BadgeLang, format: Format): string {
  const b = BADGES[lang];
  const img = `${origin}/${b.file}`;
  return format === "md" ? `[![${b.alt}](${img})](${link})` : `<a href="${attr(link)}"><img src="${attr(img)}" alt="${attr(b.alt)}" height="20"></a>`;
}

/** `bare`: inside «More ways» on Receive, without its own card. */
export function ProjectButton({ me, bare }: { me: string; bare?: boolean }) {
  const t = useT();
  const { lang } = useLang();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [memo, setMemo] = useState("");
  const [amountText, setAmountText] = useState("");
  const [blang, setBlang] = useState<BadgeLang>(lang === "ru" ? "ru" : "en");
  const [format, setFormat] = useState<Format>("md");
  const [qr, setQr] = useState(false);
  const amount = parseUnits(amountText, 9);
  const link = labelledRequestLink(location.origin, { to: me, amount: amount && amount > 0n ? amount : null, nft: TRACKER_NFT }, { name, memo });
  const code = badgeSnippet(location.origin, link, blang, format);
  const body = (
      <div className="mw-form mw-tip">
        <p className="t-small">{t("mw.tip.lede")}</p>
        {!open ? (
          <Key onClick={() => setOpen(true)}>{t("mw.tip.open")}</Key>
        ) : (
          <>
            <div className="mw-tip-fields">
              <Field label={t("mw.tip.nameL")}>
                <TextInput value={name} onChange={setName} maxLength={NAME_MAX} autoComplete="off" />
              </Field>
              <Field label={t("mw.tip.amountL")} help={t("mw.recv.askAmountHelp")} error={amountText && amount === null ? t("mw.amount.bad") : undefined}>
                <AmountInput value={amountText} onChange={setAmountText} />
              </Field>
              <Field label={t("mw.tip.memoL")} help={t("mw.rq.labelsHelp")} className="mw-tip-wide">
                <TextInput value={memo} onChange={setMemo} maxLength={MEMO_MAX} placeholder={t("mw.tip.memoPh")} autoComplete="off" />
              </Field>
            </div>
            <div className="mw-tip-look">
              <img src={`/${BADGES[blang].file}`} alt={BADGES[blang].alt} width={blang === "ru" ? 214 : 185} height={20} />
              <Seg ariaLabel={t("mw.tip.lang")} value={blang} onChange={setBlang} options={[{ value: "en", label: "EN" }, { value: "ru", label: "RU" }]} />
              <Seg ariaLabel={t("mw.tip.format")} value={format} onChange={setFormat} options={[{ value: "md", label: "Markdown" }, { value: "html", label: "HTML" }]} />
            </div>
            <pre className="mw-tip-code" aria-label={t("mw.tip.codeL")}>{code}</pre>
            <div className="mw-actions">
              <CopyButton value={code} label={t("mw.tip.copyCode")} />
              <CopyButton value={link} label={t("mw.tip.copyLink")} />
              <Key size="sm" aria-expanded={qr} onClick={() => setQr(!qr)}>{t(qr ? "mw.rq.qrHide" : "mw.rq.qr")}</Key>
            </div>
            {qr && <div className={`mw-qr${link.length > LONG_LINK ? " lg" : ""}`}><QrCode text={link} size={180} label={t("mw.tip.qrL")} /></div>}
            <ul className="mw-facts mw-facts-tight">
              <li>{t("mw.tip.reserve")}</li>
              <li>{t("mw.tip.receipt")}</li>
            </ul>
          </>
        )}
      </div>
  );
  return bare ? body : <Card title={t("mw.tip.t")} className="mw-tip">{body}</Card>;
}
