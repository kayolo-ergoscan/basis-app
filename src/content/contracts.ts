// Annotated reserve contracts for the Contract X-ray (/learn/contract, /play "try to cheat").
//
// - `contracts.basis` / `contracts.token`: verbatim source (CC0) at BetterMoneyLabs/basis-tracker@43e2173.
// - `annotations[contract]`: sorted, non-overlapping blocks [{ from, to, titleEN, titleRU, textEN, textRU, kind, … }].
// - `reasonLines[checkId]`: for every engine check id (src/protocol/reserve.ts `ReserveCheckId`) the exact lines in
//   basis.es and basis-token.es. An empty list means "this check does not exist in that contract".
// - `actionLines[contract][action]`: the lines that belong to each spending path (0 redeem, 1 top up, 2 initiate
//   refund, 3 complete refund), plus the shared prelude.
//
// Line numbers are 1-based and inclusive, exactly as a code editor shows them.

import type { ReserveCheckId } from "@/protocol/reserve";
import { basisEs, basisTokenEs, GIT_REF, GIT_REF_SHORT, GIT_REF_DATE, type ContractSource } from "./contractSource";
import { t, type ContractId, type LineRange, type Text } from "./types";

export { GIT_REF, GIT_REF_SHORT, GIT_REF_DATE };
export type { ContractSource };

export const contracts: Record<ContractId, ContractSource> = { basis: basisEs, token: basisTokenEs };

export type AnnotationKind = "register" | "action" | "check" | "signature" | "emergency" | "refund" | "constant";

/** One highlighted block of a contract. The shape the X-ray renders. */
export interface Annotation {
  id: string;
  from: number;
  to: number;
  titleEN: string;
  titleRU: string;
  textEN: string;
  textRU: string;
  kind: AnnotationKind;
  /** "doc" = the long comment header (lines before the code), "code" = executable script. */
  section: "doc" | "code";
  /** Spending path the block belongs to; absent for the shared prelude and the header. */
  action?: 0 | 1 | 2 | 3;
  /** Engine check ids decided (at least partly) inside this block. */
  checks?: ReserveCheckId[];
  /** Set when a source comment in this block is stale or misleading; say it next to the block. */
  warningEN?: string;
  warningRU?: string;
}

interface Def {
  id: string;
  kind: AnnotationKind;
  section?: "doc" | "code";
  action?: 0 | 1 | 2 | 3;
  basis?: [number, number];
  token?: [number, number];
  title: Text;
  text: Text;
  /** Token-contract wording when it differs. */
  tokenTitle?: Text;
  tokenText?: Text;
  checks?: ReserveCheckId[];
  tokenChecks?: ReserveCheckId[];
  warning?: Text;
  tokenWarning?: Text;
}

const STALE_BOTH_SIGS = t(
  "Stale comment: an empty tracker signature is accepted once the tracker box is older than 2 160 blocks (the emergency path, lines below). The owner's signature is always required.",
  "Устаревший комментарий: пустая подпись трекера принимается, когда боксу трекера больше 2 160 блоков (аварийный путь, см. ниже). Подпись владельца нужна всегда.",
);
const STALE_MESSAGE = t(
  "Stale comment: this message lacks the tracker NFT id. Since the C3 fix (October 2026) every signature covers 80 bytes: key, total, timestamp and R6.",
  "Устаревший комментарий: здесь нет id NFT трекера. После исправления C3 (октябрь 2026) каждая подпись покрывает 80 байт: ключ, итог, метку времени и R6.",
);

