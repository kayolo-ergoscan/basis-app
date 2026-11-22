// Glossary, EN and RU. This is also the reference terminology for every Russian string in the app:
// note = «расписка», redeem = «погасить», top up = «пополнить», refund = «возврат резерва», tracker = «трекер».

import { t, type Text } from "./types";

export type TermGroup = "notes" | "tracker" | "reserve" | "policy" | "clearing" | "crypto";

export interface Term {
  id: string;
  group: TermGroup;
  /** Display name. */
  en: string;
  ru: string;
  /** Other names people use (shown as "also: …"). */
  alsoEN?: string[];
  alsoRU?: string[];
  def: Text;
  /** A mono formula or literal, same in both languages. */
  code?: string;
  /** Related term ids. */
  see?: string[];
}

export const glossaryTitle: Text = t("Glossary", "Словарь");
export const glossaryGroups: Record<TermGroup, Text> = {
  notes: t("Notes", "Расписки"),
  tracker: t("Tracker", "Трекер"),
  reserve: t("Reserve", "Резерв"),
  policy: t("Policies", "Политики"),
  clearing: t("Clearing", "Клиринг"),
  crypto: t("Cryptography and chain", "Криптография и блокчейн"),
};

const T = (id: string, group: TermGroup, en: string, ru: string, def: Text, extra: Partial<Term> = {}): Term => ({ id, group, en, ru, def, ...extra });

