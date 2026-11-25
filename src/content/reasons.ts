// Plain-language explanations for every reason code the engine (src/protocol) can return: contract checks,
// tracker refusals, Schnorr X-ray checks, FIFO compliance modes and the sandbox economy's own codes.
// Contract lines for a check live in `reasonLines` (contracts.ts); a tracker code that mirrors a contract rule
// names that check in `mirrors`, so a page can show both the server rule and the contract line behind it.

import type { CensorshipMode, NoteStatus, TrackerErrorCode } from "@/protocol/tracker";
import type { ReserveCheckId } from "@/protocol/reserve";
import type { XrayCheckId } from "@/protocol/schnorr";
import type { RedemptionStage } from "@/protocol/economy";
import { t, type Text } from "./types";

export interface Reason {
  title: Text;
  text: Text;
}

export interface TrackerReason extends Reason {
  /** "network": the tracker could not be reached; "tracker": a server rule (off chain). */
  layer: "network" | "tracker";
  /** The contract check that enforces the same rule on chain, if any. */
  mirrors?: ReserveCheckId;
}

const R = (titleEN: string, titleRU: string, textEN: string, textRU: string): Reason => ({ title: t(titleEN, titleRU), text: t(textEN, textRU) });

/** Contract checks (basis.es / basis-token.es), in contract order. */
export const reserveCheckReasons: Record<ReserveCheckId, Reason> = {
  actionVar: R("Action byte", "Байт действия", "Context variable #0 holds the action × 10 plus the index of the reserve's output.", "Контекстная переменная #0 содержит действие × 10 плюс индекс выхода резерва."),
  outputExists: R("Reserve output", "Выход резерва", "The output that #0 points to must exist.", "Выход, на который указывает #0, должен существовать."),
  ownerKey: R("Owner key", "Ключ владельца", "R4 must hold the owner's public key.", "В R4 должен лежать открытый ключ владельца."),
  reserveTokens: R("Reserve tokens", "Токены резерва", "A token reserve holds its NFT first and the reserve token second.", "В резерве в токене первым лежит его NFT, вторым — токен резерва."),
  refundHeightRead: R("Refund height", "Высота возврата", "R7 is read; empty or 0 means no refund is announced.", "Читается R7; пусто или 0 означает, что возврат не объявлен."),
  uniqueReserveInput: R("One reserve input per owner", "Один вход резерва на владельца", "A transaction may spend only one reserve of this owner. Otherwise two reserves could share one output and the difference could be taken.", "Транзакция может тратить только один резерв этого владельца. Иначе два резерва могли бы делить один выход, и разницу можно было бы забрать."),
  scriptPreserved: R("Same contract", "Тот же контракт", "The new reserve box keeps the same script.", "Новый бокс резерва сохраняет тот же скрипт."),
  tokensPreserved: R("Same tokens", "Те же токены", "The new ERG reserve keeps exactly the same tokens.", "Новый резерв в ERG сохраняет ровно те же токены."),
  tokenIdsPreserved: R("Same token ids", "Те же id токенов", "The NFT and the reserve token stay in their places, and no extra NFT units appear.", "NFT и токен резерва остаются на своих местах, и лишних единиц NFT не появляется."),
  ergPreserved: R("ERG not taken", "ERG не забираются", "In a token reserve, the ERG in the box never decreases when redeeming or topping up.", "В резерве в токене количество ERG в боксе не уменьшается ни при погашении, ни при пополнении."),
  ownerPreserved: R("Same owner", "Тот же владелец", "R4 is copied unchanged.", "R4 копируется без изменений."),
  trackerNftPreserved: R("Same tracker", "Тот же трекер", "R6 is copied unchanged, so the reserve stays bound to its tracker.", "R6 копируется без изменений, поэтому резерв остаётся привязанным к своему трекеру."),
  trackerIdCorrect: R("Right tracker box", "Нужный бокс трекера", "The data input must carry the tracker NFT that R6 names.", "Data-вход должен содержать NFT трекера, указанный в R6."),
  trackerDebtCorrect: R("Committed total", "Зафиксированный итог", "The tracker's committed tree must hold exactly this total for this pair (proof #8).", "В зафиксированном дереве трекера должен быть ровно этот итог для этой пары (доказательство #8)."),
  timestampCorrect: R("Not an older note", "Не старше прежней", "The note's timestamp must not be older than the last one redeemed for this pair. An equal one is allowed, so a partly redeemed note can be finished later.", "Метка времени расписки не может быть старше последней погашенной по этой паре. Равная допускается, поэтому частично погашенную расписку можно добрать позже."),
  properRedemptionTree: R("Reserve tree updated", "Дерево резерва обновлено", "The new R5 must be the old tree with this pair's timestamp and redeemed sum written in (proof #5).", "Новый R5 должен быть прежним деревом с записанными меткой времени и погашенной суммой этой пары (доказательство #5)."),
  properReserveSignature: R("Issuer's signature", "Подпись эмитента", "The issuer's signature (#2) must be valid over the 80-byte message.", "Подпись эмитента (#2) должна быть верной для 80-байтного сообщения."),
  properlyRedeemed: R("Amount within the note", "Сумма в пределах расписки", "The payout must be above 0 and at most the total minus what was already redeemed.", "Выплата должна быть больше 0 и не больше итога за вычетом уже погашенного."),
  trackerSigValid: R("Tracker's signature or emergency", "Подпись трекера или аварийный путь", "The tracker's signature (#6) must be valid, or the tracker box must be older than 2 160 blocks.", "Подпись трекера (#6) должна быть верной, или боксу трекера должно быть больше 2 160 блоков."),
  refundPreserved: R("Refund flag kept", "Флаг возврата сохранён", "A redemption cannot change R7.", "Погашение не может менять R7."),
  receiverSignature: R("Receiver signs", "Подпись получателя", "The receiver must sign the transaction.", "Получатель должен подписать транзакцию."),
  treePreserved: R("Tree unchanged", "Дерево не меняется", "A top-up or a refund announcement cannot change R5.", "Пополнение и объявление возврата не могут менять R5."),
  topUpAmount: R("Top-up amount", "Сумма пополнения", "A top-up adds at least 0.1 ERG, or at least one raw unit of the token.", "Пополнение добавляет не меньше 0,1 ERG или хотя бы одну минимальную единицу токена."),
  valueNotDecreased: R("Nothing taken", "Ничего не забрано", "Announcing a refund cannot take value out of the reserve.", "Объявление возврата не может вывести ценность из резерва."),
  refundHeightValid: R("Refund height set", "Высота возврата задана", "The new R7 must be at least the current height.", "Новый R7 должен быть не меньше текущей высоты."),
  refundNotStarted: R("Announced once", "Объявляется один раз", "A refund can be announced only when none is pending.", "Объявить возврат можно, только если другой ещё не объявлен."),
  ownerSignature: R("Owner signs", "Подпись владельца", "Both refund steps need the owner's signature.", "Оба шага возврата требуют подписи владельца."),
  refundStarted: R("Refund announced", "Возврат объявлен", "Completing a refund needs an announced one in R7.", "Чтобы завершить возврат, он должен быть объявлен в R7."),
  refundPeriodOver: R("Waiting period over", "Срок ожидания истёк", "The current height must be at least R7 + 43 200.", "Текущая высота должна быть не меньше R7 + 43 200."),
  invalidAction: R("Unknown action", "Неизвестное действие", "Only actions 0–3 exist; anything else is refused.", "Есть только действия 0–3; всё остальное отклоняется."),
};

