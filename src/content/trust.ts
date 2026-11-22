// /learn/trust: who can do what, what the contract enforces versus what is only policy, the dated security
// journal and the known open issues. Calm and precise: every line says who enforces it.

import type { SourceId } from "./sources";
import { denial, t, type LineRef, type Text } from "./types";

/** Who enforces a rule. "nobody" = not enforced anywhere today. */
export type Enforcer = "contract" | "tracker" | "wallet" | "social" | "nobody";

export interface TrustItem {
  id: string;
  text: Text;
  detail?: Text;
  by: Enforcer;
  lines?: LineRef[];
  sources: SourceId[];
}

export type IssueStatus = "open" | "fix-proposed" | "unmerged-fix" | "not-implemented" | "unknown";

export interface OpenIssue {
  id: string;
  title: Text;
  status: IssueStatus;
  /** When it was reported or became known (UTC date). */
  since: string;
  text: Text;
  /** What it means for a user, in one sentence. */
  impact: Text;
  /** Sub-items, e.g. individual review findings. */
  items?: { id: string; text: Text }[];
  sources: SourceId[];
}

export interface ReviewEntry {
  date: string;
  who: string;
  title: Text;
  text: Text;
  /** A short verbatim quote, kept in English (the original language). */
  quote?: string;
  sources: SourceId[];
}

const L = (from: number, to: number = from): LineRef => ({ contract: "basis", from, to });

