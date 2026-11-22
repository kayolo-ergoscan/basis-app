// Sources: the repos, the two contracts, specs, the whitepaper, the Telegram group and the forum threads.
// Only first-party material of the protocol and its community is linked (no third-party products, no explorers;
// on-chain objects are `ChainRef`s and pages link them to ergoscan.me through the chain module).
// Other modules cite sources by id, so a typo is a type error.

import { GIT_REF } from "./contractSource";
import { t, type Text } from "./types";

export type SourceKind = "repo" | "contract" | "spec" | "paper" | "deck" | "forum" | "telegram" | "issue" | "pull" | "commit";

export interface Source {
  id: string;
  kind: SourceKind;
  title: Text;
  url: string;
  /** Publication or event date (UTC), when known. */
  date?: string;
  /** Who wrote it (public handle). */
  by?: string;
  note?: Text;
}

const BT = "https://github.com/BetterMoneyLabs/basis-tracker";
const BT_BLOB = `${BT}/blob/${GIT_REF}`;
const CC = "https://github.com/BetterMoneyLabs/chaincash";
const CC_REF = "78475e30362571acf56e4e38276a9d6c0a84ce0c";
const CC_BLOB = `${CC}/blob/${CC_REF}`;
const F = (topic: number, post: number) => `https://www.ergoforum.org/t/${topic}/${post}`;
const TG = (n: number) => `https://t.me/chaincashtalks/${n}`;

type Def = Omit<Source, "id">;