const TR = (layer: TrackerReason["layer"], titleEN: string, titleRU: string, textEN: string, textRU: string, mirrors?: ReserveCheckId): TrackerReason => ({
  layer,
  title: t(titleEN, titleRU),
  text: t(textEN, textRU),
  ...(mirrors ? { mirrors } : {}),
});

/** Tracker refusals (TrackerErrorCode). */
export const trackerReasons: Record<TrackerErrorCode, TrackerReason> = {
  "tracker-offline": TR("network", "Tracker unreachable", "Трекер недоступен", "The tracker does not answer. If its box goes 2 160 blocks without a commit, the emergency path opens.", "Трекер не отвечает. Если его бокс простоит 2 160 блоков без фиксации, откроется аварийный путь."),
  censored: TR("tracker", "Refused by the tracker", "Трекер отказал", "The tracker refused the note. No contract rule can make it accept one.", "Трекер отказался принять расписку. Никакое правило контракта не заставит его это сделать."),
  "tracker-nft-mismatch": TR("tracker", "Another tracker's note", "Расписка другого трекера", "The note was signed for a different tracker NFT.", "Расписка подписана для другого NFT трекера.", "properReserveSignature"),
  "invalid-denomination": TR("tracker", "Unknown denomination", "Неизвестная валюта", "Use \"erg\" or \"token:<64 hex>\" for a token this tracker serves.", "Укажите «erg» или «token:<64 hex>» для токена, который обслуживает этот трекер."),
  "amount-exceeds-contract-range": TR("tracker", "Amount too large", "Слишком большая сумма", "Amounts must be below 2^63, because the contract reads them as signed numbers.", "Суммы должны быть меньше 2^63: контракт читает их как числа со знаком."),
  "future-timestamp": TR("tracker", "Timestamp in the future", "Метка времени из будущего", "The timestamp is ahead of the tracker's clock.", "Метка времени опережает часы трекера."),
  "past-timestamp": TR("tracker", "Timestamp not newer", "Метка времени не новее", "The timestamp must be later than the one already stored.", "Метка времени должна быть позже уже сохранённой.", "timestampCorrect"),
  "debt-decrease-not-permitted": TR("tracker", "Total went down", "Итог уменьшился", "A total can only grow. Lowering it needs the creditor's consent, which is not implemented.", "Итог может только расти. Для уменьшения нужно согласие кредитора, а оно не реализовано."),
  "invalid-signature": TR("tracker", "Invalid signature", "Неверная подпись", "The issuer's signature does not match the 80-byte message.", "Подпись эмитента не соответствует 80-байтному сообщению.", "properReserveSignature"),
  "not-found": TR("tracker", "No such note", "Такой расписки нет", "The tracker has no note for this pair and denomination.", "У трекера нет расписки для этой пары и валюты."),
  "note-not-committed": TR("tracker", "Not committed yet", "Ещё не зафиксирована", "The note is not in the tree on Ergo yet. Wait for the next commit: ErgoScan's tracker commits every 300 s.", "Расписки ещё нет в дереве в Ergo. Дождитесь следующей фиксации: трекер ErgoScan фиксирует раз в 300 с.", "trackerDebtCorrect"),
  "note-not-confirmed": TR("tracker", "Not confirmed yet", "Ещё не подтверждена", "The commit holding this note is less than 2 blocks deep.", "Фиксация с этой распиской пока на глубине меньше 2 блоков."),
  "stale-committed-debt": TR("tracker", "Decrease not committed", "Уменьшение не зафиксировано", "An exchange lowered this note, and the lower total is not committed yet.", "Обмен уменьшил эту расписку, а меньший итог ещё не зафиксирован."),
  "request-mismatch": TR("tracker", "Does not match the stored note", "Не совпадает с сохранённой распиской", "The tracker signs only the total and timestamp it has stored.", "Трекер подписывает только тот итог и ту метку времени, которые у него сохранены."),
  "multiple-reserves": TR("tracker", "Several reserves", "Несколько резервов", "The issuer has more than one reserve in this denomination, and the same note could redeem in full against each.", "У эмитента больше одного резерва в этой валюте, и одна расписка могла бы полностью погаситься из каждого."),
  "no-reserve": TR("tracker", "No reserve", "Нет резерва", "The issuer has no reserve this tracker follows in this denomination.", "У эмитента нет резерва в этой валюте, за которым следит этот трекер."),
  failed_policy_violation: TR("tracker", "Would hurt another holder", "Навредит другому держателю", "This redemption would push another holder's coverage below the floor of their policy.", "Это погашение опустит покрытие другого держателя ниже порога его политики."),
  failed_not_oldest_note: TR("tracker", "Not the oldest note", "Не самая старая расписка", "Every other holder is already below their floor, so only the oldest note may redeem.", "Все остальные держатели уже ниже своего порога, поэтому погасить может только самая старая расписка."),
  "rate-limited": TR("tracker", "Too many builds", "Слишком много сборок", "At most 60 redemption builds per hour per pair, failed ones included.", "Не больше 60 сборок погашения в час на пару, включая неудачные."),
  "invalid-exchange": TR("tracker", "Exchange refused", "Обмен отклонён", "The exchange breaks a rule: same denominations, a zero amount, a staged exchange already open, or a missing signature.", "Обмен нарушает правило: одинаковые валюты, нулевая сумма, уже открытый обмен или недостающая подпись."),
  "exchange-policy-rejected": TR("tracker", "Exchange rejected by policy", "Обмен отклонён политикой", "The tracker's global policy refuses the target denomination.", "Глобальная политика трекера не принимает целевую валюту."),
};

