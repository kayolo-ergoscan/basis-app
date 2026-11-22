// Six personas (the community list from TG 1317, plus AI agents). Each has a one-liner, what they need, what
// Basis gives them, the honest caveat, and where to start in the app.

import type { ScenarioId } from "@/protocol/scenarios";
import type { SourceId } from "./sources";
import { t, type AppRoute, type Text } from "./types";

export type PersonaId = "operator" | "backer" | "merchant" | "member" | "integrator" | "agent";

export interface Persona {
  id: PersonaId;
  title: Text;
  /** Who this is, in a few words. */
  who: Text;
  oneLiner: Text;
  needs: Text;
  gives: Text;
  /** The honest limit for this persona. */
  caveat: Text;
  start: { label: Text; to: AppRoute };
  /** Sandbox scenario that shows this persona's story. */
  scenario: ScenarioId;
  sources: SourceId[];
}

export const personasTitle: Text = t("Who it is for", "Для кого это");
export const personasLede: Text = t(
  "Six roles people play around Basis. One person can hold several of them.",
  "Шесть ролей вокруг Basis. Один человек может совмещать несколько.",
);

export const personas: Persona[] = [
  {
    id: "operator",
    title: t("Community operator", "Организатор сообщества"),
    who: t("A local exchange organiser, a co-op, an NGO lead, a town hall.", "Организатор обменной сети, кооператив, руководитель НКО, администрация города."),
    oneLiner: t("Keep the ledger, never the money.", "Ведите реестр, но не держите чужих денег."),
    needs: t("A shared record of who owes whom that members can check, without becoming a bank.", "Общий учёт того, кто кому должен, который участники могут проверить, — и чтобы самому не становиться банком."),
    gives: t(
      "A tracker that records and countersigns notes and commits one digest to Ergo. It never holds members' funds: every payout needs the issuer's signature and the receiver's.",
      "Трекер, который записывает и подписывает расписки и фиксирует один дайджест в Ergo. Средств участников он не держит: любая выплата требует подписи эмитента и получателя.",
    ),
    caveat: t(
      "A tracker can censor by leaving a note out, and the contract cannot stop it. Members should see your commit history.",
      "Трекер может цензурировать, не включив расписку, и контракт этому не помешает. Участники должны видеть историю ваших фиксаций.",
    ),
    start: { label: t("Open the practice tracker", "Открыть учебный трекер"), to: "/tracker/practice" },
    scenario: "village-lets",
    sources: ["tg-1317", "bt-readme"],
  },
  {
    id: "backer",
    title: t("Backer, a mini-bank", "Поручитель, мини-банк"),
    who: t("A local lender, a sponsor, a community treasury.", "Местный кредитор, спонсор, казна сообщества."),
    oneLiner: t("Put a reserve behind promises people already trust.", "Подкрепите резервом обещания, которым уже доверяют."),
    needs: t("To back their notes with real assets, once, for any number of people.", "Один раз обеспечить свои расписки реальными активами — сразу для любого числа людей."),
    gives: t(
      "One reserve box backs all their notes in one denomination. Anyone can top it up. The owner can leave with about two months' notice.",
      "Один бокс резерва обеспечивает все их расписки в одной валюте. Пополнить его может кто угодно. Владелец может выйти, предупредив примерно за два месяца.",
    ),
    caveat: t(
      "Creditors can redeem at any time. If the reserve runs short, the first valid transaction on chain is paid first.",
      "Кредиторы могут погашать в любой момент. Если резерва не хватает, первой получает та корректная транзакция, что раньше попала в блок.",
    ),
    start: { label: t("Create a sandbox reserve", "Создать резерв в песочнице"), to: "/wallet/reserve" },
    scenario: "free-bank",
    sources: ["tg-1317", "bt-basis-es"],
  },
  {
    id: "merchant",
    title: t("Merchant or service", "Продавец или сервис"),
    who: t("A café, a food truck, a publisher, an API.", "Кафе, фудтрак, издатель, API."),
    oneLiner: t("Credit for regulars, backing for strangers.", "Своим — в долг, чужим — под обеспечение."),
    needs: t("To get paid in small amounts without a fee on every payment, and to know when to cash out.", "Получать небольшие суммы без комиссии за каждый платёж и понимать, когда выводить."),
    gives: t(
      "A signed acceptance policy that works like a shop sign: whose notes you take and up to how much. Payments cost nothing; you redeem the total when you choose.",
      "Подписанная политика приёма, которая работает как вывеска: чьи расписки вы берёте и на какую сумму. Платежи ничего не стоят, итог вы погашаете, когда решите.",
    ),
    caveat: t("A note is worth what its issuer can and will pay.", "Расписка стоит столько, сколько эмитент может и готов заплатить."),
    start: { label: t("Play the café scenario", "Сыграть сценарий с кафе"), to: "/play/cafe-on-credit" },
    scenario: "cafe-on-credit",
    sources: ["tg-1317", "bt-spec-acceptance"],
  },
  {
    id: "member",
    title: t("Community member", "Участник сообщества"),
    who: t("Someone who helps a neighbour today and gets paid later.", "Тот, кто помогает соседу сегодня, а получает потом."),
    oneLiner: t("Help now, get paid later, and always know what you are owed.", "Помогите сейчас, получите потом — и всегда знайте, сколько вам должны."),
    needs: t("Liquidity and simplicity: one number per person and no blockchain chores.", "Ликвидность и простота: одно число на человека и никакой возни с блокчейном."),
    gives: t(
      "One running total per person, a limit you set, a coverage meter, and redemption on Ergo when there is a reserve.",
      "Один итог на каждого человека, лимит, который вы задаёте сами, индикатор покрытия и погашение в Ergo, когда есть резерв.",
    ),
    caveat: t("Without a reserve, a note rests on trust alone.", "Без резерва расписка держится только на доверии."),
    start: { label: t("Open the sandbox wallet", "Открыть игровой кошелёк"), to: "/wallet" },
    scenario: "village-lets",
    sources: ["tg-1317"],
  },
  {
    id: "integrator",
    title: t("Technical integrator", "Технический интегратор"),
    who: t("The person who sets the system up for an operator.", "Тот, кто настраивает систему для организатора."),
    oneLiner: t("Two contracts, one HTTP API, every rule written down.", "Два контракта, одно HTTP API, все правила записаны."),
    needs: t("Reliable flows, exact formats and the edge cases before users find them.", "Надёжные сценарии, точные форматы и пограничные случаи — раньше, чем на них наткнутся пользователи."),
    gives: t(
      "The tracker API with all 35 endpoints, both contracts with line-by-line notes, and the protocol engine this site runs in your browser.",
      "API трекера со всеми 35 эндпоинтами, оба контракта с построчными пояснениями и движок протокола, который этот сайт запускает в браузере.",
    ),
    caveat: t(
      "Notes need a raw Schnorr signature that ordinary wallets do not produce yet, and the API has sharp edges: JSON key order, a single-use submit.",
      "Расписке нужна «сырая» подпись Шнорра, которую обычные кошельки пока не делают, а у API есть острые углы: порядок ключей JSON и одноразовая отправка.",
    ),
    start: { label: t("Read the tracker API", "Открыть API трекера"), to: "/learn/api" },
    scenario: "currency-exchange",
    sources: ["tg-1317", "bt-openapi"],
  },
  {
    id: "agent",
    title: t("AI agent", "ИИ-агент"),
    who: t("Software that buys and sells services by itself.", "Программа, которая сама покупает и продаёт услуги."),
    oneLiner: t("Agents can work before they get paid.", "Агенты работают раньше, чем им заплатят."),
    needs: t("Credit to start, limits that cap the damage, and rules a machine can read.", "Кредит на старте, лимиты, которые ограничивают ущерб, и правила, понятные машине."),
    gives: t(
      "Machine-readable acceptance policies, per-pair credit limits and an MCP server in the reference software. Humans add reserves to the agents they judge sound.",
      "Политики приёма, понятные машине, кредитные лимиты для каждой пары и MCP-сервер в эталонном ПО. Люди добавляют резервы тем агентам, которых считают надёжными.",
    ),
    caveat: t("A limit bounds the risk. It does not check whether the work was good.", "Лимит ограничивает риск, но не проверяет, хорошо ли сделана работа."),
    start: { label: t("Play the agent swarm", "Сыграть рой агентов"), to: "/play/agent-swarm" },
    scenario: "agent-swarm",
    sources: ["bt-spec-agent-integration", "bt-demo-agent-coop"],
  },
];
