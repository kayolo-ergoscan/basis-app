// /learn/how: ten short steps, plain words, one idea per sentence. Each chapter ends with a mono
// "protocol fact" and suggests a figure; `lines` points the reader at the contract where the rule lives.

import type { SourceId } from "./sources";
import { fact, t, type FigureId, type LineRef, type Text } from "./types";

export interface Chapter {
  id: string;
  n: number;
  title: Text;
  lede: Text;
  /** Paragraphs; each is one or two short sentences. */
  body: Text[];
  /** One mono line: the rule as the protocol states it. */
  fact: Text;
  figure: FigureId;
  /** Where the rule lives in the contract (optional). */
  lines?: LineRef;
  /** Glossary ids to link from this chapter. */
  terms: string[];
  sources: SourceId[];
}

export const howItWorksTitle: Text = t("How Basis works", "Как устроен Basis");
export const howItWorksLede: Text = t(
  "Basis is off-chain IOU money with optional reserves on Ergo. Ten short steps, from the first promise to the last exit.",
  "Basis — это офчейн-деньги на долговых расписках с необязательными резервами в Ergo. Десять коротких шагов — от первого обещания до выхода.",
);

export const chapters: Chapter[] = [
  {
    id: "running-total",
    n: 1,
    title: t("A note is a running total", "Расписка — это накопленный итог"),
    lede: t("Basis has no coins. Alice's debt to Bob is one number that only grows.", "В Basis нет монет. Долг Алисы перед Бобом — одно число, которое только растёт."),
    body: [
      t("When Alice pays Bob, she sends nothing. She signs a new, higher total of what she owes him.", "Когда Алиса платит Бобу, она ничего не отправляет. Она подписывает новый, больший итог своего долга перед ним."),
      t("There is one note per pair and per denomination. Alice → Bob in ERG is one note; Alice → Bob in a token is another.", "На каждую пару и валюту — одна расписка. Алиса → Боб в ERG — одна расписка, Алиса → Боб в токене — другая."),
      t("The total never goes down. What Bob has already taken out is counted separately, in Alice's reserve.", "Итог никогда не уменьшается. То, что Боб уже забрал, учитывается отдельно — в резерве Алисы."),
      t("So the note always says everything Alice ever promised Bob. What Bob can still redeem is that total minus what he has redeemed.", "Поэтому расписка всегда показывает всё, что Алиса когда-либо обещала Бобу. Погасить Боб может этот итог минус то, что он уже погасил."),
      t("None of this touches the chain. A payment is a signature, so it is free and instant.", "Блокчейн здесь не участвует. Платёж — это подпись, поэтому он бесплатный и мгновенный."),
    ],
    fact: fact("debtKey = blake2b256(A(33) ‖ B(33) [‖ tokenId(32)])"),
    figure: "note-odometer",
    lines: { contract: "basis", from: 288, to: 292 },
    terms: ["note", "cumulative-total", "debt-key", "denomination", "self-note"],
    sources: ["bt-readme", "bt-basis-es"],
  },
  {
    id: "signatures",
    n: 2,
    title: t("Signing the note", "Подпись расписки"),
    lede: t("Alice signs 80 bytes. One Schnorr scheme signs every message in Basis.", "Алиса подписывает 80 байт. Одна схема Шнорра подписывает все сообщения в Basis."),
    body: [
      t("The message is the debt key (32 bytes), the new total (8), a timestamp in milliseconds (8) and the tracker's NFT id (32).", "Сообщение — это ключ долга (32 байта), новый итог (8), метка времени в миллисекундах (8) и id NFT трекера (32)."),
      t("The NFT id binds the note to one tracker. A note signed for one tracker cannot be redeemed through another.", "Id NFT привязывает расписку к одному трекеру. Расписку, подписанную для одного трекера, нельзя погасить через другой."),
      t("The signature has 65 bytes: a point a (33 bytes) and a number z (32 bytes).", "Подпись занимает 65 байт: точка a (33 байта) и число z (32 байта)."),
      t("The challenge is e = blake2b256(a ‖ message ‖ public key). A verifier checks that g^z equals a · pk^e.", "Вызов — e = blake2b256(a ‖ сообщение ‖ открытый ключ). Проверяющий убеждается, что g^z равно a · pk^e."),
      t("Both e and z must fit into 255 bits, so the signer retries with a fresh nonce until they do. About one try in four succeeds.", "И e, и z должны умещаться в 255 бит, поэтому подписывающий повторяет попытку с новым нонсом. Удаётся примерно каждая четвёртая."),
      t("Ordinary Ergo wallets sign transactions, not raw messages. That is why they cannot sign notes yet.", "Обычные кошельки Ergo подписывают транзакции, а не произвольные сообщения. Поэтому подписывать расписки они пока не умеют."),
    ],
    fact: fact("key(32) ‖ totalDebt(8) ‖ timestamp(8) ‖ trackerNftId(32) = 80 bytes", "key(32) ‖ totalDebt(8) ‖ timestamp(8) ‖ trackerNftId(32) = 80 байт"),
    figure: "signature-grid",
    lines: { contract: "basis", from: 340, to: 343 },
    terms: ["message", "schnorr-signature", "challenge", "nonce", "group-element"],
    sources: ["bt-spec-schnorr", "bt-basis-es"],
  },
  {
    id: "tracker",
    n: 3,
    title: t("The tracker witnesses", "Трекер — свидетель"),
    lede: t("A tracker is a server that records notes, countersigns them and keeps them in one tree.", "Трекер — это сервер, который записывает расписки, ставит под ними вторую подпись и хранит их в одном дереве."),
    body: [
      t("Alice sends her signed note to the tracker. It checks the signature, that the total did not go down and that the timestamp is newer.", "Алиса отправляет подписанную расписку трекеру. Он проверяет подпись, то, что итог не уменьшился, и то, что метка времени новее прежней."),
      t("It keeps every note in an AVL+ tree: debt key → total.", "Каждую расписку он хранит в AVL+-дереве: ключ долга → итог."),
      t("When Bob redeems, the tracker signs the same 80 bytes with the key in R4 of its box.", "Когда Боб погашает, трекер подписывает те же 80 байт ключом из R4 своего бокса."),
      t("A new note is local only. It becomes pending when the tracker posts a commit, and confirmed two blocks later.", "Новая расписка сначала локальная. Она становится ожидающей, когда трекер отправляет фиксацию, и подтверждённой через два блока."),
      t("From payment to redeemable usually takes 5–25 minutes on the reference server, about 14 on average; ErgoScan's tracker commits twice as often, so it is usually shorter.", "От платежа до возможности погасить на эталонном сервере обычно проходит 5–25 минут, в среднем около 14; трекер ErgoScan фиксирует вдвое чаще, поэтому обычно быстрее."),
      t("The tracker never holds anyone's money. It holds the record.", "Трекер не держит чужих денег. Он держит запись."),
    ],
    fact: fact("local_only → pending → confirmed (depth ≥ 2)", "local_only → pending → confirmed (глубина ≥ 2)"),
    figure: "tracker-ladder",
    terms: ["tracker", "tracker-signature", "avl-tree", "status-ladder", "confirmation-depth"],
    sources: ["bt-spec-tracker", "bt-readme"],
  },
  {
    id: "digest",
    n: 4,
    title: t("The digest on Ergo", "Дайджест в Ergo"),
    lede: t("The tracker's whole tree fits into 33 bytes, and those bytes live on Ergo.", "Всё дерево трекера умещается в 33 байта, и эти байты хранятся в Ergo."),
    body: [
      t("Every few minutes the tracker re-creates its box on Ergo with the tree's root digest in R5: every 300 s on ErgoScan's tracker, every 600 s by default.", "Раз в несколько минут трекер пересоздаёт свой бокс в Ergo с корневым дайджестом дерева в R5: у трекера ErgoScan раз в 300 с, по умолчанию раз в 600 с."),
      t("If nothing changed, it skips the update. A quiet tracker's box simply grows older.", "Если ничего не изменилось, обновление пропускается. Бокс молчащего трекера просто стареет."),
      t("To redeem, the note must be in that committed tree. The redeemer attaches a lookup proof (#8), and the contract checks it.", "Чтобы погасить расписку, она должна быть в этом зафиксированном дереве. Погашающий прикладывает доказательство поиска (#8), и контракт его проверяет."),
      t("A match proves that the box commits this total. It does not prove that the issuer can pay.", "Совпадение доказывает, что бокс фиксирует этот итог. Оно не доказывает, что эмитент сможет заплатить."),
      t("The tracker decides what goes into the tree. Leaving a note out is the one thing the chain cannot correct.", "Что попадёт в дерево, решает трекер. Если расписку не включили, блокчейн это не исправит."),
    ],
    fact: fact("trackerTree.get(key, proof #8) == totalDebt (#3)"),
    figure: "digest-pulse",
    lines: { contract: "basis", from: 298, to: 303 },
    terms: ["digest", "commitment", "tracker-box", "lookup-proof", "data-input"],
    sources: ["bt-basis-es", "bt-readme"],
  },
  {
    id: "reserve",
    n: 5,
    title: t("The reserve box", "Бокс резерва"),
    lede: t("A reserve is an ordinary box on Ergo, guarded by the basis.es script.", "Резерв — обычный бокс в Ergo, который охраняет скрипт basis.es."),
    body: [
      t("It holds ERG, or one token under basis-token.es. Its owner's key is in R4.", "В нём лежат ERG или один токен (для basis-token.es). Ключ владельца — в R4."),
      t("R5 is the reserve's own tree: for each pair, the latest timestamp and how much was paid out.", "R5 — собственное дерево резерва: для каждой пары последняя метка времени и сколько уже выплачено."),
      t("R6 names one tracker by its NFT id. It never changes, so a reserve is bound to that tracker forever.", "R6 называет один трекер по id его NFT. Он не меняется, поэтому резерв навсегда привязан к этому трекеру."),
      t("R7 stays empty until the owner announces an exit.", "R7 остаётся пустым, пока владелец не объявит о выходе."),
      t("One reserve backs all of the owner's notes in its denomination, for any number of receivers.", "Один резерв обеспечивает все расписки владельца в своей валюте — для любого числа получателей."),
      t("Anyone can top it up with at least 0.1 ERG, or one raw unit of the token. No signature is needed.", "Пополнить его может кто угодно: от 0,1 ERG или от одной минимальной единицы токена. Подпись не нужна."),
    ],
    fact: fact("R4 owner · R5 redeemed tree · R6 tracker NFT · R7 refund height", "R4 владелец · R5 дерево погашений · R6 NFT трекера · R7 высота возврата"),
    figure: "reserve-registers",
    lines: { contract: "basis", from: 175, to: 185 },
    terms: ["reserve", "r4", "r5", "r6", "r7", "top-up"],
    sources: ["bt-basis-es", "bt-basis-token-es", "tg-1625"],
  },
  {
    id: "acceptance",
    n: 6,
    title: t("The receiver decides", "Решает получатель"),
    lede: t("Nobody has to accept a note. Each receiver writes down whose notes they take.", "Никто не обязан принимать расписку. Каждый получатель сам записывает, чьи расписки он берёт."),
    body: [
      t("An acceptance policy is a small signed rule set: a whitelist, a blacklist, a minimum coverage, or a mix.", "Политика приёма — небольшой подписанный набор правил: белый список, чёрный список, минимальное покрытие или их сочетание."),
      t("If you publish yours, anyone can pay you without asking first.", "Если опубликовать свою политику, платить вам можно без предварительных вопросов."),
      t("Coverage compares an issuer's reserve with what they owe. Your wallet checks it before accepting a note; the tracker checks it again when someone redeems.", "Покрытие сравнивает резерв эмитента с его долгом. Кошелёк проверяет его перед приёмом расписки, а трекер — ещё раз при погашении."),
      t("The contract does not check coverage. The 150 %, 120 % and 100 % warnings in the reference wallet are wallet policy.", "Контракт покрытие не проверяет. Предупреждения на 150 %, 120 % и 100 % в эталонном кошельке — политика кошелька."),
      t("When an issuer owes several people, the tracker refuses a redemption that would push another holder below their floor.", "Если эмитент должен нескольким людям, трекер отказывает в погашении, которое опустит другого держателя ниже его порога."),
      t("If every other holder is already below it, only the oldest note may redeem. New credit from that issuer moves you to the back of the queue.", "Если все остальные держатели уже ниже порога, погасить может только самая старая расписка. Новый кредит от этого эмитента отправляет вас в конец очереди."),
    ],
    fact: fact("NOT blacklisted AND (whitelisted OR collateralized ≥ min_ratio)", "НЕ в чёрном списке И (в белом списке ИЛИ обеспечение ≥ min_ratio)"),
    figure: "money-spectrum",
    terms: ["acceptance-policy", "whitelist", "blacklist", "coverage", "credit-line", "fifo"],
    sources: ["bt-spec-acceptance", "bt-spec-redemption-policy"],
  },
  {
    id: "redemption",
    n: 7,
    title: t("Redeeming on Ergo", "Погашение в Ergo"),
    lede: t("Redeeming moves value from the issuer's reserve to the holder in one transaction.", "Погашение переводит ценность из резерва эмитента держателю одной транзакцией."),
    body: [
      t("Bob builds a transaction that spends Alice's reserve and re-creates it with less inside.", "Боб собирает транзакцию, которая тратит резерв Алисы и создаёт его заново, но с меньшей суммой."),
      t("He attaches the note's total and timestamp, Alice's signature, the tracker's signature and three proofs.", "Он прикладывает итог и метку времени расписки, подпись Алисы, подпись трекера и три доказательства."),
      t("The contract checks the tracker, the committed total, the timestamp, the amount, the tracker's signature or the emergency rule, Alice's signature, the new tree, the refund flag and Bob's own signature.", "Контракт проверяет трекер, зафиксированный итог, метку времени, сумму, подпись трекера или аварийное правило, подпись Алисы, новое дерево, флаг возврата и подпись самого Боба."),
      t("Bob can take any part of what is left, now or later, as many times as he likes.", "Боб может забрать любую часть остатка — сейчас или позже, сколько угодно раз."),
      t("The reserve adds every payout to its own tree, so the same promise is never paid twice.", "Резерв записывает каждую выплату в своё дерево, поэтому одно и то же обещание не оплачивается дважды."),
      t("There is no protocol fee. The miner fee is 0.001 ERG; on the tracker's path the tracker pays it.", "Комиссии протокола нет. Комиссия майнера — 0,001 ERG; при погашении через трекер её платит трекер."),
    ],
    fact: fact("0 < redeemed ≤ totalDebt − redeemedDebt"),
    figure: "contract-xray",
    lines: { contract: "basis", from: 381, to: 385 },
    terms: ["redemption", "context-variable", "proof-insert", "miner-fee", "protocol-fee", "prove-dlog"],
    sources: ["bt-basis-es"],
  },
  {
    id: "emergency",
    n: 8,
    title: t("When the tracker goes quiet", "Когда трекер замолкает"),
    lede: t("If the tracker's box is older than 2 160 blocks, about 3 days, its signature is no longer required.", "Если боксу трекера больше 2 160 блоков, примерно 3 дня, его подпись больше не нужна."),
    body: [
      t("The clock is the age of the tracker box: the current height minus the height at which the box was created.", "Часы — это возраст бокса трекера: текущая высота минус высота, на которой бокс создан."),
      t("An active tracker re-creates its box often, which keeps the window shut. An idle one lets it open.", "Активный трекер часто пересоздаёт бокс, и окно остаётся закрытым. У бездействующего оно открывается."),
      t("On the emergency path the note must still be in the last committed tree, and the issuer's signature is still required.", "На аварийном пути расписка всё равно должна быть в последнем зафиксированном дереве, и подпись эмитента по-прежнему нужна."),
      t("So it helps when a tracker disappears. It does not help when a tracker leaves your note out, or keeps posting while ignoring you.", "Поэтому путь помогает, если трекер пропал. Он не помогает, если трекер не включил вашу расписку или продолжает публиковать фиксации, игнорируя вас."),
      t("You also need the proof of your note from that tree. Today only the tracker holds the tree, so a wallet should save proofs while it is online.", "Ещё нужно доказательство вашей расписки из этого дерева. Сейчас дерево есть только у трекера, поэтому кошельку стоит сохранять доказательства, пока трекер на связи."),
    ],
    fact: fact("HEIGHT − trackerBox.creationHeight > 2160 → #6 may be empty"),
    figure: "emergency-dial",
    lines: { contract: "basis", from: 332, to: 338 },
    terms: ["emergency-redemption", "emergency-period", "censorship"],
    sources: ["bt-readme", "bt-basis-es"],
  },
  {
    id: "exit",
    n: 9,
    title: t("Leaving: the owner's refund", "Выход: возврат резерва владельцу"),
    lede: t("An owner can take a reserve back, but only after giving creditors about 60 days.", "Владелец может забрать резерв, но только дав кредиторам около 60 дней."),
    body: [
      t("First the owner signs a transaction that writes the current height into R7. It works once; the clock cannot be restarted.", "Сначала владелец подписывает транзакцию, которая записывает текущую высоту в R7. Это делается один раз: часы не перезапустить."),
      t("Nothing can be taken out at that step.", "На этом шаге забрать ничего нельзя."),
      t("While the refund waits, every creditor can still redeem. Wallets should warn them.", "Пока возврат ждёт, каждый кредитор по-прежнему может погашать. Кошельки должны их предупредить."),
      t("After R7 + 43 200 blocks the owner signs again and takes everything that is left.", "Через R7 + 43 200 блоков владелец подписывает снова и забирает всё, что осталось."),
      t("Redemptions stay possible even after the deadline, until the owner completes the refund.", "Погашать можно и после срока — пока владелец не завершит возврат."),
    ],
    fact: fact("action 2: R7 := h ≥ HEIGHT · action 3: HEIGHT ≥ R7 + 43200"),
    figure: "exit-timeline",
    lines: { contract: "basis", from: 446, to: 465 },
    terms: ["refund", "refund-period", "r7"],
    sources: ["bt-basis-es"],
  },
  {
    id: "clearing",
    n: 10,
    title: t("Moving debt without the chain", "Перемещение долга без блокчейна"),
    lede: t("Debts can form loops, and loops can be cleared. Today this works only in part.", "Долги могут замыкаться в кольца, а кольца можно гасить взаимозачётом. Сейчас это работает лишь отчасти."),
    body: [
      t("If Alice owes Bob, Bob owes Carol and Carol owes Alice, the smallest debt in the loop can be cancelled for all three.", "Если Алиса должна Бобу, Боб — Кэрол, а Кэрол — Алисе, самый маленький долг в кольце можно списать сразу у всех троих."),
      t("Totals never go down, so today a loop cannot be cleared by lowering notes.", "Итоги никогда не уменьшаются, поэтому сейчас кольцо нельзя закрыть уменьшением расписок."),
      t("It can be cleared on chain: several reserves are redeemed in one atomic transaction.", "Его можно закрыть в блокчейне: несколько резервов погашаются одной атомарной транзакцией."),
      t("Or the members agree not to redeem the cleared part. That rests on their word.", "Или участники договариваются не погашать закрытую часть. Это держится на их слове."),
      t("Novation, moving Alice's debt from Bob to Carol, works the same way: Alice signs a new note to Carol, and Bob refrains from redeeming that part.", "Новация — перенос долга Алисы с Боба на Кэрол — работает так же: Алиса выписывает Кэрол новую расписку, а Боб не погашает эту часть."),
      t("A decrease signed by the creditor is described in the source but not implemented.", "Уменьшение долга с подписью кредитора описано в исходниках, но не реализовано."),
    ],
    fact: fact("totals never decrease · a decrease needs the creditor's consent (future work)", "итоги не уменьшаются · уменьшение требует согласия кредитора (в планах)"),
    figure: "clearing-loop",
    lines: { contract: "basis", from: 64, to: 82 },
    terms: ["clearing", "netting", "novation", "exchange"],
    sources: ["bt-basis-es", "bt-spec-cross-tracker", "bt-22"],
  },
];