/** Schnorr signature X-ray checks (schnorr.ts). */
export const xrayReasons: Record<XrayCheckId, Reason> = {
  length: R("65 bytes", "65 байт", "A signature is exactly 65 bytes: a (33) and z (32).", "Подпись — ровно 65 байт: a (33) и z (32)."),
  "a-prefix": R("Compressed point", "Сжатая точка", "a starts with 02 or 03.", "a начинается с 02 или 03."),
  "z-zero": R("z is not zero", "z не ноль", "A zero z cannot come from an honest signer.", "Нулевое z не может получиться у честного подписанта."),
  "z-top-bit": R("z fits in 255 bits", "z умещается в 255 бит", "The first byte of z is below 0x80.", "Первый байт z меньше 0x80."),
  "pubkey-invalid": R("Valid public key", "Корректный открытый ключ", "The key must be a compressed point on secp256k1.", "Ключ должен быть сжатой точкой на secp256k1."),
  "a-not-on-curve": R("a is on the curve", "a лежит на кривой", "a must decode to a point on secp256k1.", "a должно раскодироваться в точку на secp256k1."),
  "e-top-bit": R("e fits in 255 bits", "e умещается в 255 бит", "The first byte of the challenge e is below 0x80. Signers retry until it is.", "Первый байт вызова e меньше 0x80. Подписывающий повторяет попытки, пока так не получится."),
  equation: R("g^z = a · pk^e", "g^z = a · pk^e", "The signature equation holds.", "Уравнение подписи выполняется."),
};