const defs = {
  // ---- repositories and code ----
  "bt-repo": { kind: "repo", title: t("basis-tracker repository (BetterMoneyLabs)", "Репозиторий basis-tracker (BetterMoneyLabs)"), url: BT, note: t("Contracts, tracker server, CLI, TUI, MCP server. CC0.", "Контракты, сервер трекера, CLI, TUI, MCP-сервер. CC0.") },
  "bt-readme": { kind: "repo", title: t("basis-tracker README", "README basis-tracker"), url: `${BT_BLOB}/README.md`, date: "2026-11-10" },
  "bt-actions": { kind: "repo", title: t("basis-tracker CI runs (GitHub Actions)", "Прогоны CI basis-tracker (GitHub Actions)"), url: `${BT}/actions`, note: t("Red on master from 2026-10-29 to 2026-11-10.", "На master красные с 2026-10-29 по 2026-11-10.") },
  "bt-commit-head": { kind: "commit", title: t("Commit 43e2173: merge of PR #21", "Коммит 43e2173: слияние PR #21"), url: `${BT}/commit/${GIT_REF}`, date: "2026-11-10" },
  "bt-basis-es": { kind: "contract", title: t("contract/basis.es (ERG reserve)", "contract/basis.es (резерв в ERG)"), url: `${BT_BLOB}/contract/basis.es`, date: "2026-11-10" },
  "bt-basis-token-es": { kind: "contract", title: t("contract/basis-token.es (token reserve)", "contract/basis-token.es (резерв в токене)"), url: `${BT_BLOB}/contract/basis-token.es`, date: "2026-11-10" },
  "bt-openapi": { kind: "spec", title: t("Tracker OpenAPI description", "Описание API трекера (OpenAPI)"), url: `${BT_BLOB}/openapi.yaml`, note: t("Partly stale; the server code wins where they differ.", "Местами устарело; где расходится, прав код сервера.") },
  "bt-spec-protocol": { kind: "spec", title: t("specs/basis_protocol.md", "specs/basis_protocol.md"), url: `${BT_BLOB}/specs/basis_protocol.md` },
  "bt-spec-tracker": { kind: "spec", title: t("specs/tracker_protocol.md", "specs/tracker_protocol.md"), url: `${BT_BLOB}/specs/tracker_protocol.md` },
  "bt-spec-acceptance": { kind: "spec", title: t("specs/acceptance_predicates.md: acceptance policies", "specs/acceptance_predicates.md: политики приёма"), url: `${BT_BLOB}/specs/acceptance_predicates.md` },
  "bt-spec-redemption-policy": { kind: "spec", title: t("specs/redemption_acceptance_policy.md: redemption-time check and FIFO", "specs/redemption_acceptance_policy.md: проверка при погашении и FIFO"), url: `${BT_BLOB}/specs/redemption_acceptance_policy.md` },
  "bt-spec-exchange": { kind: "spec", title: t("specs/ergo/exchange_atomicity.md", "specs/ergo/exchange_atomicity.md"), url: `${BT_BLOB}/specs/ergo/exchange_atomicity.md`, date: "2026-11-05" },
  "bt-spec-multi-collateral": { kind: "spec", title: t("specs/ergo/multi_collateral_reserves.md", "specs/ergo/multi_collateral_reserves.md"), url: `${BT_BLOB}/specs/ergo/multi_collateral_reserves.md`, date: "2026-10-27" },
  "bt-spec-reserve-admission": { kind: "spec", title: t("specs/ergo/reserve_admission.md", "specs/ergo/reserve_admission.md"), url: `${BT_BLOB}/specs/ergo/reserve_admission.md`, date: "2026-11-03" },
  "bt-spec-compiled": { kind: "spec", title: t("specs/ergo/compiled_contracts.txt: current and old addresses", "specs/ergo/compiled_contracts.txt: текущие и старые адреса"), url: `${BT_BLOB}/specs/ergo/compiled_contracts.txt`, date: "2026-10-25" },
  "bt-spec-cross-tracker": { kind: "spec", title: t("specs/cross_tracker_debt_transfer.md", "specs/cross_tracker_debt_transfer.md"), url: `${BT_BLOB}/specs/cross_tracker_debt_transfer.md` },
  "bt-spec-informal-clearing": { kind: "spec", title: t("specs/informal_clearing_systems.md", "specs/informal_clearing_systems.md"), url: `${BT_BLOB}/specs/informal_clearing_systems.md` },
  "bt-spec-schnorr": { kind: "spec", title: t("specs/SCHNORR_SIGNATURE_SPEC.md", "specs/SCHNORR_SIGNATURE_SPEC.md"), url: `${BT_BLOB}/specs/SCHNORR_SIGNATURE_SPEC.md` },
  "bt-spec-agent-integration": { kind: "spec", title: t("specs/agent_integration.md: MCP and CLI for agents", "specs/agent_integration.md: MCP и CLI для агентов"), url: `${BT_BLOB}/specs/agent_integration.md` },
  "bt-spec-pr14-triage": { kind: "spec", title: t("specs/pr14_triage.md: findings C1–C6, S1–S7", "specs/pr14_triage.md: находки C1–C6, S1–S7"), url: `${BT_BLOB}/specs/pr14_triage.md` },
  "bt-spec-pr16-triage": { kind: "spec", title: t("specs/pr16_triage.md", "specs/pr16_triage.md"), url: `${BT_BLOB}/specs/pr16_triage.md` },
  "bt-spec-audit": { kind: "spec", title: t("specs/PRODUCTION_READINESS_AUDIT.md", "specs/PRODUCTION_READINESS_AUDIT.md"), url: `${BT_BLOB}/specs/PRODUCTION_READINESS_AUDIT.md`, date: "2026-09-26" },
  "bt-doc-free-banking": { kind: "spec", title: t("docs/free_banking.md", "docs/free_banking.md"), url: `${BT_BLOB}/docs/free_banking.md` },
  "bt-demo-agent-coop": { kind: "spec", title: t("demo/agent_coop: the three tiers of money", "demo/agent_coop: три уровня денег"), url: `${BT_BLOB}/demo/agent_coop/README.md` },
  "bt-whitepaper": { kind: "paper", title: t("Whitepaper: Local Credit, Global Settlement (basis.pdf)", "Whitepaper: Local Credit, Global Settlement (basis.pdf)"), url: `${BT_BLOB}/docs/basis/basis.pdf`, date: "2026-06-13", by: "kushti", note: t("Also in the ChainCash repo at docs/basis/basis.pdf.", "Есть и в репозитории ChainCash: docs/basis/basis.pdf.") },
  "bt-deck": { kind: "deck", title: t("Deck: Basis on Ergo: P2P Money for Humans & AI Agents", "Презентация: Basis on Ergo: P2P Money for Humans & AI Agents"), url: `${BT_BLOB}/docs/basis/presentation/basis.pdf`, date: "2026-04-22", by: "kushti" },
  "bt-deck-ramics": { kind: "deck", title: t("RAMICS 2026 deck (Rio de Janeiro)", "Презентация RAMICS 2026 (Рио-де-Жанейро)"), url: `${BT_BLOB}/docs/basis/presentation/ramics/ramics_presentation.md`, date: "2026-06-08", by: "kushti" },
  "cc-repo": { kind: "repo", title: t("chaincash repository (the predecessor)", "Репозиторий chaincash (предшественник)"), url: CC },
  "cc-readme": { kind: "repo", title: t("ChainCash README", "README ChainCash"), url: `${CC_BLOB}/README.md` },
  "cc-reserve-es": { kind: "contract", title: t("ChainCash contracts/onchain/reserve.es", "ChainCash contracts/onchain/reserve.es"), url: `${CC_BLOB}/contracts/onchain/reserve.es`, note: t("The ChainCash reserve, with its own redemption fee. Not Basis.", "Резерв ChainCash со своей комиссией за погашение. Это не Basis.") },
  "cc-commit-first-basis": { kind: "commit", title: t("Commit 5762537: initial offchain contract", "Коммит 5762537: initial offchain contract"), url: `${CC}/commit/5762537`, date: "2025-05-03", by: "kushti" },
  "cc-commit-rework": { kind: "commit", title: t("Commit 87f7997: basis contract rework", "Коммит 87f7997: basis contract rework"), url: `${CC}/commit/87f7997`, date: "2025-09-03", by: "kushti" },
  "cc-pr-19": { kind: "pull", title: t("ChainCash PR #19: contract tests with mutation controls", "ChainCash PR #19: тесты контракта с мутациями"), url: `${CC}/pull/19`, date: "2026-01-16", by: "arkadianet" },

  // ---- GitHub issues and pull requests (basis-tracker) ----
  "bt-12": { kind: "pull", title: t("PR #12: harden Basis state, signing and settlement", "PR #12: укрепление состояния, подписей и расчётов"), url: `${BT}/pull/12`, date: "2026-08-08", by: "a-shannon" },
  "bt-14": { kind: "pull", title: t("PR #14: proof-of-concept tests for the review", "PR #14: тесты-доказательства к ревью"), url: `${BT}/pull/14`, date: "2026-10-02", by: "decentbob" },
  "bt-15": { kind: "issue", title: t("Issue #15: security review before deployment", "Issue #15: ревью безопасности до развёртывания"), url: `${BT}/issues/15`, date: "2026-10-02", by: "decentbob" },
  "bt-16": { kind: "pull", title: t("PR #16: fixes for the issues reported in #15", "PR #16: исправления по #15"), url: `${BT}/pull/16`, date: "2026-10-25" },
  "bt-17": { kind: "issue", title: t("Issue #17: exchange could double-pay", "Issue #17: обмен мог заплатить дважды"), url: `${BT}/issues/17`, date: "2026-10-28", by: "Optiplex4313" },
  "bt-18": { kind: "issue", title: t("Issue #18: upgrade drops notes", "Issue #18: обновление теряло расписки"), url: `${BT}/issues/18`, date: "2026-10-28", by: "Optiplex4313" },
  "bt-19": { kind: "issue", title: t("Issue #19: a duplicate reserve blocks an issuer", "Issue #19: дубль резерва блокирует эмитента"), url: `${BT}/issues/19`, date: "2026-10-28", by: "Optiplex4313" },
  "bt-20": { kind: "issue", title: t("Issue #20: exchange was not atomic", "Issue #20: обмен не был атомарным"), url: `${BT}/issues/20`, date: "2026-10-28", by: "Optiplex4313" },
  "bt-21": { kind: "pull", title: t("PR #21: security follow-up (merged as 43e2173)", "PR #21: повторное ревью безопасности (слито как 43e2173)"), url: `${BT}/pull/21`, date: "2026-11-10", by: "decentbob" },
  "bt-22": { kind: "pull", title: t("PR #22: debt transfer, multilateral set-off, prior acknowledgments", "PR #22: перевод долга, многосторонний зачёт, предварительные подтверждения"), url: `${BT}/pull/22`, date: "2026-11-11", by: "fitzss" },
  "bt-23": { kind: "issue", title: t("Issue #23: testnet addresses are not parsed", "Issue #23: адреса тестнета не разбираются"), url: `${BT}/issues/23`, date: "2026-11-12", by: "fitzss" },
  "bt-24": { kind: "issue", title: t("Issue #24: committed-proof digest mismatch", "Issue #24: несовпадение дайджеста зафиксированного доказательства"), url: `${BT}/issues/24`, date: "2026-11-13", by: "fitzss" },
  "bt-25": { kind: "pull", title: t("PR #25: fix for #24 (tree insertion order)", "PR #25: исправление #24 (порядок вставки в дерево)"), url: `${BT}/pull/25`, date: "2026-11-13", by: "fitzss" },

  // ---- forum (ergoforum.org) ----
  "f3367-1": { kind: "forum", title: t("Offchain Bank operating at Layer 2", "Offchain Bank operating at Layer 2"), url: F(3367, 1), date: "2022-02-17", by: "scalahub" },
  "f4015-1": { kind: "forum", title: t("ChainCash: a spender-signed currency on Ergo", "ChainCash: a spender-signed currency on Ergo"), url: F(4015, 1), date: "2022-10-07", by: "kushti" },
  "f4451-1": { kind: "forum", title: t("The World Needs For More Collateral", "The World Needs For More Collateral"), url: F(4451, 1), date: "2023-08-17", by: "kushti" },
  "f5122-1": { kind: "forum", title: t("Offchain money with free creation but limited redemption", "Offchain money with free creation but limited redemption"), url: F(5122, 1), date: "2025-03-31", by: "kushti" },
  "f5153-1": { kind: "forum", title: t("Basis, a foundational on-chain reserve approach (first post)", "Basis, a foundational on-chain reserve approach (первый пост)"), url: F(5153, 1), date: "2025-05-05", by: "kushti" },
  "f5153-2": { kind: "forum", title: t("Basis thread, post 2: off-chain IOU money with trackers", "Ветка Basis, пост 2: офчейн-деньги на расписках с трекерами"), url: F(5153, 2), date: "2025-09-08", by: "kushti" },
  "f5153-3": { kind: "forum", title: t("Basis thread, post 3: the current model", "Ветка Basis, пост 3: текущая модель"), url: F(5153, 3), date: "2026-02-21", by: "kushti" },
  "f5217-1": { kind: "forum", title: t("P2P currencies, digital free banking and Better Money Labs", "P2P-валюты, цифровой фри-бэнкинг и Better Money Labs"), url: F(5217, 1), date: "2025-08-05", by: "kushti" },
  "f5221-1": { kind: "forum", title: t("Call for action: peer-to-peer economies on Ergo", "Призыв: p2p-экономики на Ergo"), url: F(5221, 1), date: "2025-08-19", by: "kushti" },
  "f5368-1": { kind: "forum", title: t("Ergo community self-governance via p2p money creation", "Самоуправление сообщества Ergo через p2p-создание денег"), url: F(5368, 1), date: "2026-09-30", by: "kushti" },
  "f5368-2": { kind: "forum", title: t("Same thread: who issues the community IOUs?", "Та же ветка: под чьими ключами выпускаются расписки?"), url: F(5368, 2), date: "2026-10-01", by: "bob" },
  "f5368-3": { kind: "forum", title: t("Same thread: how is this different from an investment portal?", "Та же ветка: чем это отличается от инвестпортала?"), url: F(5368, 3), date: "2026-10-04", by: "eddnorris" },

  // ---- Telegram (t.me/chaincashtalks, "ChainCash & Basis") ----
  "tg": { kind: "telegram", title: t("Telegram group ChainCash & Basis", "Telegram-группа ChainCash & Basis"), url: "https://t.me/chaincashtalks", note: t("The community chat linked from both READMEs.", "Чат сообщества, ссылка есть в обоих README.") },
  "tg-1317": { kind: "telegram", title: t("Personas of a Basis community", "Роли в сообществе Basis"), url: TG(1317), date: "2026-01-22", by: "Fitz" },
  "tg-1396": { kind: "telegram", title: t("First redemption on mainnet", "Первое погашение в mainnet"), url: TG(1396), date: "2026-03-26", by: "kushti" },
  "tg-1417": { kind: "telegram", title: t("New deck", "Новая презентация"), url: TG(1417), date: "2026-04-22", by: "kushti" },
  "tg-1419": { kind: "telegram", title: t("A consumer app should hide the blockchain", "Потребительское приложение должно прятать блокчейн"), url: TG(1419), date: "2026-04-24", by: "bob" },
  "tg-1433": { kind: "telegram", title: t("First note passed off the grid", "Первая расписка передана без интернета"), url: TG(1433), date: "2026-05-18", by: "kushti" },
  "tg-1455": { kind: "telegram", title: t("Whitepaper released", "Опубликован whitepaper"), url: TG(1455), date: "2026-06-13" },
  "tg-1492": { kind: "telegram", title: t("Last todos in the contract resolved", "Последние todo в контракте закрыты"), url: TG(1492), date: "2026-07-16", by: "kushti" },
  "tg-1509": { kind: "telegram", title: t("Two worlds of money", "Два мира денег"), url: TG(1509), date: "2026-07-21", by: "kushti" },
  "tg-1568": { kind: "telegram", title: t("USE reserve redemption test", "Тест погашения из резерва в USE"), url: TG(1568), date: "2026-08-19", by: "kushti" },
  "tg-1573": { kind: "telegram", title: t("Preparing for an experimental public deployment", "Подготовка к экспериментальному публичному развёртыванию"), url: TG(1573), date: "2026-08-28", by: "kushti" },
  "tg-1620": { kind: "telegram", title: t("Security issues addressed; release after", "Проблемы безопасности исправлены; релиз потом"), url: TG(1620), date: "2026-10-22", by: "kushti" },
  "tg-1625": { kind: "telegram", title: t("One token per reserve", "Один токен на резерв"), url: TG(1625), date: "2026-10-27", by: "kushti" },
  "tg-1653": { kind: "telegram", title: t("What is left before on-chain pre-deployment testing", "Что осталось до ончейн-тестов перед развёртыванием"), url: TG(1653), date: "2026-11-10", by: "kushti" },
  "tg-1656": { kind: "telegram", title: t("The 2026-11-10 test boxes were made by someone else", "Тестовые боксы 2026-11-10 создал не автор"), url: TG(1656), date: "2026-11-10", by: "kushti" },
  "tg-1657": { kind: "telegram", title: t("Staged-exchange bug report", "Сообщение об ошибке со staged-обменом"), url: TG(1657), date: "2026-11-11", by: "Fitz" },
  "tg-1665": { kind: "telegram", title: t("A community testnet pilot built on Basis", "Тестнет-пилот участника сообщества на Basis"), url: TG(1665), date: "2026-11-17", by: "Fitz" },
  "tg-1675": { kind: "telegram", title: t("Fixing the remaining review findings", "Исправляются оставшиеся находки ревью"), url: TG(1675), date: "2026-11-19", by: "kushti" },
} satisfies Record<string, Def>;