const DEFS: Def[] = [
  // ---------------- header comments (doc) ----------------
  {
    id: "doc-header", kind: "action", section: "doc", basis: [1, 4], token: [1, 5],
    title: t("What this script is", "Что это за скрипт"),
    text: t(
      "The reserve contract: an Ergo box that backs off-chain notes. The link points to kushti's forum thread where the design was discussed.",
      "Контракт резерва: бокс в Ergo, который обеспечивает офчейн-расписки. Ссылка ведёт на ветку форума, где kushti обсуждал устройство.",
    ),
    tokenText: t(
      "The same contract for a token reserve: the backing is one token instead of ERG, and notes are in that token.",
      "Тот же контракт для резерва в токене: обеспечение — один токен вместо ERG, и расписки выражены в нём же.",
    ),
  },
  {
    id: "doc-usecases", kind: "action", section: "doc", basis: [6, 12], token: [7, 12],
    title: t("Use cases the authors list", "Сценарии, которые называют авторы"),
    text: t(
      "Payments with credit, mesh networks with poor Internet, agent-to-agent payments, pay-per-content, micropayments, p2p networks.",
      "Платежи в кредит, mesh-сети без стабильного интернета, платежи между агентами, оплата контента, микроплатежи, p2p-сети.",
    ),
  },
  {
    id: "doc-properties", kind: "check", section: "doc", basis: [15, 18],
    title: t("Design properties", "Свойства схемы"),
    text: t(
      "Payments can start without any reserve. The tracker is only minimally trusted. The contract prevents double redemption.",
      "Платить можно до того, как появится резерв. Трекеру доверяют минимально. Контракт не даёт погасить одно и то же дважды.",
    ),
  },
  {
    id: "doc-how", kind: "signature", section: "doc", basis: [20, 44], token: [14, 38],
    title: t("How it works, in the authors' words", "Как это работает, словами авторов"),
    text: t(
      "A tracker keeps one ever-growing total per pair, hash(A‖B) → totalDebt, and commits its digest on chain. The reserve keeps what was already redeemed per pair. Lines 43–44 describe the self-note A → A used for partial withdrawals.",
      "Трекер хранит по одному растущему итогу на пару, hash(A‖B) → totalDebt, и фиксирует дайджест в блокчейне. Резерв хранит, сколько уже погашено по каждой паре. Строки 43–44 описывают расписку самому себе (A → A) для частичного вывода.",
    ),
    tokenText: t(
      "The same model as basis.es. Lines 37–38 describe the self-note A → A used for partial withdrawals.",
      "Та же модель, что в basis.es. Строки 37–38 описывают расписку самому себе (A → A) для частичного вывода.",
    ),
    warning: STALE_BOTH_SIGS,
    tokenWarning: STALE_BOTH_SIGS,
  },
  {
    id: "doc-refund", kind: "refund", section: "doc", basis: [46, 62], token: [40, 56],
    title: t("Refund: the owner's exit", "Возврат резерва: выход владельца"),
    text: t(
      "Two phases. First the owner sets R7; after 43 200 blocks (≈ 60 days) the owner may take everything. Creditors can redeem during the wait and even after it.",
      "Две фазы. Сначала владелец записывает R7; через 43 200 блоков (≈ 60 дней) он может забрать всё. Кредиторы могут погашать и во время ожидания, и после него.",
    ),
  },
  {
    id: "doc-novation", kind: "action", section: "doc", basis: [64, 82], token: [58, 76],
    title: t("Moving a debt (novation)", "Перевод долга (новация)"),
    text: t(
      "A can sign a new note to C to pay for B's purchase. Totals never go down, so B's part is not reduced: B simply refrains from redeeming it. A creditor-signed decrease is future work.",
      "A может выписать новую расписку C в счёт покупки B. Итоги никогда не уменьшаются, поэтому долг перед B не снижается: B просто не погашает эту часть. Уменьшение с подписью кредитора пока не реализовано.",
    ),
  },
  {
    id: "doc-security", kind: "check", section: "doc", basis: [84, 93], token: [78, 87],
    title: t("Security notes in the source", "Заметки о безопасности в исходнике"),
    text: t(
      "The tracker cannot steal: the owner's signature is required. It can re-order redemptions, which matters when a reserve is short.",
      "Трекер не может украсть: нужна подпись владельца. Но он может менять порядок погашений, а это важно, когда резерва не хватает.",
    ),
  },
  {
    id: "doc-workflow", kind: "signature", section: "doc", basis: [95, 113], token: [89, 107],
    title: t("Normal workflow", "Обычный сценарий"),
    text: t(
      "B may publish an acceptance policy, so A can pay without asking. A signs the new total, the tracker co-signs and commits, B redeems when needed.",
      "B может опубликовать политику приёма, и тогда A платит без вопросов. A подписывает новый итог, трекер подписывает и фиксирует, B погашает, когда нужно.",
    ),
    warning: STALE_MESSAGE,
    tokenWarning: STALE_MESSAGE,
  },
  {
    id: "doc-triangle", kind: "action", section: "doc", basis: [115, 125], token: [109, 119],
    title: t("Triangular trade", "Треугольная сделка"),
    text: t(
      "A owes B; B buys from C; with A's consent A's debt is pointed at C. Today this works only as an increase-only new note A → C.",
      "A должен B; B покупает у C; с согласия A его долг переводится на C. Сейчас это работает только как новая расписка A → C без уменьшения старой.",
    ),
  },
  {
    id: "doc-tracker-role", kind: "check", section: "doc", basis: [127, 134], token: [121, 128],
    title: t("The tracker's role", "Роль трекера"),
    text: t(
      "Trackers can be one server or a federation, global or local. Each tracker's network meets the others on Ergo.",
      "Трекер может быть одним сервером или федерацией, глобальным или местным. Сети разных трекеров встречаются в Ergo.",
    ),
  },
  {
    id: "doc-pros", kind: "action", section: "doc", basis: [136, 140], token: [130, 134],
    title: t("Why off-chain", "Зачем офчейн"),
    text: t(
      "No on-chain fee for a payment. Credit can come first, and a reserve can be created later to pay for work already done.",
      "За платёж не берётся комиссия в блокчейне. Сначала можно дать в кредит, а резерв создать позже — чтобы оплатить уже сделанное.",
    ),
  },
  {
    id: "doc-examples", kind: "action", section: "doc", basis: [142, 173],
    title: t("Examples in the source", "Примеры в исходнике"),
    text: t(
      "An agent economy, a triangular trade and trading in an area with rare connectivity. They are design sketches, not demos you can run.",
      "Экономика агентов, треугольная сделка и торговля там, где связь бывает редко. Это наброски, а не готовые демо.",
    ),
  },
  {
    id: "doc-registers", kind: "register", section: "doc", basis: [175, 185], token: [136, 147],
    title: t("Registers R4–R7", "Регистры R4–R7"),
    text: t(
      "R4 owner key. R5 the reserve's own tree: hash(owner‖receiver) → timestamp ‖ redeemed. R6 the tracker NFT id. R7 the refund height, absent or 0 when none.",
      "R4 — ключ владельца. R5 — собственное дерево резерва: hash(владелец‖получатель) → метка времени ‖ погашено. R6 — id NFT трекера. R7 — высота начала возврата, нет или 0, если возврата нет.",
    ),
    tokenText: t(
      "Token #1 is the backing token. R4 owner key, R5 the redemption tree, R6 the tracker NFT id, R7 the refund height.",
      "Токен #1 — токен обеспечения. R4 — ключ владельца, R5 — дерево погашений, R6 — id NFT трекера, R7 — высота начала возврата.",
    ),
  },
  {
    id: "doc-actions", kind: "action", section: "doc", basis: [187, 191], token: [149, 153],
    title: t("Four actions", "Четыре действия"),
    text: t("Redeem (0), top up (1), initiate refund (2), complete refund (3).", "Погашение (0), пополнение (1), начало возврата (2), завершение возврата (3)."),
  },
  {
    id: "doc-tracker-box", kind: "register", section: "doc", basis: [193, 200], token: [155, 162],
    title: t("The tracker box", "Бокс трекера"),
    text: t(
      "R4 is the tracker's key and R5 its AVL+ tree of totals. The reserve reads it as a data input and checks the note against it.",
      "R4 — ключ трекера, R5 — его AVL+-дерево итогов. Резерв читает бокс как data-вход и сверяет с ним расписку.",
    ),
  },
  {
    id: "doc-vars", kind: "register", section: "doc", basis: [202, 216], token: [164, 178],
    title: t("Context variables #1–#8", "Контекстные переменные #1–#8"),
    text: t(
      "What a redemption must attach: receiver, both signatures, total, timestamp and three AVL+ proofs. #7 must be absent on a pair's first redemption and present afterwards.",
      "Что прикладывает погашение: получателя, обе подписи, итог, метку времени и три AVL+-доказательства. #7 не передают при первом погашении пары и передают при всех следующих.",
    ),
  },
  {
    id: "doc-index", kind: "action", section: "doc", basis: [218, 221], token: [180, 181],
    title: t("Why the output index is a variable", "Зачем индекс выхода в переменной"),
    text: t(
      "Several reserves can be spent in one transaction, each pointing at its own output. This is what makes atomic clearing possible.",
      "В одной транзакции можно потратить несколько резервов, и каждый указывает на свой выход. На этом держится атомарный клиринг.",
    ),
  },

  // ---------------- prelude (code, every path) ----------------
  {
    id: "action-byte", kind: "action", basis: [223, 225], token: [182, 184],
    title: t("Action byte #0", "Байт действия #0"),
    text: t(
      "Context variable #0 = action × 10 + output index. 0x00 redeems into output 0; 0x0a tops up into output 0.",
      "Контекстная переменная #0 = действие × 10 + индекс выхода. 0x00 — погашение в выход 0; 0x0a — пополнение в выход 0.",
    ),
    checks: ["actionVar"],
  },
  {
    id: "owner-key", kind: "register", basis: [227, 227], token: [186, 186],
    title: t("Owner key from R4", "Ключ владельца из R4"),
    text: t("The reserve's owner is the group element in R4. Notes must be signed by this key.", "Владелец резерва — элемент группы в R4. Расписки должны быть подписаны этим ключом."),
    checks: ["ownerKey"],
  },
  {
    id: "self-out", kind: "action", basis: [228, 228], token: [187, 187],
    title: t("The reserve's own output", "Собственный выход резерва"),
    text: t("The box must re-create itself at OUTPUTS(index). If that output does not exist, the script fails.", "Бокс обязан воссоздать себя в OUTPUTS(index). Если такого выхода нет, скрипт падает."),
    checks: ["outputExists"],
  },
  {
    id: "refund-period", kind: "constant", basis: [230, 231], token: [189, 190],
    title: t("Refund period: 43 200 blocks", "Срок возврата: 43 200 блоков"),
    text: t("720 blocks a day × 60 days. The only time constant of the refund.", "720 блоков в день × 60 дней. Единственная временная константа возврата."),
    checks: ["refundPeriodOver"],
  },
  {
    id: "refund-height", kind: "refund", basis: [233, 234], token: [192, 193],
    title: t("Refund height from R7", "Высота возврата из R7"),
    text: t("R7 holds the height at which the owner announced a refund; 0 or absent means none.", "R7 хранит высоту, на которой владелец объявил возврат; 0 или пусто — возврата нет."),
    checks: ["refundHeightRead"],
  },
  {
    id: "token-slots", kind: "register", token: [195, 198],
    title: t("Token slots #0 and #1", "Слоты токенов #0 и #1"),
    text: t("Token #0 is the reserve's NFT, token #1 the backing token. The script reads both ids.", "Токен #0 — NFT резерва, токен #1 — токен обеспечения. Скрипт читает оба id."),
    checks: ["reserveTokens"],
  },
  {
    id: "unique-input", kind: "check", basis: [236, 245], token: [200, 205],
    title: t("One reserve input per owner", "Один вход резерва на владельца"),
    text: t(
      "Exactly one input of this script with this owner key may be spent. Without it, two reserves could share one output (finding C2), and anyone could take the difference through an unsigned top-up.",
      "Можно потратить ровно один вход этого скрипта с этим ключом владельца. Без этого два резерва могли бы делить один выход (находка C2), и кто угодно забрал бы разницу через пополнение без подписи.",
    ),
    checks: ["uniqueReserveInput"],
  },
  {
    id: "self-preserved", kind: "check", basis: [247, 253], token: [207, 211],
    title: t("What every path keeps", "Что сохраняет любой путь"),
    text: t(
      "The new box keeps the same script, the same tokens, the owner key (R4) and the tracker NFT (R6). R6 is fixed forever: a reserve is bound to one tracker.",
      "Новый бокс сохраняет тот же скрипт, те же токены, ключ владельца (R4) и NFT трекера (R6). R6 не меняется никогда: резерв навсегда привязан к одному трекеру.",
    ),
    tokenText: t(
      "Same script, owner key (R4) and tracker NFT (R6). Tokens are checked separately below, because token #1's amount changes.",
      "Тот же скрипт, ключ владельца (R4) и NFT трекера (R6). Токены проверяются ниже отдельно: количество токена #1 меняется.",
    ),
    checks: ["uniqueReserveInput", "scriptPreserved", "tokensPreserved", "ownerPreserved", "trackerNftPreserved"],
    tokenChecks: ["uniqueReserveInput", "scriptPreserved", "ownerPreserved", "trackerNftPreserved"],
  },
  {
    id: "token-ids-preserved", kind: "check", token: [213, 221],
    title: t("Token ids stay in place", "Id токенов остаются на месте"),
    text: t(
      "Exactly two tokens, the same ids in the same slots, and the NFT amount unchanged, so no extra reserve NFTs can be minted.",
      "Ровно два токена, те же id в тех же слотах, количество NFT не меняется — лишние NFT резерва не выпустить.",
    ),
    checks: ["tokenIdsPreserved"],
  },
  {
    id: "erg-preserved", kind: "check", token: [223, 227],
    title: t("ERG never leaves on redeem or top up", "ERG не уходит при погашении и пополнении"),
    text: t(
      "The box's ERG may not decrease. Before this fix (finding C6) anyone could add one token unit and take the ERG.",
      "ERG в боксе не может уменьшиться. До исправления (находка C6) любой мог добавить одну единицу токена и забрать ERG.",
    ),
    checks: ["ergPreserved"],
  },

  // ---------------- action 0: redeem ----------------
  {
    id: "redeem-vars", kind: "action", action: 0, basis: [255, 267], token: [229, 241],
    title: t("Redeem (action 0)", "Погашение (действие 0)"),
    text: t("The holder takes value from the reserve. The comment lists the eight context variables it reads.", "Держатель забирает ценность из резерва. В комментарии — восемь контекстных переменных, которые читает этот путь."),
  },
  {
    id: "generator", kind: "signature", action: 0, basis: [269, 270], token: [243, 244],
    title: t("The generator g", "Генератор g"),
    text: t("The secp256k1 base point, used to check both Schnorr signatures.", "Базовая точка secp256k1, нужна для проверки обеих подписей Шнорра."),
  },
  {
    id: "tracker-read", kind: "register", action: 0, basis: [272, 277], token: [246, 251],
    title: t("Reading the tracker box", "Чтение бокса трекера"),
    text: t(
      "Data input 0 is the tracker box: its token #0 (the NFT), R5 (the committed tree) and R4 (the tracker key). The holder of that box does not matter; only these values do.",
      "Data-вход 0 — бокс трекера: его токен #0 (NFT), R5 (зафиксированное дерево) и R4 (ключ трекера). Кому принадлежит бокс, неважно — важны только эти значения.",
    ),
  },
  {
    id: "tracker-id", kind: "check", action: 0, basis: [279, 280], token: [253, 254],
    title: t("Check 1 · the right tracker", "Проверка 1 · тот самый трекер"),
    text: t("The data input must carry the NFT named in the reserve's R6. Any other tracker box is ignored.", "Data-вход должен нести NFT, указанный в R6 резерва. Бокс любого другого трекера не подходит."),
    checks: ["trackerIdCorrect"],
  },
  {
    id: "receiver", kind: "signature", action: 0, basis: [282, 286], token: [256, 260],
    title: t("Who is redeeming (#1)", "Кто погашает (#1)"),
    text: t("Context variable #1 is the receiver's public key. The owner's key bytes come from R4.", "Контекстная переменная #1 — открытый ключ получателя. Байты ключа владельца берутся из R4."),
  },
  {
    id: "debt-key", kind: "signature", action: 0, basis: [288, 292],
    title: t("The debt key", "Ключ долга"),
    text: t(
      "key = blake2b256(owner ‖ receiver), 32 bytes. The same key indexes the tracker's tree and the reserve's tree.",
      "key = blake2b256(владелец ‖ получатель), 32 байта. Этот же ключ используется и в дереве трекера, и в дереве резерва.",
    ),
  },
  {
    id: "debt-key-token", kind: "signature", action: 0, token: [262, 270],
    title: t("The debt key includes the token", "Ключ долга включает токен"),
    text: t(
      "debtKey = blake2b256(owner ‖ receiver ‖ tokenId). ERG debt and token debt between the same two people are different notes.",
      "debtKey = blake2b256(владелец ‖ получатель ‖ tokenId). Долг в ERG и долг в токене между теми же людьми — разные расписки.",
    ),
  },
  {
    id: "reserve-key-token", kind: "signature", action: 0, token: [272, 276],
    title: t("The reserve tree keeps the short key", "Дерево резерва хранит короткий ключ"),
    text: t("The reserve's own tree uses blake2b256(owner ‖ receiver) without the token id.", "Собственное дерево резерва использует blake2b256(владелец ‖ получатель) без id токена."),
  },
  {
    id: "total-ts", kind: "register", action: 0, basis: [294, 296], token: [278, 280],
    title: t("Total (#3) and timestamp (#4)", "Итог (#3) и метка времени (#4)"),
    text: t("The note's cumulative total and its timestamp in milliseconds.", "Накопленный итог расписки и её метка времени в миллисекундах."),
  },
  {
    id: "tracker-debt", kind: "check", action: 0, basis: [298, 303], token: [282, 287],
    title: t("Check 2 · the total is in the tracker's tree", "Проверка 2 · итог есть в дереве трекера"),
    text: t(
      "Proof #8 looks up the key in the committed tree, and the value must equal #3. A note the tracker never committed cannot be redeemed, on any path.",
      "Доказательство #8 ищет ключ в зафиксированном дереве, и значение должно совпасть с #3. Расписку, которую трекер не зафиксировал, не погасить ни одним путём.",
    ),
    checks: ["trackerDebtCorrect"],
  },
  {
    id: "owner-sig-bytes", kind: "signature", action: 0, basis: [305, 306], token: [289, 290],
    title: t("The owner's signature (#2)", "Подпись владельца (#2)"),
    text: t("65 bytes: a (33) ‖ z (32), the issuer's signature from the note.", "65 байт: a (33) ‖ z (32) — подпись эмитента из расписки."),
  },
  {
    id: "redeemed-before", kind: "check", action: 0, basis: [308, 322], token: [292, 306],
    title: t("What was redeemed before (#7)", "Что уже погашено (#7)"),
    text: t(
      "With proof #7 the script reads the stored timestamp and the amount already redeemed for this pair. Without #7 both are 0, which only works for a first redemption.",
      "С доказательством #7 скрипт читает сохранённую метку времени и сумму, уже погашенную по этой паре. Без #7 обе равны 0 — так можно только при первом погашении.",
    ),
  },
  {
    id: "timestamp", kind: "check", action: 0, basis: [324, 330], token: [308, 313],
    title: t("Check 3 · no older note", "Проверка 3 · не старше прежней"),
    text: t(
      "timestamp ≥ stored timestamp. Equal is allowed, so the rest of a partly redeemed note can be taken after a top-up.",
      "timestamp ≥ сохранённой метки. Равенство допускается: остаток частично погашенной расписки можно забрать после пополнения.",
    ),
    checks: ["timestampCorrect"],
  },
  {
    id: "emergency-clock", kind: "emergency", action: 0, basis: [332, 338], token: [315, 321],
    title: t("The emergency clock", "Аварийные часы"),
    text: t(
      "HEIGHT − creation height of the tracker box > 2 160 (≈ 3 days). The tracker resets this clock every time it re-creates its box.",
      "HEIGHT − высота создания бокса трекера > 2 160 (≈ 3 дня). Трекер сбрасывает эти часы каждый раз, когда пересоздаёт свой бокс.",
    ),
    checks: ["trackerSigValid"],
  },
  {
    id: "message", kind: "signature", action: 0, basis: [340, 343], token: [323, 327],
    title: t("The signed message: 80 bytes", "Подписываемое сообщение: 80 байт"),
    text: t(
      "key (32) ‖ total (8, big-endian) ‖ timestamp (8) ‖ tracker NFT id (32). Binding R6 stops a note from being replayed against another tracker (fix C3).",
      "key (32) ‖ итог (8, big-endian) ‖ метка времени (8) ‖ id NFT трекера (32). Привязка к R6 не даёт повторить расписку у другого трекера (исправление C3).",
    ),
    tokenText: t(
      "Here the key is debtKey, so the signature also commits to the token.",
      "Здесь ключ — debtKey, поэтому подпись фиксирует и токен.",
    ),
  },
  {
    id: "tracker-sig-bytes", kind: "signature", action: 0, basis: [345, 350], token: [329, 334],
    title: t("The tracker's signature (#6)", "Подпись трекера (#6)"),
    text: t("#6 is always present. It may be empty, which means: use the emergency rule.", "#6 передают всегда. Она может быть пустой — это значит «действует аварийное правило»."),
  },
  {
    id: "tracker-sig", kind: "signature", action: 0, basis: [352, 370], token: [336, 354],
    title: t("Verifying the tracker's Schnorr signature", "Проверка подписи Шнорра трекера"),
    text: t(
      "e = blake2b256(a ‖ message ‖ trackerKey), then g^z must equal a · key^e. A non-empty signature must verify, even after the emergency window opens.",
      "e = blake2b256(a ‖ сообщение ‖ ключ трекера), затем g^z должно равняться a · ключ^e. Непустая подпись обязана быть верной даже после открытия аварийного окна.",
    ),
    checks: ["trackerSigValid"],
  },
  {
    id: "tracker-sig-valid", kind: "emergency", action: 0, basis: [372, 379], token: [356, 363],
    title: t("Check 5 · the tracker's signature, or the emergency rule", "Проверка 5 · подпись трекера или аварийное правило"),
    text: t(
      "If #6 is filled it must verify. If it is empty, the tracker box must be older than 2 160 blocks. Nothing else changes on the emergency path.",
      "Если #6 заполнена, она должна быть верной. Если пустая, боксу трекера должно быть больше 2 160 блоков. Больше на аварийном пути ничего не меняется.",
    ),
    checks: ["trackerSigValid"],
  },
  {
    id: "amount", kind: "check", action: 0, basis: [381, 385],
    title: t("Check 4 · the amount", "Проверка 4 · сумма"),
    text: t(
      "redeemed = SELF.value − selfOut.value, and 0 < redeemed ≤ total − already redeemed. There is no fee here: the receiver gets exactly this amount.",
      "redeemed = SELF.value − selfOut.value, и 0 < redeemed ≤ итог − уже погашено. Комиссии здесь нет: получатель получает ровно эту сумму.",
    ),
    checks: ["properlyRedeemed", "trackerSigValid"],
  },
  {
    id: "amount-token", kind: "check", action: 0, token: [365, 373],
    title: t("Check 4 · the amount in tokens", "Проверка 4 · сумма в токенах"),
    text: t(
      "redeemed = token #1 in − token #1 out, and 0 < redeemed ≤ total − already redeemed. No fee is taken.",
      "redeemed = токен #1 на входе − токен #1 на выходе, и 0 < redeemed ≤ итог − уже погашено. Комиссия не берётся.",
    ),
    checks: ["properlyRedeemed", "trackerSigValid"],
  },
  {
    id: "owner-sig", kind: "signature", action: 0, basis: [387, 398], token: [375, 386],
    title: t("Check 6 · the owner signed this total", "Проверка 6 · владелец подписал этот итог"),
    text: t(
      "The same Schnorr check with the owner's key from R4. Nobody can redeem a total the issuer did not sign, the tracker included.",
      "Та же проверка Шнорра с ключом владельца из R4. Никто, включая трекер, не погасит итог, который эмитент не подписывал.",
    ),
    checks: ["properReserveSignature"],
  },
  {
    id: "new-redeemed", kind: "check", action: 0, basis: [400, 405], token: [388, 393],
    title: t("The new redeemed total (#5)", "Новая сумма погашений (#5)"),
    text: t(
      "The reserve stores timestamp ‖ (already redeemed + this redemption) under the key. #5 proves the tree update.",
      "Резерв записывает под ключ метку времени ‖ (уже погашено + текущее погашение). #5 доказывает обновление дерева.",
    ),
  },
  {
    id: "insert-or-update", kind: "check", action: 0, basis: [406, 417], token: [394, 405],
    title: t("Insert or update (the C1 fix)", "Вставка или обновление (исправление C1)"),
    text: t(
      "Without #7 the script uses insert, which fails when the key exists. So omitting #7 cannot replay a note that was already redeemed.",
      "Без #7 скрипт делает insert, а он падает, если ключ уже есть. Поэтому, опустив #7, нельзя повторно погасить уже погашенную расписку.",
    ),
    checks: ["properRedemptionTree"],
  },
  {
    id: "tree-out", kind: "check", action: 0, basis: [418, 419], token: [406, 407],
    title: t("Check 7 · the new tree is in R5", "Проверка 7 · новое дерево в R5"),
    text: t("The output's R5 must equal the updated tree exactly.", "R5 выхода должен в точности совпасть с обновлённым деревом."),
    checks: ["properRedemptionTree"],
  },
  {
    id: "refund-kept-0", kind: "refund", action: 0, basis: [421, 423], token: [409, 411],
    title: t("Check 8 · a pending refund stays", "Проверка 8 · объявленный возврат сохраняется"),
    text: t("A redemption cannot cancel or move the owner's refund announcement in R7.", "Погашение не может отменить или сдвинуть объявленный владельцем возврат в R7."),
    checks: ["refundPreserved"],
  },
  {
    id: "receiver-sig", kind: "signature", action: 0, basis: [425, 426], token: [413, 414],
    title: t("Check 9 · the receiver signs the transaction", "Проверка 9 · получатель подписывает транзакцию"),
    text: t(
      "proveDlog(receiver): only the creditor can spend the reserve this way. The contract does not say where the money goes; the receiver's signature covers that.",
      "proveDlog(получатель): так потратить резерв может только кредитор. Контракт не указывает, куда уходят деньги, — это покрывает подпись получателя.",
    ),
    checks: ["receiverSignature"],
  },
  {
    id: "redeem-all", kind: "check", action: 0, basis: [428, 437], token: [416, 427],
    title: t("All conditions at once", "Все условия разом"),
    text: t(
      "Every condition must hold together, or the whole transaction is invalid.",
      "Все условия должны выполниться вместе, иначе транзакция недействительна целиком.",
    ),
    tokenText: t(
      "Two more than in basis.es: token ids preserved and ERG not decreased.",
      "На два больше, чем в basis.es: id токенов сохранены и ERG не уменьшился.",
    ),
    checks: ["uniqueReserveInput", "trackerIdCorrect", "trackerDebtCorrect", "timestampCorrect", "properRedemptionTree", "properReserveSignature", "properlyRedeemed", "refundPreserved", "receiverSignature"],
    tokenChecks: ["uniqueReserveInput", "tokenIdsPreserved", "ergPreserved", "trackerIdCorrect", "trackerDebtCorrect", "timestampCorrect", "properRedemptionTree", "properReserveSignature", "properlyRedeemed", "refundPreserved", "receiverSignature"],
  },

  // ---------------- action 1: top up ----------------
  {
    id: "top-up", kind: "action", action: 1, basis: [438, 445],
    title: t("Top up (action 1)", "Пополнение (действие 1)"),
    text: t(
      "Anyone may add at least 0.1 ERG. No signature is needed. R5 and R7 stay as they were.",
      "Добавить не меньше 0,1 ERG может кто угодно. Подпись не нужна. R5 и R7 остаются прежними.",
    ),
    checks: ["treePreserved", "refundPreserved", "topUpAmount"],
  },
  {
    id: "top-up-token", kind: "action", action: 1, token: [428, 443],
    title: t("Top up (action 1)", "Пополнение (действие 1)"),
    text: t(
      "Anyone may add at least one raw unit of the backing token (for example 0.001 USE at 3 decimals). ERG may not decrease.",
      "Добавить не меньше одной минимальной единицы токена обеспечения (например, 0,001 USE при трёх знаках) может кто угодно. ERG не может уменьшиться.",
    ),
    warning: t(
      "Stale comment on lines 434–435: the ERG contract's minimum top-up is 100 000 000 nanoERG (0.1 ERG), not 1 000 000.",
      "Устаревший комментарий в строках 434–435: минимум пополнения в ERG-контракте — 100 000 000 nanoERG (0,1 ERG), а не 1 000 000.",
    ),
    checks: ["tokenIdsPreserved", "ergPreserved", "treePreserved", "refundPreserved", "topUpAmount"],
  },

  // ---------------- action 2: initiate refund ----------------
  {
    id: "refund-start", kind: "refund", action: 2, basis: [446, 456], token: [444, 456],
    title: t("Initiate refund (action 2)", "Начало возврата (действие 2)"),
    text: t(
      "The owner signs and writes a height ≥ HEIGHT into R7. Nothing may be taken out yet, and it works only once: the clock cannot be reset.",
      "Владелец подписывает и записывает в R7 высоту ≥ HEIGHT. Забрать пока ничего нельзя, и сделать это можно один раз: часы не перезапустить.",
    ),
    checks: ["valueNotDecreased", "treePreserved", "refundHeightValid", "refundNotStarted", "ownerSignature"],
  },

  // ---------------- action 3: complete refund ----------------
  {
    id: "refund-complete", kind: "refund", action: 3, basis: [457, 465], token: [457, 465],
    title: t("Complete refund (action 3)", "Завершение возврата (действие 3)"),
    text: t(
      "After R7 + 43 200 blocks the owner signs and takes everything. Creditors had about 60 days to redeem first.",
      "Через R7 + 43 200 блоков владелец подписывает и забирает всё. У кредиторов было около 60 дней, чтобы погасить раньше.",
    ),
    checks: ["refundStarted", "refundPeriodOver", "ownerSignature"],
  },
  {
    id: "no-other-action", kind: "check", basis: [466, 468], token: [466, 468],
    title: t("Any other action fails", "Любое другое действие отклоняется"),
    text: t("sigmaProp(false): there are exactly four ways to spend a reserve.", "sigmaProp(false): потратить резерв можно ровно четырьмя способами."),
    checks: ["invalidAction"],
  },
];