/** Outcome labels of the redemption-time policy check (policy.ts ComplianceResult.mode). */
export const complianceModes: Record<"no-other-holders" | "compliant" | "fifo-oldest" | "mixed", Reason> = {
  "no-other-holders": R("No other holders", "Других держателей нет", "Nobody else's policy can be affected.", "Политика других держателей не затронута — их нет."),
  compliant: R("Fair to others", "Честно по отношению к другим", "No other holder drops below their floor.", "Ни один другой держатель не опускается ниже своего порога."),
  "fifo-oldest": R("Oldest note first", "Сначала самая старая расписка", "The reserve is distressed, and this is the oldest outstanding note.", "Резерв в трудном положении, и это самая старая непогашенная расписка."),
  mixed: R("Some already below", "Кто-то уже ниже порога", "Some holders were already below their floor; none newly drops below it.", "Часть держателей уже была ниже порога, но новых таких нет."),
};

export const noteStatuses: Record<NoteStatus, Text> = {
  local: t("local", "локально"),
  pending: t("pending", "ожидает"),
  confirmed: t("confirmed", "подтверждено"),
};

export const censorshipModes: Record<CensorshipMode, Reason> = {
  off: R("Honest", "Честный", "The tracker records and commits every valid note.", "Трекер записывает и фиксирует каждую корректную расписку."),
  refuse: R("Refuses", "Отказывает", "The tracker refuses notes from or to a chosen key.", "Трекер отказывает в расписках от выбранного ключа или для него."),
  omit: R("Leaves out", "Не включает", "The tracker accepts the note but leaves it out of the committed tree.", "Трекер принимает расписку, но не включает её в зафиксированное дерево."),
};

export const redemptionStages: Record<RedemptionStage, Reason> = {
  wallet: R("Wallet", "Кошелёк", "Your wallet stopped it before anything was sent.", "Ваш кошелёк остановил операцию до отправки."),
  tracker: R("Tracker", "Трекер", "The tracker refused to build or sign it.", "Трекер отказался собрать или подписать операцию."),
  contract: R("Contract", "Контракт", "The reserve contract rejected the transaction.", "Контракт резерва отклонил транзакцию."),
};

