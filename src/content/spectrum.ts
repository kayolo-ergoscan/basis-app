// The money spectrum: pure credit → collateralized credit → backed money (settlement).
// Source: demo/agent_coop README ("three tiers of money") and the acceptance-policy spec.

import type { SourceId } from "./sources";
import { fact, t, type Text } from "./types";

export type TierId = "pure-credit" | "collateralized-credit" | "backed-money";

export interface SpectrumTier {
  id: TierId;
  n: 1 | 2 | 3;
  title: Text;
  short: Text;
  explanation: Text;
  /** The acceptance-policy shape (or contract action) that admits this tier. Mono. */
  policy: Text;
  chain: Text;
  /** What protects the receiver here, and who enforces it. */
  protection: Text;
  risk: Text;
  example: Text;
}

export const spectrum = {
  title: t("The money spectrum", "Спектр денег"),
  lede: t(
    "One signed note can sit anywhere on this line. Where it sits depends on the receiver's policy and the issuer's reserve, not on the note.",
    "Одна и та же подписанная расписка может оказаться в любой точке этой линии. Где именно — зависит от политики получателя и резерва эмитента, а не от самой расписки.",
  ),
  tiers: [
    {
      id: "pure-credit",
      n: 1,
      title: t("Pure credit", "Чистый кредит"),
      short: t("Trust only, no reserve.", "Только доверие, без резерва."),
      explanation: t(
        "The issuer has no reserve. The receiver accepts because they know the issuer, and caps how much they will take.",
        "У эмитента нет резерва. Получатель принимает расписку, потому что знает эмитента, и ограничивает, сколько готов взять.",
      ),
      policy: fact("whitelist { holders, max_debt }"),
      chain: t("No chain needed: the tracker records the notes.", "Блокчейн не нужен: расписки записывает трекер."),
      protection: t("The receiver's whitelist and credit limit, applied by their wallet and the tracker.", "Белый список и кредитный лимит получателя — их применяют кошелёк и трекер."),
      risk: t("If the issuer never pays, nothing on chain can make them.", "Если эмитент так и не заплатит, ничто в блокчейне его не заставит."),
      example: t("Neighbours in a local exchange circle, each with a 5 ERG limit.", "Соседи в местной обменной сети, у каждого лимит 5 ERG."),
    },
    {
      id: "collateralized-credit",
      n: 2,
      title: t("Collateralized credit", "Обеспеченный кредит"),
      short: t("A reserve covers a share of the debt.", "Резерв покрывает часть долга."),
      explanation: t(
        "The issuer keeps a reserve on Ergo. The receiver accepts only while it covers at least a set share of everything the issuer owes.",
        "Эмитент держит резерв в Ergo. Получатель принимает расписку, только пока резерв покрывает не меньше заданной доли всего долга эмитента.",
      ),
      policy: fact("collateralization { min_ratio }"),
      chain: t("A reserve box exists on Ergo.", "В Ergo есть бокс резерва."),
      protection: t(
        "A coverage check when the note is accepted, done by wallet and tracker policy. The contract itself does not compare debt with the reserve.",
        "Проверка покрытия при приёме расписки — по политике кошелька и трекера. Сам контракт долг с резервом не сравнивает.",
      ),
      risk: t("Other creditors can redeem first. Coverage can fall after you accept.", "Другие кредиторы могут погасить раньше. Покрытие может упасть уже после того, как вы приняли расписку."),
      example: t("A café takes a stranger's note only at 100 % coverage or more.", "Кафе принимает расписку незнакомца только при покрытии от 100 %."),
    },
    {
      id: "backed-money",
      n: 3,
      title: t("Backed money: settlement", "Обеспеченные деньги: расчёт"),
      short: t("The note is redeemed on Ergo.", "Расписка погашена в Ergo."),
      explanation: t(
        "The receiver redeems: value moves from the issuer's reserve to the receiver on chain. The contract checks every rule.",
        "Получатель погашает расписку: ценность переходит из резерва эмитента к получателю прямо в блокчейне. Контракт проверяет каждое правило.",
      ),
      policy: fact("reserve action 0 · context var #0 = 0x00"),
      chain: t("Yes: one transaction per redemption, miner fee 0.001 ERG.", "Да: одна транзакция на погашение, комиссия майнера 0,001 ERG."),
      protection: t("The contract: both signatures, the committed total and the redeemed counter.", "Контракт: обе подписи, зафиксированный итог и счётчик погашений."),
      risk: t("Only up to what the reserve holds at that moment.", "Не больше, чем есть в резерве в этот момент."),
      example: t("Bob takes 0.05 ERG of Alice's note out of her reserve.", "Боб забирает из резерва Алисы 0,05 ERG по её расписке."),
    },
  ] satisfies SpectrumTier[],
  /** The TUI's default rule, as a policy sentence. */
  defaultPolicy: {
    formula: fact("NOT blacklisted AND (whitelisted OR collateralized ≥ 100 %)", "НЕ в чёрном списке И (в белом списке ИЛИ обеспечение ≥ 100 %)"),
    text: t(
      "The reference wallet's default: refuse anyone blacklisted, then accept friends on trust and everyone else only when fully covered.",
      "По умолчанию в эталонном кошельке: отклонять всех из чёрного списка, друзей принимать на доверии, остальных — только при полном покрытии.",
    ),
  },
  /** Why coverage is counted on gross debt. */
  grossNote: t(
    "Policies count coverage on everything the issuer ever promised, without subtracting redemptions. That way a chain reorganisation cannot make a check pass by mistake.",
    "Политики считают покрытие от всего, что эмитент когда-либо пообещал, не вычитая погашения. Так откат цепочки не может по ошибке пропустить проверку.",
  ),
  sources: ["bt-demo-agent-coop", "bt-spec-acceptance"] as SourceId[],
};