export const glossary: Term[] = [
  // ---- notes ----
  T("note", "notes", "Note", "Расписка", t("A signed promise from one key to another: the cumulative total the issuer owes the receiver in one denomination.", "Подписанное обещание одного ключа другому: накопленный итог, который эмитент должен получателю в одной валюте."), { alsoEN: ["IOU", "debt note"], alsoRU: ["долговая расписка", "нота", "IOU"], see: ["cumulative-total", "pair"] }),
  T("issuer", "notes", "Issuer", "Эмитент", t("The key that signs a note and owes its total. An issuer may or may not have a reserve.", "Ключ, который подписывает расписку и должен её итог. Резерв у эмитента может быть, а может не быть."), { alsoEN: ["debtor"], alsoRU: ["должник"], see: ["reserve"] }),
  T("receiver", "notes", "Receiver", "Получатель", t("The key a note is owed to. Only the receiver can redeem it.", "Ключ, которому причитается расписка. Погасить её может только получатель."), { alsoEN: ["holder", "creditor"], alsoRU: ["держатель", "кредитор"], see: ["redemption"] }),
  T("pair", "notes", "Pair", "Пара", t("One issuer, one receiver, one denomination. Each pair has exactly one note.", "Один эмитент, один получатель, одна валюта. У каждой пары ровно одна расписка."), { alsoEN: ["edge"], alsoRU: ["ребро"], see: ["debt-key"] }),
  T("cumulative-total", "notes", "Cumulative total", "Накопленный итог", t("Everything the issuer ever promised the receiver on this pair. Payments raise it; it never goes down.", "Всё, что эмитент когда-либо обещал получателю по этой паре. Платежи увеличивают итог, и он никогда не уменьшается."), { code: "totalDebt (Long, context var #3)", see: ["outstanding", "redeemed-amount"] }),
  T("outstanding", "notes", "Outstanding", "Непогашенный остаток", t("What the receiver can still redeem: the total minus what was already redeemed.", "То, что получатель ещё может погасить: итог минус уже погашенное."), { code: "totalDebt − redeemedDebt" }),
  T("redeemed-amount", "notes", "Redeemed", "Погашено", t("The running sum already paid out of the issuer's reserve for this pair. The reserve stores it in R5.", "Нарастающая сумма, уже выплаченная из резерва эмитента по этой паре. Резерв хранит её в R5."), { see: ["r5"] }),
  T("debt-key", "notes", "Debt key", "Ключ долга", t("The 32-byte hash that names a pair in the tracker's tree and in the signed message. Token notes add the token id.", "32-байтный хеш, который обозначает пару в дереве трекера и в подписываемом сообщении. Для токенов добавляется id токена."), { code: "blake2b256(A ‖ B [‖ tokenId])", see: ["blake2b256"] }),
  T("denomination", "notes", "Denomination", "Валюта расписки", t("What a note is counted in: ERG or one token. A debt in ERG and a debt in a token between the same people are different notes.", "В чём выражена расписка: в ERG или в одном токене. Долг в ERG и долг в токене между теми же людьми — разные расписки."), { alsoRU: ["номинал"], code: "\"erg\" | \"token:<64 hex>\"" }),
  T("self-note", "notes", "Self-note", "Расписка самому себе", t("A note from a key to itself (A → A). An owner can raise it and redeem it to take part of their own reserve.", "Расписка ключа самому себе (A → A). Владелец может увеличить её и погасить, чтобы забрать часть своего резерва."), { see: ["refund"] }),
  T("timestamp", "notes", "Timestamp", "Метка времени", t("Milliseconds since 1970 in every note. A newer note must have a later timestamp; the contract refuses an older one.", "Миллисекунды с 1970 года в каждой расписке. У новой расписки метка должна быть позже; более старую контракт отклонит."), { code: "timestamp (Long, ms, context var #4)" }),
  T("message", "notes", "Note message", "Сообщение расписки", t("The 80 bytes every signature covers: debt key, total, timestamp and the tracker's NFT id.", "80 байт, которые покрывает каждая подпись: ключ долга, итог, метка времени и id NFT трекера."), { code: "key(32) ‖ totalDebt(8) ‖ timestamp(8) ‖ trackerNftId(32)", see: ["schnorr-signature"] }),
  T("credit-line", "notes", "Credit line", "Кредитная линия", t("A limit a receiver sets for one issuer: the most they will accept as that issuer's total.", "Лимит, который получатель задаёт одному эмитенту: максимальный итог, который он готов принять."), { alsoEN: ["credit limit"], alsoRU: ["кредитный лимит"], code: "max_debt", see: ["whitelist"] }),
  T("pure-credit", "notes", "Pure credit", "Чистый кредит", t("A note with no reserve behind it. It rests on trust alone.", "Расписка без резерва. Она держится только на доверии."), { see: ["collateralized-credit"] }),
  T("collateralized-credit", "notes", "Collateralized credit", "Обеспеченный кредит", t("A note whose issuer's reserve covers at least a set share of their debt, as checked by the receiver's policy.", "Расписка эмитента, чей резерв покрывает не меньше заданной доли долга, — это проверяет политика получателя."), { see: ["coverage"] }),
  T("backed-money", "notes", "Backed money", "Обеспеченные деньги", t("A note redeemed on Ergo: value has moved from the reserve to the receiver.", "Расписка, погашенная в Ergo: ценность перешла из резерва к получателю."), { alsoEN: ["settlement"], alsoRU: ["расчёт"] }),

  // ---- tracker ----
  T("tracker", "tracker", "Tracker", "Трекер", t("A server that records notes, countersigns them and commits their digest to Ergo. It cannot steal; it can censor.", "Сервер, который записывает расписки, ставит под ними вторую подпись и фиксирует их дайджест в Ergo. Украсть не может, цензурировать может."), { see: ["tracker-box", "censorship"] }),
  T("tracker-box", "tracker", "Tracker box", "Бокс трекера", t("The tracker's box on Ergo: its NFT as token #0, its key in R4 and the digest in R5. Reserves read it as a data input.", "Бокс трекера в Ergo: NFT как токен #0, ключ в R4 и дайджест в R5. Резервы читают его как data-вход."), { see: ["data-input", "digest"] }),
  T("tracker-nft", "tracker", "Tracker NFT", "NFT трекера", t("A one-of-a-kind token that identifies a tracker. Reserves name it in R6, and every note signs it.", "Уникальный токен, который идентифицирует трекер. Резервы указывают его в R6, и каждая расписка его подписывает."), { see: ["r6"] }),
  T("tracker-signature", "tracker", "Tracker signature", "Подпись трекера", t("The tracker's Schnorr signature over the same 80 bytes, passed as context variable #6. It may be empty after the emergency period.", "Подпись Шнорра трекера над теми же 80 байтами, передаётся как контекстная переменная #6. После аварийного срока может быть пустой."), { code: "context var #6" }),
  T("commitment", "tracker", "Commitment", "Фиксация", t("A transaction that re-creates the tracker box with a new digest. It happens every 600 s when something changed.", "Транзакция, которая пересоздаёт бокс трекера с новым дайджестом. Происходит раз в 600 с, если что-то изменилось."), { alsoEN: ["commit"], alsoRU: ["коммит"] }),
  T("digest", "tracker", "Digest", "Дайджест", t("33 bytes that stand for the whole tree: the 32-byte root hash and the tree's height.", "33 байта, которые представляют всё дерево: 32-байтный корневой хеш и высота дерева."), { see: ["avl-tree"] }),
  T("avl-tree", "tracker", "AVL+ tree", "AVL+-дерево", t("An authenticated dictionary used by Ergo. A short proof shows that a key has a value under a given digest.", "Аутентифицированный словарь, который использует Ergo. Короткое доказательство показывает, что у ключа есть значение при данном дайджесте."), { see: ["lookup-proof"] }),
  T("lookup-proof", "tracker", "Lookup proof", "Доказательство поиска", t("Bytes that prove a key's value in a tree. #8 proves the total in the tracker's tree; #7 proves what was redeemed in the reserve's tree.", "Байты, доказывающие значение ключа в дереве. #8 доказывает итог в дереве трекера, #7 — погашенное в дереве резерва."), { code: "context vars #7, #8" }),
  T("proof-insert", "tracker", "Insert proof", "Доказательство вставки", t("Proof #5: how the reserve's tree changes after this redemption. The first redemption of a pair inserts; later ones update.", "Доказательство #5: как меняется дерево резерва после этого погашения. Первое погашение пары — вставка, следующие — обновление."), { code: "context var #5" }),
  T("status-ladder", "tracker", "Local, pending, confirmed", "Локально, ожидает, подтверждено", t("A note's three states at the tracker: not yet committed, in a commit on its way, committed two blocks deep.", "Три состояния расписки у трекера: ещё не зафиксирована, в фиксации на пути в блокчейн, зафиксирована на глубине два блока."), { code: "local_only → pending → confirmed" }),
  T("confirmation-depth", "tracker", "Confirmation depth", "Глубина подтверждения", t("How many blocks deep a commit is. The tracker counts depth 2 as confirmed.", "Насколько глубоко фиксация в цепочке. Трекер считает подтверждённой глубину 2."), { code: "depth = height − inclusion + 1 ≥ 2" }),
  T("censorship", "tracker", "Censorship", "Цензура", t("A tracker refusing or leaving out a note. No redemption path gets around a note that is missing from the committed tree.", "Отказ трекера принять расписку или её пропуск. Ни один путь погашения не обходит расписку, которой нет в зафиксированном дереве."), { see: ["emergency-redemption"] }),
  T("emergency-redemption", "tracker", "Emergency redemption", "Аварийное погашение", t("Redeeming without the tracker's signature once its box is older than 2 160 blocks. The note must still be in the last committed tree.", "Погашение без подписи трекера, когда его боксу больше 2 160 блоков. Расписка всё равно должна быть в последнем зафиксированном дереве."), { see: ["emergency-period"] }),
  T("emergency-period", "tracker", "Emergency period", "Аварийный срок", t("2 160 blocks ≈ 3 days of tracker-box age. Every commit resets it.", "2 160 блоков ≈ 3 дня возраста бокса трекера. Каждая фиксация сбрасывает отсчёт."), { code: "HEIGHT − trackerBox.creationHeight > 3 * 720" }),

  // ---- reserve ----
  T("reserve", "reserve", "Reserve", "Резерв", t("An issuer's box on Ergo that backs all their notes in one denomination, guarded by basis.es or basis-token.es.", "Бокс эмитента в Ergo, который обеспечивает все его расписки в одной валюте; его охраняет basis.es или basis-token.es."), { alsoEN: ["reserve box", "collateral"], alsoRU: ["бокс резерва", "обеспечение"] }),
  T("r4", "reserve", "R4: owner key", "R4: ключ владельца", t("The register that holds the owner's public key. It never changes.", "Регистр с открытым ключом владельца. Никогда не меняется."), { code: "R4: GroupElement" }),
  T("r5", "reserve", "R5: redemption tree", "R5: дерево погашений", t("The reserve's own AVL+ tree: for each pair, the latest timestamp and the amount already redeemed.", "Собственное AVL+-дерево резерва: для каждой пары последняя метка времени и уже погашенная сумма."), { code: "hash(owner ‖ receiver) → timestamp(8) ‖ redeemed(8)" }),
  T("r6", "reserve", "R6: tracker NFT id", "R6: id NFT трекера", t("The one tracker this reserve trusts. It is fixed for the life of the reserve.", "Единственный трекер, которому доверяет этот резерв. Не меняется, пока существует резерв."), { code: "R6: Coll[Byte] (32)" }),
  T("r7", "reserve", "R7: refund height", "R7: высота возврата", t("Empty or 0 until the owner announces a refund; then the height of that announcement.", "Пусто или 0, пока владелец не объявит возврат; затем — высота этого объявления."), { code: "R7: Long" }),
  T("top-up", "reserve", "Top up", "Пополнение", t("Adding to a reserve. Anyone can do it without a signature: at least 0.1 ERG, or one raw unit of the token.", "Добавление средств в резерв. Может кто угодно и без подписи: от 0,1 ERG или от одной минимальной единицы токена."), { code: "action 1 · ≥ 100000000 nanoERG" }),
  T("refund", "reserve", "Refund", "Возврат резерва", t("The owner's two-step exit: announce in R7, wait 43 200 blocks, then take everything. Creditors can redeem during the wait.", "Выход владельца в два шага: объявить в R7, подождать 43 200 блоков и забрать всё. Пока идёт ожидание, кредиторы могут погашать."), { alsoEN: ["exit"], alsoRU: ["выход"], code: "actions 2 and 3" }),
  T("refund-period", "reserve", "Refund period", "Срок возврата", t("43 200 blocks ≈ 60 days between announcing a refund and completing it.", "43 200 блоков ≈ 60 дней между объявлением возврата и его завершением."), { code: "refundPeriod = 43200" }),
  T("coverage", "reserve", "Coverage", "Покрытие", t("Reserve divided by debt. Three versions exist: net (owed now), gross (ever promised) and after a payout. Policies use it; the contract does not.", "Резерв, делённый на долг. Есть три варианта: чистое (долг сейчас), валовое (всё обещанное) и после выплаты. Его используют политики, но не контракт."), { alsoEN: ["collateralization ratio"], alsoRU: ["коэффициент обеспечения"] }),
  T("redemption", "reserve", "Redemption", "Погашение", t("A transaction in which the receiver takes value from the issuer's reserve, up to the outstanding amount.", "Транзакция, в которой получатель забирает ценность из резерва эмитента — не больше непогашенного остатка."), { code: "action 0" }),
  T("protocol-fee", "reserve", "Protocol fee", "Комиссия протокола", t("None. The reserve contract pays the receiver exactly the amount redeemed.", "Нет. Контракт резерва выплачивает получателю ровно погашенную сумму."), { code: "redeemed = SELF.value − selfOut.value" }),
  T("miner-fee", "reserve", "Miner fee", "Комиссия майнера", t("The Ergo network's fee for a transaction, 0.001 ERG here. On the tracker's path the tracker pays it.", "Плата сети Ergo за транзакцию, здесь — 0,001 ERG. При погашении через трекер её платит трекер."), { code: "1000000 nanoERG" }),

  // ---- policies ----
  T("acceptance-policy", "policy", "Acceptance policy", "Политика приёма", t("A receiver's signed rules for whose notes they accept. It is advisory when paying and enforced by the tracker when redeeming.", "Подписанные правила получателя о том, чьи расписки он принимает. При оплате это рекомендация, при погашении её применяет трекер."), { alsoEN: ["acceptance predicate"], alsoRU: ["предикат приёма"] }),
  T("whitelist", "policy", "Whitelist", "Белый список", t("Issuers a receiver accepts on trust, optionally up to a limit each.", "Эмитенты, которых получатель принимает на доверии, при желании — с лимитом для каждого."), { code: "whitelist { holders, max_debt? }" }),
  T("blacklist", "policy", "Blacklist", "Чёрный список", t("Issuers a receiver refuses. In the reference wallet it wins over everything else.", "Эмитенты, которых получатель не принимает. В эталонном кошельке он важнее всех остальных правил."), { code: "blacklist { holders }" }),
  T("collateralization-rule", "policy", "Collateralization rule", "Правило обеспечения", t("Accept only while the issuer's reserve covers at least this share of their gross debt.", "Принимать, только пока резерв эмитента покрывает не меньше этой доли его валового долга."), { code: "collateralization { min_ratio }" }),
  T("no-pending-refund", "policy", "No pending refund", "Без объявленного возврата", t("Refuse notes from an issuer whose reserve has an announced refund.", "Не принимать расписки эмитента, чей резерв объявил возврат."), { code: "no_pending_refund" }),
  T("fifo", "policy", "FIFO queue", "Очередь по старшинству", t("When every other holder is already below their floor, only the oldest note may redeem. New credit moves you to the back.", "Когда все остальные держатели уже ниже своего порога, погасить может только самая старая расписка. Новый кредит отправляет вас в конец."), { alsoEN: ["oldest note first"], alsoRU: ["FIFO"], code: "failed_not_oldest_note" }),
  T("distressed-reserve", "policy", "Distressed reserve", "Проблемный резерв", t("A reserve whose every other holder already sees coverage below their policy floor.", "Резерв, у которого все остальные держатели уже видят покрытие ниже порога своей политики."), { see: ["fifo"] }),
  T("quarantine", "policy", "Quarantine", "Карантин", t("A reserve the tracker refuses to track, for example a second one for the same owner and denomination.", "Резерв, который трекер отказывается учитывать, например второй у того же владельца в той же валюте."), { alsoEN: ["admission"], alsoRU: ["допуск"] }),

  // ---- clearing ----
  T("clearing", "clearing", "Clearing", "Клиринг", t("Cancelling a loop of debts (A owes B, B owes C, C owes A) by its smallest amount.", "Погашение кольца долгов (A должен B, B должен C, C должен A) на его наименьшую сумму."), { see: ["netting"] }),
  T("netting", "clearing", "Netting", "Взаимозачёт", t("Replacing many debts with fewer, equal in net effect. Today it needs redemptions on chain or the members' agreement.", "Замена многих долгов меньшим числом с тем же итоговым результатом. Сейчас для этого нужны погашения в блокчейне или договорённость участников."), { alsoEN: ["set-off"], alsoRU: ["зачёт"] }),
  T("novation", "clearing", "Novation", "Новация", t("Moving a debt to a new creditor with the debtor's consent. Today the old note cannot be lowered, so the old creditor must refrain from redeeming.", "Перевод долга на нового кредитора с согласия должника. Сейчас старую расписку нельзя уменьшить, поэтому прежний кредитор должен воздержаться от погашения."), { alsoEN: ["debt transfer"], alsoRU: ["перевод долга"] }),
  T("exchange", "clearing", "Exchange", "Обмен между валютами", t("Moving a debt from one denomination to another, signed by both sides, in two phases.", "Перенос долга из одной валюты в другую с подписями обеих сторон, в две фазы."), { code: "POST /notes/exchange" }),

  // ---- cryptography and chain ----
  T("schnorr-signature", "crypto", "Schnorr signature", "Подпись Шнорра", t("A 65-byte signature: a point a and a number z. It is valid when g^z = a · pk^e.", "65-байтная подпись: точка a и число z. Она верна, если g^z = a · pk^e."), { code: "a(33) ‖ z(32)", see: ["challenge", "nonce"] }),
  T("challenge", "crypto", "Challenge", "Вызов", t("The hash e that ties a signature to the message and the key.", "Хеш e, который связывает подпись с сообщением и ключом."), { alsoRU: ["challenge"], code: "e = blake2b256(a ‖ message ‖ pk)" }),
  T("nonce", "crypto", "Nonce", "Нонс", t("The secret random number k behind a; a = g^k. A signer retries with a fresh one until e and z both fit into 255 bits.", "Секретное случайное число k, из которого получается a = g^k. Подписывающий берёт новое, пока e и z не уместятся в 255 бит."), { alsoRU: ["одноразовое число"], code: "z = k + e·s mod n" }),
  T("group-element", "crypto", "Group element", "Элемент группы", t("A point on the secp256k1 curve, 33 bytes compressed. In Basis it is a public key.", "Точка на кривой secp256k1, 33 байта в сжатом виде. В Basis это открытый ключ."), { alsoEN: ["public key"], alsoRU: ["открытый ключ"] }),
  T("blake2b256", "crypto", "blake2b256", "blake2b256", t("The 32-byte hash function Ergo uses. Basis uses it for debt keys and signature challenges.", "32-байтная хеш-функция, которую использует Ergo. В Basis она нужна для ключей долга и вызовов подписи.")),
  T("context-variable", "crypto", "Context variable", "Контекстная переменная", t("A value attached to a transaction input for its script to read. A redemption passes #0–#8.", "Значение, приложенное ко входу транзакции, чтобы его прочитал скрипт. Погашение передаёт #0–#8."), { alsoEN: ["context extension"], alsoRU: ["расширение контекста"] }),
  T("data-input", "crypto", "Data input", "Data-вход", t("A box a transaction reads without spending it. Redemptions read the tracker box this way.", "Бокс, который транзакция читает, не тратя его. Так погашения читают бокс трекера."), { alsoRU: ["вход только для чтения"] }),
  T("box", "crypto", "Box", "Бокс", t("Ergo's unit of state: value, tokens, registers R4–R9 and a script that guards spending.", "Единица состояния в Ergo: ценность, токены, регистры R4–R9 и скрипт, который охраняет трату."), { alsoEN: ["UTXO"], alsoRU: ["UTXO"] }),
  T("template-hash", "crypto", "Template hash", "Хеш шаблона", t("The SHA-256 of a script's template bytes. It identifies a contract version regardless of its constants.", "SHA-256 от байтов шаблона скрипта. Он определяет версию контракта независимо от констант."), { code: "sha256(ergoTreeTemplate)" }),
  T("prove-dlog", "crypto", "proveDlog", "proveDlog", t("A script condition that only the holder of a key's secret can satisfy, by signing the transaction.", "Условие скрипта, которое может выполнить только владелец секрета ключа — подписав транзакцию."), { code: "proveDlog(receiver)" }),
  T("height", "crypto", "Block height", "Высота блока", t("The number of a block in the chain. Basis counts all its times in blocks: about 720 a day.", "Номер блока в цепочке. Все сроки Basis считаются в блоках — примерно 720 в день."), { code: "HEIGHT" }),
  T("p2s-address", "crypto", "Contract address", "Адрес контракта", t("An Ergo address that encodes a script. Every version of the reserve contract has its own.", "Адрес Ergo, в котором закодирован скрипт. У каждой версии контракта резерва он свой."), { alsoEN: ["P2S"], alsoRU: ["P2S"] }),
];