function build(contract: ContractId): Annotation[] {
  const out: Annotation[] = [];
  for (const d of DEFS) {
    const range = contract === "basis" ? d.basis : d.token;
    if (!range) continue;
    const title = contract === "token" && d.tokenTitle ? d.tokenTitle : d.title;
    const text = contract === "token" && d.tokenText ? d.tokenText : d.text;
    const warning = contract === "token" ? d.tokenWarning ?? (d.basis ? undefined : d.warning) : d.warning;
    const checks = contract === "token" ? d.tokenChecks ?? d.checks : d.checks;
    out.push({
      id: d.id,
      from: range[0],
      to: range[1],
      titleEN: title.en,
      titleRU: title.ru,
      textEN: text.en,
      textRU: text.ru,
      kind: d.kind,
      section: d.section ?? "code",
      ...(d.action !== undefined ? { action: d.action } : {}),
      ...(checks ? { checks } : {}),
      ...(warning ? { warningEN: warning.en, warningRU: warning.ru } : {}),
    });
  }
  return out.sort((a, b) => a.from - b.from);
}

export const annotations: Record<ContractId, Annotation[]> = { basis: build("basis"), token: build("token") };

export interface ReasonLines {
  basis: LineRange[];
  token: LineRange[];
}

const r = (from: number, to: number = from, action?: 0 | 1 | 2 | 3): LineRange => (action === undefined ? { from, to } : { from, to, action });