/** Free-form codes of the sandbox economy (economy.ts, clearing.ts). Unknown codes fall back to the engine message. */
export const economyReasons: Record<string, Reason> = {
  "policy-rejected": R("Receiver's policy says no", "Политика получателя против", "The receiver's acceptance policy refuses this issuer.", "Политика приёма получателя не принимает этого эмитента."),
  "credit-limit": R("Credit line exceeded", "Кредитная линия превышена", "The receiver's limit for this issuer would be exceeded.", "Лимит получателя для этого эмитента будет превышен."),
  "novation-exceeds": R("More than is held", "Больше, чем есть", "You can move only as much of the debt as you are owed.", "Перенести можно не больше той части долга, которая причитается вам."),
  "invalid-exchange": R("Exchange refused", "Обмен отклонён", "The exchange breaks one of its rules.", "Обмен нарушает одно из своих правил."),
  "exchange-policy-rejected": R("Exchange rejected by policy", "Обмен отклонён политикой", "The tracker's policy refuses the target denomination.", "Политика трекера не принимает целевую валюту."),
  "reserve-closed": R("Reserve closed", "Резерв закрыт", "The owner completed the refund; nothing is left to redeem from.", "Владелец завершил возврат, погашать больше не из чего."),
  "insufficient-funds": R("Not enough funds", "Недостаточно средств", "The wallet does not hold enough for this action.", "В кошельке не хватает средств для этого действия."),
  "fee-funds": R("No ERG for the fee", "Нет ERG на комиссию", "This path needs 0.001 ERG for the miner fee.", "Этому пути нужно 0,001 ERG на комиссию майнера."),
  "no-reserve": R("No reserve", "Нет резерва", "The issuer has no reserve to redeem from.", "У эмитента нет резерва, из которого можно погасить."),
  "nothing-to-redeem": R("Nothing to redeem", "Нечего погашать", "Everything committed for this note is already redeemed.", "Всё зафиксированное по этой расписке уже погашено."),
  "tracker-offline": R("Tracker unreachable", "Трекер недоступен", "The tracker does not answer.", "Трекер не отвечает."),
  "issuer-offline": R("Issuer offline", "Эмитент не в сети", "The issuer's device is not online to sign.", "Устройство эмитента не в сети и не может подписать."),
  "invalid-amount": R("Invalid amount", "Некорректная сумма", "The amount must be a positive whole number of raw units.", "Сумма должна быть положительным целым числом минимальных единиц."),
  "unknown-denomination": R("Unknown denomination", "Неизвестная валюта", "This denomination is not available here.", "Эта валюта здесь недоступна."),
  "not-a-cycle": R("Not a loop", "Это не кольцо", "Clearing needs debts that form a closed loop.", "Для клиринга долги должны образовывать замкнутое кольцо."),
  amount: R("Amount outside the loop", "Сумма вне кольца", "A clearing amount must be above 0 and at most the smallest debt in the loop.", "Сумма клиринга должна быть больше 0 и не больше наименьшего долга в кольце."),
  "insufficient-collateral": R("Not enough in the reserve", "В резерве не хватает", "The reserve cannot pay this much now: after the payout the box must still keep 0.001 ERG, or one unit of its token.", "Резерв сейчас не может выплатить столько: после выплаты в боксе должно остаться 0,001 ERG или одна единица его токена."),
  "too-many-legs": R("Loop too long", "Слишком длинное кольцо", "The loop has more members than one transaction can clear.", "В кольце больше участников, чем можно закрыть одной транзакцией."),
  contract: R("Rejected by the contract", "Отклонено контрактом", "One of the reserve contract's checks failed.", "Одна из проверок контракта резерва не прошла."),
};

/** Look up a reason by any engine code. Returns undefined for codes this module does not know. */
export function reasonFor(code: string): Reason | undefined {
  return (
    (reserveCheckReasons as Record<string, Reason>)[code] ??
    (trackerReasons as Record<string, Reason>)[code] ??
    (xrayReasons as Record<string, Reason>)[code] ??
    economyReasons[code]
  );
}
