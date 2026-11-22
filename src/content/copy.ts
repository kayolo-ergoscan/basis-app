// Shared honest phrases (PRODUCT §1, VISUAL §14). The shell, Home and every feature import these instead of
// rewording them, so the site says each of these things one way only.

import { denial, fact, t, type Text } from "./types";

/** Formats a block height for copy: 1921849 → "1 921 849" with the house separator. */
function height(h: number): string {
  return String(Math.trunc(h)).replace(/\B(?=(\d{3})+(?!\d))/g, " ⁠");
}

/** Russian plural: forms for 1, 2–4 and 5+ (21 → form 1, 12 → form 3). */
export function ruPlural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(Math.trunc(n)) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b === 1) return forms[0];
  if (b >= 2 && b <= 4) return forms[1];
  return forms[2];
}

export const copy = {
  // The banner ("ErgoScan's Basis tracker runs on mainnet (beta) …") is app.banner in src/app/i18n.ts.
  /** The footer and positioning line. */
  independence: t("An independent interface to the Basis protocol.", "Независимый интерфейс к протоколу Basis."),
  independenceLong: t(
    "An independent, open interface to the Basis protocol, built by ErgoScan. Basis is public-domain (CC0) work by kushti and Better Money Labs; they did not make or review this site.",
    "Независимый открытый интерфейс к протоколу Basis от ErgoScan. Basis — общественное достояние (CC0), его авторы — kushti и Better Money Labs; этот сайт они не делали и не проверяли.",
  ),
  /** Small tag next to the brand. */
  brandTag: t("unofficial · ErgoScan", "неофициально · ErgoScan"),
  /** Pair the name with Ergo when it stands alone. */
  brandFull: t("Basis on Ergo", "Basis на Ergo"),
  eyebrow: t("OFFCHAIN CASH · SETTLES ON ERGO", "ОФЧЕЙН-ДЕНЬГИ · РАСЧЁТ НА ERGO"),
  heroHeadline: { line1: t("Pay with your word.", "Платите словом."), line2: t("Redeem on Ergo.", "Погашайте на Ergo.") },

  /** The tracker trust line, everywhere a tracker is shown. */
  trackerLine: t("Cannot steal · Can censor", "Украсть не может · Цензурировать может"),
  trackerLineLong: t(
    "A tracker cannot take anyone's money or forge a note. It can refuse, delay or leave out notes, and the contract cannot force it to include them.",
    "Трекер не может забрать чужие деньги или подделать расписку. Но он может отказать, задержать или не включить расписку, и контракт не заставит его это сделать.",
  ),

  /** Fee line (VISUAL §14). The miner fee shown next to it comes from the wallet. */
  fee: t("Protocol fee: none (basis.es) · Miner fee 0.001 ERG", "Комиссия протокола: нет (basis.es) · Комиссия майнера 0,001 ERG"),
  feeProtocol: t("Protocol fee: none (basis.es)", "Комиссия протокола: нет (basis.es)"),
  feeMiner: t("Miner fee 0.001 ERG", "Комиссия майнера 0,001 ERG"),
  feeDenial: t(
    "Protocol fee: none. basis.es has no fee rule; the percentage fee people remember belonged to ChainCash, the predecessor, and was removed there in May 2025.",
    "Комиссии протокола нет: в basis.es нет правила о комиссии. Процентная комиссия, о которой иногда вспоминают, была у ChainCash, предшественника, и её убрали ещё в мае 2025 года.",
  ),
  feeOffchain: t("Paying with a note costs nothing: it is a signature, not a transaction.", "Платёж распиской ничего не стоит: это подпись, а не транзакция."),

  /** Mainnet honesty (VISUAL §13 Home, §14). */
  /** The status label next to mainnet data. Always true, whoever creates reserves; the only test-use claim is Home's
   *  network door sentence, computed from the detector (src/chain/ours currentUse). */
  experimental: t("experimental", "экспериментально"),
  mainnetFootnoteStatic: t("99 reserve boxes · 8.995 ERG · test use", "99 резервных боксов · 8,995 ERG · тестовое использование"),
  mainnetFootnote: (o: { boxes: number; erg: string; height?: number }): Text =>
    t(
      `${o.boxes} reserve ${o.boxes === 1 ? "box" : "boxes"} · ${o.erg} ERG · experimental${o.height ? ` · as of block ${height(o.height)}` : ""}`,
      `${o.boxes} ${ruPlural(o.boxes, ["резервный бокс", "резервных бокса", "резервных боксов"])} · ${o.erg.replace(".", ",")} ERG · экспериментально${o.height ? ` · на блоке ${height(o.height)}` : ""}`,
    ),
  asOfBlock: (h: number): Text => t(`as of block ${height(h)}`, `на блоке ${height(h)}`),
  mainnetHonest: t(
    "Basis on mainnet is still experimental. The early test reserves sit under older contract versions; ErgoScan's tracker has run in beta since 22 November 2026, and reserves under the current contracts can bind to it.",
    "Basis в mainnet пока экспериментальный. Ранние тестовые резервы лежат под старыми версиями контракта; трекер ErgoScan работает в бета-режиме с 22 ноября 2026 года, и к нему можно привязать резервы под текущими контрактами.",
  ),
  currentContractsEmpty: t("No reserve under the current contracts yet.", "Под текущими контрактами резервов пока нет."),
  topUpClosed: t(
    "Top up opens when a reserve under the current contract exists.",
    "Пополнение станет доступно, когда появится резерв под текущим контрактом.",
  ),
  legacyBadge: t("legacy contract", "старый контракт"),

  /** Sandbox labels (PRODUCT §1: always labelled). */
  sandbox: t("Sandbox", "Песочница"),
  sandboxLabel: t("Sandbox · play money", "Песочница · игровые деньги"),
  sandboxNothingReal: t("Sandbox · nothing here is real money", "Песочница · здесь нет настоящих денег"),
  sandboxKey: t(
    "This is a sandbox key. It signs play notes in this browser. Do not use it for real funds.",
    "Это ключ песочницы. Он подписывает игровые расписки в этом браузере. Не используйте его для настоящих средств.",
  ),
  realCrypto: t("Real cryptography, play money.", "Настоящая криптография, игровые деньги."),

  /** Rules said the same way everywhere. */
  emergencyRule: t(
    "Emergency redeem: the tracker has been silent 2 160 blk ≈ 3 days.",
    "Аварийное погашение: трекер молчит 2 160 блоков ≈ 3 дня.",
  ),
  emergencyIsAvailability: t(
    "The emergency path is for a tracker that went quiet. It does not help against a tracker that leaves your note out.",
    "Аварийный путь — на случай, если трекер замолчал. Против трекера, который не включил вашу расписку, он не помогает.",
  ),
  refundRule: t(
    "Exit: the owner sets R7, waits 43 200 blk ≈ 60 days, then takes what is left.",
    "Выход: владелец записывает R7, ждёт 43 200 блоков ≈ 60 дней и забирает остаток.",
  ),
  refundCreditors: t("Creditors can still redeem while the refund waits.", "Пока возврат ждёт, кредиторы по-прежнему могут погашать."),
  topUpRule: t("Top up: anyone can, at least 0.1 ERG.", "Пополнение: может кто угодно, от 0,1 ERG."),
  topUpRuleToken: t("Top up a token reserve: anyone can, at least one raw unit.", "Пополнение резерва в токене: может кто угодно, от одной минимальной единицы."),
  boundForever: t("Bound to its tracker forever (R6).", "Навсегда привязан к своему трекеру (R6)."),
  thresholdsArePolicy: t(
    "The 150 %, 120 % and 100 % marks are wallet policy, not contract rules.",
    "Отметки 150 %, 120 % и 100 % — политика кошелька, а не правила контракта.",
  ),
  coverageAdvisory: t(
    "Coverage is a policy check by wallets and the tracker. The contract does not compare a note with the reserve size.",
    "Покрытие проверяют кошельки и трекер. Контракт не сравнивает расписку с размером резерва.",
  ),
  noteIsPromise: t("A note is a promise to pay, not cash.", "Расписка — это обещание заплатить, а не деньги."),
  noteNotBearer: denial(
    "A note names both people. It is not a bearer token and cannot be handed on without the issuer.",
    "В расписке указаны оба участника. Это не бумага на предъявителя: передать её дальше без эмитента нельзя.",
  ),
  matchNotSolvency: t(
    "A match proves the tracker box commits these notes. It does not prove that the issuer can pay.",
    "Совпадение доказывает, что бокс трекера фиксирует эти расписки. Оно не доказывает, что эмитент сможет заплатить.",
  ),
  totalsOnlyGrow: t("A note's total only goes up. Payments raise it; redemptions are counted separately.", "Итог расписки только растёт. Платежи увеличивают его, погашения учитываются отдельно."),
  directionHint: t("Direction in words: \"Alice owes Bob\".", "Направление словами: «Алиса должна Бобу»."),
  noEndorsement: denial(
    "Not affiliated with Better Money Labs or kushti, and not endorsed by them.",
    "Не связан с Better Money Labs или kushti и не одобрен ими.",
  ),
  consentToDebt: t("This is a real signed debt.", "Это настоящий подписанный долг."),
  nautilusCannotSign: t(
    "Ordinary Ergo wallets cannot sign Basis notes yet: notes use a raw Schnorr signature over 80 bytes, not a transaction.",
    "Обычные кошельки Ergo пока не умеют подписывать расписки Basis: здесь нужна «сырая» подпись Шнорра над 80 байтами, а не транзакция.",
  ),

  /** Mono protocol facts reused by several pages. */
  facts: {
    emergency: fact("HEIGHT − trackerBox.creationHeight > 2160", "HEIGHT − trackerBox.creationHeight > 2160"),
    refund: fact("HEIGHT ≥ R7 + 43200", "HEIGHT ≥ R7 + 43200"),
    topUp: fact("selfOut.value − SELF.value ≥ 100000000", "selfOut.value − SELF.value ≥ 100000000"),
    message: fact("key(32) ‖ totalDebt(8) ‖ timestamp(8) ‖ trackerNftId(32) = 80 bytes", "key(32) ‖ totalDebt(8) ‖ timestamp(8) ‖ trackerNftId(32) = 80 байт"),
    signature: fact("sig = a(33) ‖ z(32) · g^z = a · pk^e · e = blake2b256(a ‖ msg ‖ pk)"),
    fee: fact("redeemed = SELF.value − selfOut.value · fee: none", "redeemed = SELF.value − selfOut.value · комиссия: нет"),
    minerFee: fact("miner fee 0.001 ERG = 1000000 nanoERG", "комиссия майнера 0,001 ERG = 1000000 nanoERG"),
  },
} as const;

export type CopyKey = keyof typeof copy;