/**
 * Engine check id → the lines that decide it. Light these up when the engine reports the check as false/throws.
 * The first range is the definition; later ranges are where the same rule is applied in another branch.
 */
export const reasonLines: Record<ReserveCheckId, ReasonLines> = {
  actionVar: { basis: [r(223, 225)], token: [r(182, 184)] },
  outputExists: { basis: [r(228)], token: [r(187)] },
  ownerKey: { basis: [r(227)], token: [r(186)] },
  reserveTokens: { basis: [], token: [r(195, 198)] },
  refundHeightRead: { basis: [r(233, 234)], token: [r(192, 193)] },
  uniqueReserveInput: { basis: [r(236, 245), r(249)], token: [r(202, 205), r(208)] },
  scriptPreserved: { basis: [r(250)], token: [r(209)] },
  tokensPreserved: { basis: [r(251)], token: [] },
  tokenIdsPreserved: { basis: [], token: [r(213, 221), r(418, 418, 0), r(438, 438, 1), r(450, 450, 2)] },
  ergPreserved: { basis: [], token: [r(223, 227), r(419, 419, 0), r(439, 439, 1)] },
  ownerPreserved: { basis: [r(252)], token: [r(210)] },
  trackerNftPreserved: { basis: [r(253)], token: [r(211)] },
  trackerIdCorrect: { basis: [r(272, 280, 0)], token: [r(246, 254, 0)] },
  trackerDebtCorrect: { basis: [r(288, 303, 0)], token: [r(262, 270, 0), r(282, 287, 0)] },
  timestampCorrect: { basis: [r(308, 330, 0)], token: [r(292, 313, 0)] },
  properRedemptionTree: { basis: [r(400, 419, 0)], token: [r(388, 407, 0)] },
  properReserveSignature: { basis: [r(305, 306, 0), r(340, 343, 0), r(387, 398, 0)], token: [r(289, 290, 0), r(323, 327, 0), r(375, 386, 0)] },
  properlyRedeemed: { basis: [r(381, 385, 0)], token: [r(365, 373, 0)] },
  trackerSigValid: { basis: [r(332, 338, 0), r(345, 379, 0)], token: [r(315, 321, 0), r(329, 363, 0)] },
  refundPreserved: { basis: [r(421, 423, 0), r(443, 443, 1)], token: [r(409, 411, 0), r(441, 441, 1)] },
  receiverSignature: { basis: [r(425, 426, 0)], token: [r(413, 414, 0)] },
  treePreserved: { basis: [r(442, 442, 1), r(453, 453, 2)], token: [r(440, 440, 1), r(453, 453, 2)] },
  topUpAmount: { basis: [r(444, 444, 1)], token: [r(431, 432, 1), r(442, 442, 1)] },
  valueNotDecreased: { basis: [r(452, 452, 2)], token: [r(451, 452, 2)] },
  refundHeightValid: { basis: [r(454, 454, 2)], token: [r(454, 454, 2)] },
  refundNotStarted: { basis: [r(455, 455, 2)], token: [r(455, 455, 2)] },
  ownerSignature: { basis: [r(456, 456, 2), r(465, 465, 3)], token: [r(456, 456, 2), r(465, 465, 3)] },
  refundStarted: { basis: [r(463, 463, 3)], token: [r(463, 463, 3)] },
  refundPeriodOver: { basis: [r(464, 464, 3), r(230, 231)], token: [r(464, 464, 3), r(189, 190)] },
  invalidAction: { basis: [r(466, 468)], token: [r(466, 468)] },
};

