// The five moments on Home (VISUAL §13 "01 Five moments"): Promise · Stamp · Trust · Back · Redeem.
// Each has a numeral, a serif title, exactly two sentences and a mono protocol fact. `mini` names the
// interactive miniature PRODUCT §5 describes for it.

import { fact, t, type FigureId, type Text } from "./types";

export type MomentId = "promise" | "stamp" | "trust" | "back" | "redeem";

export interface Moment {
  id: MomentId;
  n: 1 | 2 | 3 | 4 | 5;
  /** Roman numeral for the italic-metal figure. */
  numeral: "I" | "II" | "III" | "IV" | "V";
  title: Text;
  /** Exactly two sentences. */
  text: Text;
  /** Mono protocol fact under the text. */
  fact: Text;
  /** Interactive miniature: odometer, two stamps, digest pulse, reserve coin, tear-off. */
  mini: FigureId;
  /** What the miniature does, for its aria-label and the reduced-motion fallback. */
  miniAlt: Text;
  /** Chapter in howItWorks that explains this moment. */
  chapter: string;
}

export const momentsTitle: Text = t("Five moments", "Пять моментов");
export const momentsLede: Text = t(
  "One note from Alice to Bob, from the first promise to the moment Bob takes value on Ergo.",
  "Одна расписка от Алисы Бобу — от первого обещания до момента, когда Боб получает ценность в Ergo.",
);

export const moments: Moment[] = [
  {
    id: "promise",
    n: 1,
    numeral: "I",
    title: t("Promise", "Обещание"),
    text: t(
      "Alice pays Bob by raising the total she owes him. There is one running note per pair, and its total only goes up.",
      "Алиса платит Бобу, увеличивая общий итог своего долга перед ним. На каждую пару — одна расписка, и её итог только растёт.",
    ),
    fact: fact("key = blake2b256(A ‖ B) · total only grows", "key = blake2b256(A ‖ B) · итог только растёт"),
    mini: "note-odometer",
    miniAlt: t("An odometer rolls the note's total from 1 000.00 to 1 240.00.", "Счётчик прокручивает итог расписки с 1 000,00 до 1 240,00."),
    chapter: "running-total",
  },
  {
    id: "stamp",
    n: 2,
    numeral: "II",
    title: t("Stamp", "Печать"),
    text: t(
      "Alice signs the new total with her key. The tracker countersigns the same 80 bytes, so the note carries two stamps.",
      "Алиса подписывает новый итог своим ключом. Трекер ставит вторую подпись на те же 80 байт — на расписке две печати.",
    ),
    fact: fact("sig = a(33) ‖ z(32) over an 80-byte message", "подпись = a(33) ‖ z(32) над сообщением в 80 байт"),
    mini: "two-stamps",
    miniAlt: t("Two stamps land on the note: the issuer's, then the tracker's.", "На расписку ложатся две печати: сначала эмитента, потом трекера."),
    chapter: "signatures",
  },
  {
    id: "trust",
    n: 3,
    numeral: "III",
    title: t("Trust", "Доверие"),
    text: t(
      "Every few minutes the tracker writes a short fingerprint of all notes to Ergo: the digest. Anyone can use it to check that a note is counted, but not whether the payer can pay.",
      "Раз в несколько минут трекер записывает в Ergo короткий отпечаток всех расписок — дайджест. По нему любой проверит, что расписка учтена, но не то, хватит ли у должника денег.",
    ),
    fact: fact("R5 = AVL+ digest · every 300 s at ErgoScan · confirmed at depth 2", "R5 = дайджест AVL+ · у ErgoScan раз в 300 с · подтверждено на глубине 2"),
    mini: "digest-pulse",
    miniAlt: t("A pulse travels from the note to the tracker box on Ergo.", "Импульс идёт от расписки к боксу трекера в Ergo."),
    chapter: "digest",
  },
  {
    id: "back",
    n: 4,
    numeral: "IV",
    title: t("Back", "Обеспечение"),
    text: t(
      "Alice can lock ERG or one token in a reserve box that backs all her notes. Bob decides how much backing he needs before he accepts.",
      "Алиса может положить ERG или один токен в бокс резерва, который обеспечивает все её расписки. Боб сам решает, какое обеспечение ему нужно, прежде чем принять расписку.",
    ),
    fact: fact("top up ≥ 0.1 ERG · anyone · no signature", "пополнение ≥ 0,1 ERG · кто угодно · без подписи"),
    mini: "reserve-coin",
    miniAlt: t("A reserve coin fills to show how much of Alice's debt it covers.", "Монета резерва заполняется и показывает, какую часть долга Алисы она покрывает."),
    chapter: "reserve",
  },
  {
    id: "redeem",
    n: 5,
    numeral: "V",
    title: t("Redeem", "Погашение"),
    text: t(
      "Bob tears off part of what he is owed and takes it from Alice's reserve, as often as he likes. The reserve remembers what it paid, so nothing is paid twice.",
      "Боб отрывает часть того, что ему должны, и забирает её из резерва Алисы — сколько угодно раз. Резерв помнит, что уже выплатил, поэтому дважды ничего не платится.",
    ),
    fact: fact("0 < redeemed ≤ total − already redeemed · fee: none", "0 < погашено ≤ итог − уже погашено · комиссия: нет"),
    mini: "tear-off",
    miniAlt: t("A stub tears off the note and drops into Bob's wallet.", "Корешок отрывается от расписки и падает в кошелёк Боба."),
    chapter: "redemption",
  },
];