export const trust = {
  title: t("Trust model", "Модель доверия"),
  lede: t(
    "Basis splits the work between a contract on Ergo, a tracker server and your wallet. Each can do some things and not others.",
    "Basis делит работу между контрактом в Ergo, сервером-трекером и вашим кошельком. Каждый из них что-то может, а что-то нет.",
  ),
  asOf: "2026-11-21",
  enforcerLabels: {
    contract: t("Contract", "Контракт"),
    tracker: t("Tracker policy", "Политика трекера"),
    wallet: t("Wallet policy", "Политика кошелька"),
    social: t("People's word", "Слово участников"),
    nobody: t("Nobody, today", "Пока никто"),
  } satisfies Record<Enforcer, Text>,

  tracker: {
    title: t("The tracker", "Трекер"),
    line: t("Cannot steal · Can censor", "Украсть не может · Цензурировать может"),
    cannot: [
      { id: "no-theft", by: "contract", text: t("Take anyone's money.", "Забрать чьи-то деньги."), detail: t("Every payout needs the issuer's signature on the total and the receiver's signature on the transaction.", "Любая выплата требует подписи эмитента под итогом и подписи получателя под транзакцией."), lines: [L(387, 398), L(425, 426)], sources: ["bt-basis-es"] },
      { id: "no-forgery", by: "contract", text: t("Create or raise a debt.", "Создать или увеличить долг."), detail: t("Only the issuer's key can sign a total. The tracker's signature alone redeems nothing.", "Подписать итог может только ключ эмитента. Одной подписью трекера ничего не погасить."), lines: [L(387, 398)], sources: ["bt-basis-es"] },
      { id: "no-overpay", by: "contract", text: t("Pay out more than the signed total minus what was already redeemed.", "Выплатить больше подписанного итога за вычетом уже погашенного."), lines: [L(381, 385)], sources: ["bt-basis-es"] },
      { id: "no-double", by: "contract", text: t("Pay the same promise twice.", "Оплатить одно и то же обещание дважды."), detail: t("The reserve keeps its own tree of payouts per pair.", "Резерв ведёт своё дерево выплат по каждой паре."), lines: [L(400, 419)], sources: ["bt-basis-es"] },
      { id: "no-cross-tracker", by: "contract", text: t("Use a note made for another tracker.", "Использовать расписку, выписанную для другого трекера."), detail: t("The tracker's NFT id is inside every signed message, and R6 of the reserve must match it.", "Id NFT трекера входит в каждое подписанное сообщение, и R6 резерва должен с ним совпасть."), lines: [L(279, 280), L(340, 343)], sources: ["bt-basis-es"] },
      { id: "no-collateral", by: "contract", text: t("Take the collateral.", "Забрать обеспечение."), detail: t("Only the owner can refund, and only 43 200 blocks after announcing it.", "Вернуть резерв может только владелец и только через 43 200 блоков после объявления."), lines: [L(457, 465)], sources: ["bt-basis-es"] },
    ] satisfies TrustItem[],
    can: [
      { id: "censor", by: "nobody", text: t("Censor: refuse a note, refuse to sign, or leave a note out of its tree.", "Цензурировать: отказаться принять расписку, не подписать её или не включить в дерево."), detail: t("Every redemption path, the emergency one included, needs the note in the committed tree. Anti-censorship protection is listed as future work.", "Любой путь погашения, включая аварийный, требует, чтобы расписка была в зафиксированном дереве. Защита от цензуры значится в планах."), lines: [L(298, 303)], sources: ["bt-readme"] },
      { id: "freeze", by: "nobody", text: t("Freeze your claim at an older total by committing an older value.", "Заморозить ваше требование на старом итоге, зафиксировав прежнее значение."), sources: ["bt-readme", "bt-spec-protocol"] },
      { id: "keep-shut", by: "nobody", text: t("Keep the emergency path shut by re-creating its box at least every 3 days.", "Держать аварийный путь закрытым, пересоздавая бокс хотя бы раз в 3 дня."), lines: [L(332, 338)], sources: ["bt-readme"] },
      { id: "reorder", by: "nobody", text: t("Re-order redemptions. This matters when a reserve cannot pay everyone.", "Менять порядок погашений. Это важно, когда резерва не хватает на всех."), sources: ["bt-basis-es", "f5153-3"] },
      { id: "see-all", by: "nobody", text: t("See the whole graph: who owes whom, and how much.", "Видеть весь граф: кто кому сколько должен."), detail: t("Keys are pseudonymous, not private. Blind signatures are future research.", "Ключи псевдонимны, но не приватны. Слепые подписи — тема будущих исследований."), sources: ["bt-whitepaper"] },
      { id: "lose-data", by: "nobody", text: t("Lose the data.", "Потерять данные."), detail: t("Today the tracker holds the only full copy of the tree. Without the proofs it held, an emergency exit is hard in practice.", "Сейчас у трекера единственная полная копия дерева. Без доказательств, которые были у него, аварийный выход на практике сложен."), sources: ["bt-spec-tracker"] },
    ] satisfies TrustItem[],
  },

  issuer: {
    title: t("The issuer", "Эмитент"),
    can: [
      { id: "issue-freely", by: "nobody", text: t("Issue notes to anyone at any time, with or without a reserve.", "Выписывать расписки кому угодно и когда угодно — с резервом или без."), detail: t("The tracker does not check coverage when it records a note. Your wallet's policy does.", "Трекер не проверяет покрытие, когда записывает расписку. Это делает политика вашего кошелька."), sources: ["bt-spec-acceptance"] },
      { id: "exit", by: "contract", text: t("Take the reserve back, after announcing it and waiting 43 200 blocks ≈ 60 days.", "Забрать резерв — объявив об этом и подождав 43 200 блоков ≈ 60 дней."), lines: [L(446, 465)], sources: ["bt-basis-es"] },
      { id: "self-drain", by: "tracker", text: t("Try to drain their own reserve first through a second key.", "Попытаться первым вывести собственный резерв через второй ключ."), detail: t("The tracker is meant to refuse new debt that hurts earlier holders. This is an open problem under pseudonymity.", "Трекер должен отклонять новый долг, который вредит прежним держателям. При псевдонимности это открытая проблема."), sources: ["bt-spec-tracker"] },
      { id: "stall", by: "nobody", text: t("Delay your confirmation by raising the note in tiny steps faster than the tracker commits.", "Задерживать подтверждение, повышая итог крошечными шагами быстрее, чем трекер фиксирует."), detail: t("It costs them more debt, but your status stays pending.", "Это увеличивает их долг, но ваш статус остаётся «ожидает»."), sources: ["bt-spec-tracker"] },
    ] satisfies TrustItem[],
    cannot: [
      { id: "no-decrease", by: "tracker", text: t("Lower a total once it is signed.", "Уменьшить итог после подписи."), detail: t("The tracker rejects it: \"Cumulative debt cannot decrease without the creditor's consent\".", "Трекер отклоняет это: «Cumulative debt cannot decrease without the creditor's consent»."), sources: ["bt-readme", "bt-spec-protocol"] },
      { id: "no-quick-exit", by: "contract", text: t("Empty the reserve quickly. The refund takes 43 200 blocks, works once, and creditors can redeem meanwhile.", "Быстро опустошить резерв. Возврат занимает 43 200 блоков, объявляется один раз, и всё это время кредиторы могут погашать."), lines: [L(446, 465)], sources: ["bt-basis-es"] },
      { id: "no-move", by: "contract", text: t("Move a reserve to another tracker: R6 never changes.", "Перевести резерв к другому трекеру: R6 не меняется."), lines: [L(253, 253)], sources: ["bt-basis-es"] },
      { id: "no-refuse-committed", by: "contract", text: t("Refuse a committed note while the reserve still holds enough.", "Отказать по зафиксированной расписке, пока в резерве хватает средств."), detail: t("Redeeming needs only signatures the receiver already has, plus the tracker's or the emergency rule.", "Для погашения нужны подписи, которые у получателя уже есть, и подпись трекера или аварийное правило."), lines: [L(428, 437)], sources: ["bt-basis-es"] },
    ] satisfies TrustItem[],
  },

  holder: {
    title: t("You, the holder", "Вы, держатель"),
    can: [
      t("Redeem any part of a confirmed note, at any time, as often as you like.", "Погашать любую часть подтверждённой расписки, в любой момент и сколько угодно раз."),
      t("Choose whose notes you take, and up to how much.", "Выбирать, чьи расписки брать и на какую сумму."),
      t("Watch the issuer's coverage and the tracker's commit cadence.", "Следить за покрытием эмитента и регулярностью фиксаций трекера."),
      t("Keep the proofs of your notes while the tracker is online.", "Сохранять доказательства своих расписок, пока трекер на связи."),
    ],
  },

  enforcement: {
    title: t("Contract rules versus policy", "Правила контракта и политики"),
    lede: t(
      "Only the first column is enforced by Ergo itself. The rest are rules that software follows by choice.",
      "Только первую колонку обеспечивает сам Ergo. Остальное — правила, которым программы следуют добровольно.",
    ),
    contract: [
      t("Both signatures, or the issuer's plus the emergency rule after 2 160 blocks.", "Обе подписи — или подпись эмитента плюс аварийное правило после 2 160 блоков."),
      t("The total must be in the tracker's committed tree.", "Итог должен быть в зафиксированном дереве трекера."),
      t("No payout above the total minus what was redeemed; no promise paid twice.", "Выплата не больше итога минус погашенное; ни одно обещание не оплачивается дважды."),
      t("No note older than the last redeemed one.", "Расписка не может быть старше последней погашенной."),
      t("Script, tokens, owner (R4) and tracker (R6) preserved; one reserve input per owner.", "Скрипт, токены, владелец (R4) и трекер (R6) сохраняются; один вход резерва на владельца."),
      t("Top up at least 0.1 ERG, or one raw unit of the token.", "Пополнение от 0,1 ERG или от одной минимальной единицы токена."),
      t("Refund: announced once, then 43 200 blocks, then only the owner.", "Возврат: объявляется один раз, затем 43 200 блоков, затем только владелец."),
      t("The receiver signs the payout transaction.", "Получатель подписывает транзакцию выплаты."),
    ],
    tracker: [
      t("Totals never decrease; timestamps must be newer; the NFT and the signature must match.", "Итоги не уменьшаются; метки времени должны быть новее; NFT и подпись должны совпасть."),
      t("A redemption may not push another holder below their policy floor.", "Погашение не должно опускать другого держателя ниже порога его политики."),
      t("If every other holder is already below it, only the oldest note may redeem (FIFO). With the default settings this applies whenever an issuer has two or more creditors.", "Если все остальные уже ниже порога, погашать может только самая старая расписка (FIFO). При настройках по умолчанию так происходит всегда, когда у эмитента двое и больше кредиторов."),
      t("At most 60 redemption builds per hour per pair.", "Не больше 60 сборок погашения в час на пару."),
      t("An ERG reserve keeps at least 0.001 ERG after a payout.", "В резерве в ERG после выплаты остаётся не меньше 0,001 ERG."),
      t("One active reserve per owner and denomination; others are quarantined.", "Один активный резерв на владельца и валюту; остальные — в карантине."),
      t("All of this is skipped on the emergency path.", "На аварийном пути всё это не применяется."),
    ],
    wallet: [
      t("Your acceptance policy: whitelist, blacklist, minimum coverage, no pending refund.", "Ваша политика приёма: белый список, чёрный список, минимальное покрытие, отсутствие объявленного возврата."),
      t("Credit limits per person.", "Кредитные лимиты для каждого человека."),
      t("Coverage warnings at 150 %, 120 % and 100 %.", "Предупреждения о покрытии на 150 %, 120 % и 100 %."),
      t("A warning when an issuer announces a refund.", "Предупреждение, когда эмитент объявляет возврат."),
      t("Saving the proofs you would need for an emergency exit.", "Сохранение доказательств, которые понадобятся для аварийного выхода."),
    ],
    nobody: [
      t("Whether the work behind a note was good.", "Хорошо ли сделана работа, за которую выписана расписка."),
      t("Whether two keys belong to one person.", "Принадлежат ли два ключа одному человеку."),
      t("Whether a debt can be enforced by law.", "Можно ли взыскать долг по закону."),
      t("Privacy: the tracker sees every note it records.", "Приватность: трекер видит каждую расписку, которую записывает."),
    ],
  },

  status: {
    title: t("Where things stand", "Где мы сейчас"),
    text: denial(
      "Basis is an experiment. ErgoScan's tracker has run on Ergo mainnet in beta since 22 November 2026; reserves on the current contracts (of 25 and 27 October 2026) can connect to it. The latest review (29 October 2026) says the server and apps are not ready for a public launch.",
      "Basis — эксперимент. Трекер ErgoScan работает в основной сети Ergo в бета-режиме с 22 ноября 2026 года; к нему можно подключать резервы на текущих контрактах (от 25 и 27 октября 2026 года). Последнее ревью (29 октября 2026 года) говорит, что сервер и приложения к публичному запуску ещё не готовы.",
    ),
    contractsVerdict: t(
      "The same review calls the contracts sound after the C1–C3 fixes.",
      "То же ревью называет контракты корректными после исправлений C1–C3.",
    ),
  },

  reviews: [
    { date: "2026-08-08", who: "a-shannon", title: t("Hardening pull request #12", "Pull request #12 с усилением защиты"), text: t("Eight findings. Four fixed, two deferred, two skipped. The PR itself was closed and its findings were re-implemented.", "Восемь находок: четыре исправлены, две отложены, две пропущены. Сам PR закрыт, находки перенесены вручную."), sources: ["bt-12"] },
    { date: "2026-09-26", who: "basis-tracker", title: t("Production-readiness audit re-reviewed", "Повторный разбор аудита готовности"), text: t("The earlier positive verdict was retracted. Blockers: failing CI, remote panics, a trusted completion path.", "Прежний положительный вердикт отозван. Блокеры: падающий CI, удалённые паники, доверенный путь завершения."), quote: "NOT PRODUCTION READY", sources: ["bt-spec-audit"] },
    { date: "2026-10-02", who: "decentbob", title: t("Security review before deployment (#15, #14)", "Ревью безопасности до развёртывания (#15, #14)"), text: t("Six contract findings (C1–C6) and seven server findings (S1–S7), with proof-of-concept tests. Two critical drains: by a creditor (C1) and by anyone (C2).", "Шесть находок в контракте (C1–C6) и семь в сервере (S1–S7) с тестами-доказательствами. Два критических способа опустошить резерв: кредитором (C1) и кем угодно (C2)."), sources: ["bt-15", "bt-14", "bt-spec-pr14-triage"] },
    { date: "2026-10-25", who: "kushti", title: t("Fixes merged (#16), new contract addresses", "Исправления слиты (#16), новые адреса контрактов"), text: t("C1, C2, C3, C5 and C6 fixed in the contracts; C3 put the tracker NFT id into the signed message. C4 was fixed in part.", "C1, C2, C3, C5 и C6 исправлены в контрактах; C3 добавило id NFT трекера в подписываемое сообщение. C4 исправлено частично."), sources: ["bt-16", "bt-spec-pr16-triage", "bt-spec-compiled"] },
    { date: "2026-10-28", who: "Optiplex4313", title: t("Issues #17–#20", "Issues #17–#20"), text: t("Exchange double-pay, dropped notes on upgrade, duplicate-reserve blocking, non-atomic exchange. All four were closed by 2026-11-05.", "Двойная выплата при обмене, потеря расписок при обновлении, блокировка дублем резерва, неатомарный обмен. Все четыре закрыты к 2026-11-05."), sources: ["bt-17", "bt-18", "bt-19", "bt-20"] },
    { date: "2026-10-29", who: "decentbob", title: t("Follow-up review", "Повторное ревью"), text: t("Launch blockers N1–N4 in the server; contracts judged sound.", "Блокеры запуска N1–N4 в сервере; контракты признаны корректными."), quote: "Verdict: not ready for a public launch. The contracts are sound: B1 and C3 are fixed… The server and clients are not.", sources: ["bt-15", "bt-21"] },
    { date: "2026-11-10", who: "decentbob", title: t("Follow-up fixes merged (#21 = 43e2173)", "Исправления по повторному ревью слиты (#21 = 43e2173)"), text: t("Fixed N1, N3–N7 and N11–N13. N2 and N15 have regression tests that are still switched off. N8–N10, N14 and N16–N19 need design decisions.", "Исправлены N1, N3–N7 и N11–N13. У N2 и N15 есть регрессионные тесты, но они пока отключены. N8–N10, N14 и N16–N19 требуют проектных решений."), sources: ["bt-21", "bt-commit-head"] },
    { date: "2026-11-13", who: "fitzss", title: t("Proof digest mismatch found on a testnet tracker (#24, #25)", "Несовпадение дайджеста найдено на тестнет-трекере (#24, #25)"), text: t("An independent report of the N2 tree-order bug, with a proposed fix.", "Независимое подтверждение ошибки порядка в дереве (N2) с предложенным исправлением."), sources: ["bt-24", "bt-25"] },
    { date: "2026-11-19", who: "kushti", title: t("Remaining findings in progress", "Оставшиеся находки в работе"), text: t("The author says he is fixing the rest of the review findings, then the testnet reports.", "Автор пишет, что исправляет оставшиеся находки ревью, а затем возьмётся за сообщения с тестнета."), sources: ["tg-1675"] },
  ] satisfies ReviewEntry[],

  openIssues: [
    {
      id: "proof-digest-mismatch",
      title: t("Committed proofs can fail (#24, PR #25)", "Зафиксированные доказательства могут не сходиться (#24, PR #25)"),
      status: "fix-proposed",
      since: "2026-11-13",
      text: t("After one edge is raised past another, the tracker rebuilds its committed tree in the wrong order, and redemption builds fail. The same bug is N2 in the review.", "Когда одно ребро обгоняет другое, трекер пересобирает зафиксированное дерево в неверном порядке, и сборка погашения падает. Это та же ошибка, что N2 в ревью."),
      impact: t("Redemptions through the tracker can stop working until the fix is merged.", "Погашения через трекер могут перестать работать, пока исправление не слито."),
      sources: ["bt-24", "bt-25", "bt-21"],
    },
    {
      id: "review-findings",
      title: t("Open review findings N8–N10, N14, N16–N19", "Открытые находки ревью N8–N10, N14, N16–N19"),
      status: "open",
      since: "2026-10-29",
      text: t("Server-side findings that need design decisions. They are not part of PR #21.", "Находки в сервере, которым нужны проектные решения. В PR #21 они не вошли."),
      impact: t("They affect the tracker software, not the contract rules.", "Они касаются программы трекера, а не правил контракта."),
      items: [
        { id: "N8", text: t("Duplicate reserves: griefing, creditor lock-out, unredeemable collateral.", "Дубли резервов: вредительство, блокировка кредиторов, недоступное обеспечение.") },
        { id: "N9", text: t("Reserve rotation can pay old notes again. A fix exists only on an unmerged branch.", "Смена резерва может повторно оплатить старые расписки. Исправление есть только в неслитой ветке.") },
        { id: "N10", text: t("Exchange signatures can be reused as a standalone note.", "Подписи обмена можно использовать как отдельную расписку.") },
        { id: "N14", text: t("The tracker's copy of reserve trees is never re-synced from the chain.", "Копия деревьев резервов у трекера никогда не сверяется заново с блокчейном.") },
        { id: "N16–N19", text: t("Pending-refund collateral, build abuse, denominations, reserves after a fresh database.", "Обеспечение при объявленном возврате, злоупотребление сборками, валюты, резервы после чистой базы.") },
      ],
      sources: ["bt-15", "bt-21", "tg-1675"],
    },
    {
      id: "staged-exchange",
      title: t("Staged exchange: cancel window and a reported bypass", "Отложенный обмен: окно отмены и сообщённый обход"),
      status: "unknown",
      since: "2026-11-11",
      text: t("An exchange between denominations lowers the old note at once and raises the new one only after the next confirmed commit. Until then a creditor holding an older redemption can still use it, which cancels the trade: a free option on the rate. A cancel restores nothing; the lowered note stays lowered. By our reading of the code, a top-up by anyone or a new note from the issuer also cancels it. A separate report says the tracker accepts the new note on its own while the exchange is staged.", "Обмен между валютами сразу уменьшает старую расписку, а новую увеличивает только после следующей подтверждённой фиксации. До этого кредитор с заранее собранным погашением ещё может им воспользоваться и тем самым отменить сделку — бесплатный опцион на курс. Отмена ничего не восстанавливает: уменьшенная расписка остаётся уменьшенной. Насколько мы читаем код, обмен отменяют и пополнение резерва кем угодно, и новая расписка от эмитента. По отдельному сообщению об ошибке, трекер принимает новую расписку сам по себе, пока обмен в ожидании."),
      impact: t("Do not rely on an exchange until it is applied; a cancelled one is not rolled back.", "Не полагайтесь на обмен, пока он не применён: отменённый обмен не откатывается."),
      sources: ["bt-spec-exchange", "tg-1657", "bt-17", "bt-20"],
    },
    {
      id: "legacy-scripts",
      title: t("Older contract versions keep known flaws", "У старых версий контракта остаются известные уязвимости"),
      status: "open",
      since: "2026-10-25",
      text: t("Reserves on superseded contract addresses can still be attacked as the review described (C1, C2, C6) and should be refunded or migrated. The three oldest versions have no refund action at all.", "Резервы на устаревших адресах контракта по-прежнему уязвимы для атак из ревью (C1, C2, C6), их следует вернуть или перенести. У трёх самых старых версий действия возврата нет вовсе."),
      impact: t("Do not top up or accept notes against a reserve on an old contract.", "Не пополняйте резерв на старом контракте и не принимайте расписки под него."),
      sources: ["bt-spec-pr16-triage", "bt-spec-compiled"],
    },
    {
      id: "no-decrease",
      title: t("Lowering a total is not implemented", "Уменьшение итога не реализовано"),
      status: "not-implemented",
      since: "2026-02-21",
      text: t("Totals can only grow. Novation and clearing therefore rely on the old creditor not redeeming the moved part. A creditor-signed decrease is future work; PR #22 proposes debt transfer and set-off.", "Итоги могут только расти. Поэтому новация и клиринг держатся на том, что прежний кредитор не погашает перенесённую часть. Уменьшение с подписью кредитора — в планах; PR #22 предлагает перевод долга и зачёт."),
      impact: t("A moved debt is protected by a promise, not by the contract.", "Перенесённый долг защищён обещанием, а не контрактом."),
      sources: ["bt-basis-es", "bt-spec-cross-tracker", "bt-22"],
    },
    {
      id: "censorship",
      title: t("No on-chain remedy for censorship", "Против цензуры нет ончейн-защиты"),
      status: "not-implemented",
      since: "2026-02-21",
      text: t("A note the tracker leaves out cannot be redeemed on any path. Anti-censorship protection is listed under future extensions.", "Расписку, которую трекер не включил, нельзя погасить ни одним путём. Защита от цензуры значится в будущих расширениях."),
      impact: t("Watch the tracker's commits and keep your own proofs.", "Следите за фиксациями трекера и храните свои доказательства."),
      sources: ["bt-readme"],
    },
    {
      id: "self-drain",
      title: t("Self-drain under pseudonymity", "Самовывод при псевдонимности"),
      status: "open",
      since: "2026-03-31",
      text: t("An issuer can pay a second key of their own and redeem it first. The tracker is meant to refuse such debt when it hurts earlier holders.", "Эмитент может выписать расписку своему второму ключу и погасить её первым. Трекер должен отклонять такой долг, если он вредит прежним держателям."),
      impact: t("Coverage you saw when accepting can shrink.", "Покрытие, которое вы видели при приёме, может уменьшиться."),
      sources: ["bt-spec-tracker"],
    },
    {
      id: "testnet-addresses",
      title: t("Testnet addresses are not parsed (#23)", "Адреса тестнета не разбираются (#23)"),
      status: "open",
      since: "2026-11-12",
      text: t("Address handling accepts mainnet addresses only.", "Обработка адресов принимает только адреса mainnet."),
      impact: t("Running the reference tracker on testnet needs a patch.", "Чтобы запустить эталонный трекер в тестнете, нужен патч."),
      sources: ["bt-23"],
    },
    {
      id: "ci-red",
      title: t("Tests fail on master", "Тесты на master падают"),
      status: "open",
      since: "2026-10-29",
      text: t("Every push to master from 2026-10-29 to 2026-11-10 ended with a failed test run.", "Каждый пуш в master с 2026-10-29 по 2026-11-10 завершился проваленным прогоном тестов."),
      impact: t("The reference software is still in development.", "Эталонное ПО всё ещё в разработке."),
      sources: ["bt-actions"],
    },
    {
      id: "reorgs",
      title: t("Deep chain reorganisations are not handled", "Глубокие откаты цепочки не обрабатываются"),
      status: "open",
      since: "2026-10-02",
      text: t("The tracker treats a commit as final at depth 2. Deeper reorganisations are out of scope.", "Трекер считает фиксацию окончательной на глубине 2. Более глубокие откаты не рассматриваются."),
      impact: t("Rare, but a reverted commit can briefly show a note as confirmed.", "Редко, но откатившаяся фиксация может ненадолго показать расписку подтверждённой."),
      sources: ["bt-spec-pr14-triage"],
    },
    {
      id: "repo-keys",
      title: t("Keys committed in the repositories are public", "Ключи из репозиториев — публичные"),
      status: "open",
      since: "2026-10-02",
      text: t("Demo and test keys were committed to the repositories. They must be treated as public and rotated before any deployment. This site never uses or shows them.", "В репозитории попали демо- и тестовые ключи. Их нужно считать публичными и заменить до любого развёртывания. Этот сайт их не использует и не показывает."),
      impact: t("Never reuse a key from a demo or a test file.", "Никогда не используйте ключ из демо или тестового файла."),
      sources: ["bt-spec-pr14-triage"],
    },
  ] satisfies OpenIssue[],

  /** Status labels for issues. */
  statusLabels: {
    open: t("open", "открыто"),
    "fix-proposed": t("fix proposed", "исправление предложено"),
    "unmerged-fix": t("fix not merged", "исправление не слито"),
    "not-implemented": t("not implemented", "не реализовано"),
    unknown: t("status unknown", "статус неизвестен"),
  } satisfies Record<IssueStatus, Text>,
};