/** Checks that exist in only one of the two contracts (empty list on the other side by design). */
export const CONTRACT_ONLY: Partial<Record<ReserveCheckId, ContractId>> = {
  reserveTokens: "token",
  tokenIdsPreserved: "token",
  ergPreserved: "token",
  tokensPreserved: "basis",
};

export type ActionKey = "prelude" | 0 | 1 | 2 | 3;

/** The lines of each spending path. The prelude runs for every action. */
export const actionLines: Record<ContractId, Record<ActionKey, LineRange[]>> = {
  basis: {
    prelude: [r(223, 253)],
    0: [r(255, 437, 0)],
    1: [r(438, 445, 1)],
    2: [r(446, 456, 2)],
    3: [r(457, 465, 3)],
  },
  token: {
    prelude: [r(182, 227)],
    0: [r(229, 427, 0)],
    1: [r(428, 443, 1)],
    2: [r(444, 456, 2)],
    3: [r(457, 465, 3)],
  },
};

/** Action names and the #0 byte for output index 0, for tabs. */
export const actionTabs: { action: 0 | 1 | 2 | 3; byte: string; label: Text; who: Text }[] = [
  { action: 0, byte: "0x00", label: t("Redeem", "Погашение"), who: t("the receiver signs", "подписывает получатель") },
  { action: 1, byte: "0x0a", label: t("Top up", "Пополнение"), who: t("anyone, no signature", "кто угодно, без подписи") },
  { action: 2, byte: "0x14", label: t("Initiate refund", "Начало возврата"), who: t("the owner signs", "подписывает владелец") },
  { action: 3, byte: "0x1e", label: t("Complete refund", "Завершение возврата"), who: t("the owner signs", "подписывает владелец") },
];