export type SourceId = keyof typeof defs;

export const sources: Record<SourceId, Source> = Object.fromEntries(
  Object.entries(defs).map(([id, d]) => [id, { id, ...(d as Def) }]),
) as Record<SourceId, Source>;

export function source(id: SourceId): Source {
  return sources[id];
}

/** Groups for the /learn/sources page, in display order. */
export const sourceGroups: { id: string; title: Text; ids: SourceId[] }[] = [
  { id: "code", title: t("Code and contracts", "Код и контракты"), ids: ["bt-repo", "bt-readme", "bt-basis-es", "bt-basis-token-es", "bt-commit-head", "bt-openapi", "bt-actions"] },
  { id: "lineage", title: t("ChainCash, the predecessor", "ChainCash, предшественник"), ids: ["cc-repo", "cc-readme", "cc-reserve-es", "cc-commit-first-basis", "cc-commit-rework", "cc-pr-19"] },
  {
    id: "specs",
    title: t("Specifications", "Спецификации"),
    ids: ["bt-spec-protocol", "bt-spec-tracker", "bt-spec-acceptance", "bt-spec-redemption-policy", "bt-spec-schnorr", "bt-spec-exchange", "bt-spec-multi-collateral", "bt-spec-reserve-admission", "bt-spec-compiled", "bt-spec-cross-tracker", "bt-spec-informal-clearing", "bt-spec-agent-integration", "bt-doc-free-banking", "bt-demo-agent-coop"],
  },
  { id: "papers", title: t("Papers and decks", "Статьи и презентации"), ids: ["bt-whitepaper", "bt-deck", "bt-deck-ramics"] },
  { id: "reviews", title: t("Security reviews and open work", "Ревью безопасности и открытые задачи"), ids: ["bt-spec-audit", "bt-12", "bt-14", "bt-15", "bt-spec-pr14-triage", "bt-16", "bt-spec-pr16-triage", "bt-17", "bt-18", "bt-19", "bt-20", "bt-21", "bt-22", "bt-23", "bt-24", "bt-25"] },
  { id: "forum", title: t("Forum threads", "Ветки форума"), ids: ["f3367-1", "f4015-1", "f4451-1", "f5122-1", "f5153-1", "f5153-2", "f5153-3", "f5217-1", "f5221-1", "f5368-1", "f5368-2", "f5368-3"] },
  { id: "telegram", title: t("Telegram", "Telegram"), ids: ["tg", "tg-1317", "tg-1396", "tg-1417", "tg-1419", "tg-1433", "tg-1455", "tg-1492", "tg-1509", "tg-1568", "tg-1573", "tg-1620", "tg-1625", "tg-1653", "tg-1656", "tg-1657", "tg-1665", "tg-1675"] },
];

export const sourcesIntro: Text = t(
  "Everything on this site comes from these public sources and from the chain itself. When a document and the code disagree, we follow the contract and the code at commit 43e2173 (2026-11-10).",
  "Всё на этом сайте взято из этих открытых источников и из самого блокчейна. Если документ расходится с кодом, мы следуем контракту и коду на коммите 43e2173 (2026-11-10).",
);