/** Things the contract deliberately does not check (say them next to the X-ray). */
export const notChecked: Text[] = [
  t("Where the payout goes: the receiver's signature on the transaction decides.", "Куда уходит выплата: это решает подпись получателя на транзакции."),
  t("How much stays in the reserve after a payout (the tracker keeps at least 0.001 ERG by its own rule).", "Сколько остаётся в резерве после выплаты (трекер оставляет минимум 0,001 ERG по своему правилу)."),
  t("Whether the reserve is big enough for all notes: coverage is a wallet and tracker policy.", "Хватает ли резерва на все расписки: покрытие — это политика кошелька и трекера."),
  t("The order of redemptions: whoever gets a valid transaction mined first is paid first.", "Порядок погашений: первым получает тот, чья корректная транзакция первой попала в блок."),
];

/** Context variables in the order the Scala serializer writes them (JavaScript objects reorder integer keys). */
export const contextVarOrder = {
  firstRedemption: [0, 5, 1, 6, 2, 3, 8, 4],
  laterRedemption: [0, 5, 1, 6, 2, 7, 3, 8, 4],
} as const;

/** Meaning of each context variable of a redemption. */
export const contextVars: { id: number; type: string; text: Text }[] = [
  { id: 0, type: "Byte", text: t("Action × 10 + output index (0x00 for a redemption into output 0).", "Действие × 10 + индекс выхода (0x00 — погашение в выход 0).") },
  { id: 1, type: "GroupElement", text: t("The receiver's public key.", "Открытый ключ получателя.") },
  { id: 2, type: "Coll[Byte]", text: t("The owner's 65-byte signature over the 80-byte message.", "65-байтная подпись владельца над 80-байтным сообщением.") },
  { id: 3, type: "Long", text: t("The note's cumulative total.", "Накопленный итог расписки.") },
  { id: 4, type: "Long", text: t("The note's timestamp, milliseconds.", "Метка времени расписки, миллисекунды.") },
  { id: 5, type: "Coll[Byte]", text: t("Proof for insert (first time) or insertOrUpdate into the reserve tree.", "Доказательство для insert (в первый раз) или insertOrUpdate в дереве резерва.") },
  { id: 6, type: "Coll[Byte]", text: t("The tracker's 65-byte signature, or empty on the emergency path.", "65-байтная подпись трекера или пустое значение на аварийном пути.") },
  { id: 7, type: "Coll[Byte]", text: t("Lookup proof in the reserve tree. Absent on the first redemption of a pair.", "Доказательство поиска в дереве резерва. Не передаётся при первом погашении пары.") },
  { id: 8, type: "Coll[Byte]", text: t("Lookup proof in the tracker's committed tree.", "Доказательство поиска в зафиксированном дереве трекера.") },
];
