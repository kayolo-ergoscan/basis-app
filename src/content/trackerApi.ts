// /learn/api: every HTTP endpoint of the reference tracker at commit 43e2173, grouped, with roles, purpose,
// illustrative request and response bodies, exact error strings and the traps a client must avoid.
//
// Examples are plain strings (not `Text`): they are code, the same in both languages, and the copy guard skips them.
// Hex values are shortened with "…"; amounts are raw units (nanoERG for ERG).

import type { SourceId } from "./sources";
import { t, type Text } from "./types";

export type ApiRole = "public" | "read" | "write" | "admin";
export type ApiMethod = "GET" | "POST";
export type ApiGroupId =
  | "health"
  | "notes"
  | "exchange"
  | "acceptance"
  | "issuer"
  | "reserves"
  | "config"
  | "tracker"
  | "proofs"
  | "redemption"
  | "legacy"
  | "events";

export interface ApiError {
  status: number;
  /** Exact server text (or its start, ending in "…"). */
  message: string;
  when?: Text;
}

export interface ApiEndpoint {
  /** 1–35, in the order of the reference table. */
  n: number;
  id: string;
  method: ApiMethod;
  path: string;
  query?: string[];
  role: ApiRole;
  group: ApiGroupId;
  purpose: Text;
  /** Illustrative request: a JSON body for POST, the full path with query for GET. */
  request?: string;
  /** Illustrative success response. */
  response: string;
  /** Success status (200 unless noted). */
  status?: number;
  errors?: ApiError[];
  gotchas?: Text[];
  /** Kept for older clients; a new client should not use it. */
  legacy?: boolean;
}

export interface ApiGroup {
  id: ApiGroupId;
  title: Text;
  lede: Text;
}

const A = "02a3…e1"; // issuer (illustrative)
const B = "03b7…4c"; // receiver (illustrative)
const NFT = "5d2e…9b";
const TOKEN = "a55b…04";
const TS = 1795219200000; // 2026-11-21 00:00 UTC, in ms

export const apiGroups: ApiGroup[] = [
  { id: "health", title: t("Health", "Проверка"), lede: t("Is the server up?", "Работает ли сервер?") },
  { id: "notes", title: t("Notes", "Расписки"), lede: t("Pay, list and check the commit state of notes.", "Платить, смотреть расписки и состояние их фиксации.") },
  { id: "exchange", title: t("Exchange", "Обмен"), lede: t("Move a debt from one denomination to another.", "Перенести долг из одной валюты в другую.") },
  { id: "acceptance", title: t("Acceptance policies", "Политики приёма"), lede: t("Ask whether a note would be accepted; publish and read policies.", "Узнать, примут ли расписку; опубликовать и прочитать политики.") },
  { id: "issuer", title: t("Issuer health", "Состояние эмитента"), lede: t("Debt, collateral and coverage of one issuer.", "Долг, обеспечение и покрытие одного эмитента.") },
  { id: "reserves", title: t("Reserves", "Резервы"), lede: t("Reserves the tracker follows, and a payment request for a new one.", "Резервы, за которыми следит трекер, и платёжный запрос на новый.") },
  { id: "config", title: t("Configuration", "Конфигурация"), lede: t("Contract addresses and the denominations this tracker serves.", "Адреса контрактов и валюты, которые обслуживает трекер.") },
  { id: "tracker", title: t("Tracker state", "Состояние трекера"), lede: t("Digests, the commit in flight and the current tracker box.", "Дайджесты, фиксация в пути и текущий бокс трекера.") },
  { id: "proofs", title: t("Proofs", "Доказательства"), lede: t("Tree proofs for verification screens.", "Доказательства из деревьев для экранов проверки.") },
  { id: "redemption", title: t("Redemption", "Погашение"), lede: t("The current path: build, sign input 0 locally, submit once.", "Текущий путь: собрать, подписать вход 0 у себя, отправить один раз.") },
  { id: "legacy", title: t("Legacy redemption", "Старые пути погашения"), lede: t("Older endpoints. They still answer, but a new client should not use them.", "Старые эндпоинты. Они ещё отвечают, но новому клиенту они не нужны.") },
  { id: "events", title: t("Events", "События"), lede: t("An in-memory event list. Do not build a feed on it.", "Список событий в памяти. Ленту на нём строить не стоит.") },
];

export const apiEndpoints: ApiEndpoint[] = [
  // ---- health ----
  {
    n: 1, id: "root", method: "GET", path: "/", role: "public", group: "health",
    purpose: t("Health check. The only route that never needs a credential.", "Проверка работы. Единственный маршрут, которому никогда не нужны учётные данные."),
    request: "GET /",
    response: "Hello, Basis Tracker API!",
    gotchas: [t("Plain text, not the JSON envelope.", "Обычный текст, а не JSON-конверт.")],
  },

  // ---- notes ----
  {
    n: 2, id: "notes-post", method: "POST", path: "/notes", role: "write", group: "notes",
    purpose: t("Issue or raise a note: the issuer's signed new total for one pair.", "Выписать или увеличить расписку: новый итог по паре с подписью эмитента."),
    request: `{
  "issuer_pubkey": "${A}",
  "recipient_pubkey": "${B}",
  "amount": 2500000000,
  "timestamp": ${TS},
  "signature": "8f1c…a0",
  "tracker_nft_id": "${NFT}",
  "denomination": "erg"
}`,
    response: `{ "success": true, "data": null, "error": null }`,
    status: 201,
    errors: [
      { status: 400, message: "Invalid signature" },
      { status: 400, message: "Future timestamp", when: t("The timestamp is ahead of the server clock (no tolerance).", "Метка времени опережает часы сервера (допуска нет).") },
      { status: 400, message: "Past timestamp", when: t("The timestamp is not newer than the stored one.", "Метка времени не новее сохранённой.") },
      { status: 400, message: "Cumulative debt cannot decrease without the creditor's consent (existing X, requested Y)" },
      { status: 400, message: "<field> exceeds the range the on-chain contract can represent: <v>" },
      { status: 409, message: "Note is bound to tracker NFT <x>, this tracker is <y>" },
      { status: 500, message: "Tracker thread unavailable" },
    ],
    gotchas: [
      t("`amount` is the new cumulative total, not the payment. Read the pair first and add to it.", "`amount` — новый накопленный итог, а не сумма платежа. Сначала прочитайте пару и прибавьте к итогу."),
      t("The same total with a newer timestamp is accepted.", "Тот же итог с более новой меткой времени принимается."),
      t("No collateral, policy, limit or consent check happens here. A receiver's protection is their own wallet policy.", "Здесь не проверяются ни обеспечение, ни политика, ни лимит, ни согласие. Защита получателя — политика его собственного кошелька."),
      t("A browser clock that runs ahead gets \"Future timestamp\". Use the current time minus a small margin.", "Если часы браузера спешат, будет «Future timestamp». Берите текущее время с небольшим запасом назад."),
    ],
  },
  {
    n: 3, id: "notes-all", method: "GET", path: "/notes", role: "read", group: "notes",
    purpose: t("The whole ledger: every note with its age.", "Весь реестр: все расписки с их возрастом."),
    request: "GET /notes",
    response: `{
  "success": true,
  "data": [{
    "issuer_pubkey": "${A}", "recipient_pubkey": "${B}",
    "amount_collected": 2500000000, "amount_redeemed": 0,
    "timestamp": ${TS}, "signature": "8f1c…a0",
    "tracker_nft_id": "${NFT}", "age_seconds": 840,
    "denomination": "erg",
    "confirmation": { "status": "confirmed", "redeemable": true, "redeemable_amount": 2500000000 }
  }],
  "error": null
}`,
    gotchas: [t("No pagination. Anyone with read access sees every pair and every issuer signature.", "Постраничного вывода нет. Любой с правом чтения видит все пары и все подписи эмитентов.")],
  },
  {
    n: 4, id: "notes-by-issuer", method: "GET", path: "/notes/issuer/{pk}", role: "read", group: "notes",
    purpose: t("What one key owes.", "Что должен один ключ."),
    request: `GET /notes/issuer/${A}`,
    response: `{ "success": true, "data": [ { "issuer_pubkey": "${A}", "recipient_pubkey": "${B}", "amount_collected": 2500000000, "amount_redeemed": 0, "…": "…" } ], "error": null }`,
    errors: [{ status: 400, message: "Invalid hex encoding" }],
  },
  {
    n: 5, id: "notes-by-recipient", method: "GET", path: "/notes/recipient/{pk}", role: "read", group: "notes",
    purpose: t("What one key is owed.", "Что должны одному ключу."),
    request: `GET /notes/recipient/${B}`,
    response: `{ "success": true, "data": [ { "issuer_pubkey": "${A}", "recipient_pubkey": "${B}", "…": "…" } ], "error": null }`,
  },
  {
    n: 6, id: "note-pair", method: "GET", path: "/notes/issuer/{issuer}/recipient/{recipient}", query: ["denomination"], role: "read", group: "notes",
    purpose: t("One pair's note.", "Расписка одной пары."),
    request: `GET /notes/issuer/${A}/recipient/${B}?denomination=erg`,
    response: `{ "success": true, "data": { "amount_collected": 2500000000, "amount_redeemed": 0, "timestamp": ${TS}, "signature": "8f1c…a0", "…": "…" }, "error": null }`,
    gotchas: [t("A missing pair answers 404 with success: true and data: null. Check data, not success.", "Если пары нет, ответ 404 с success: true и data: null. Проверяйте data, а не success.")],
  },
  {
    n: 7, id: "note-state", method: "POST", path: "/notes/state", role: "read", group: "notes",
    purpose: t("One pair's commit state: local, pending and confirmed totals, and how much can be redeemed.", "Состояние фиксации одной пары: локальный, ожидающий и подтверждённый итоги и сколько можно погасить."),
    request: `{ "issuer_pubkey": "${A}", "recipient_pubkey": "${B}", "denomination": "erg" }`,
    response: `{
  "success": true,
  "data": {
    "issuer_pubkey": "${A}", "recipient_pubkey": "${B}",
    "local": 2500000000, "confirmed": 2000000000, "pending": 2500000000,
    "already_redeemed": 0,
    "redeemable": true, "redeemable_amount": 2000000000,
    "status": "pending"
  },
  "error": null
}`,
    errors: [{ status: 404, message: "Note not found" }],
    gotchas: [t("`redeemable` ignores `status`. A note can be redeemed now only when status is \"confirmed\" and redeemable_amount > 0.", "`redeemable` не учитывает `status`. Погасить сейчас можно, только если status = «confirmed» и redeemable_amount > 0.")],
  },

  // ---- exchange ----
  {
    n: 8, id: "exchange", method: "POST", path: "/notes/exchange", role: "write", group: "exchange",
    purpose: t("Lower one denomination's note and raise another's for the same pair. Both parties sign both new totals.", "Уменьшить расписку пары в одной валюте и увеличить в другой. Обе стороны подписывают оба новых итога."),
    request: `{
  "issuer_pubkey": "${A}", "recipient_pubkey": "${B}",
  "from_denomination": "erg", "from_amount": 400000000,
  "to_denomination": "token:${TOKEN}", "to_amount": 100,
  "timestamp": ${TS},
  "issuer_from_signature": "…", "recipient_from_signature": "…",
  "issuer_to_signature": "…", "recipient_to_signature": "…"
}`,
    response: `{ "success": true, "data": { "exchanged": true, "from_denomination": "erg", "to_denomination": "token:${TOKEN}", "from_new_total": 2100000000, "to_new_total": 100, "timestamp": ${TS}, "to_edge_status": "pending" }, "error": null }`,
    errors: [
      { status: 409, message: "issuer X has no tracked reserve in denomination Y; exchanges require a tracked from-denomination reserve" },
      { status: 400, message: "rejected by acceptance policy '<name>' in the target denomination" },
    ],
    gotchas: [
      t("The decrease applies at once; the increase waits for the next confirmed commit. Only one staged exchange per pair.", "Уменьшение применяется сразу, увеличение ждёт следующей подтверждённой фиксации. На пару — не больше одного обмена в ожидании."),
      t("A cancelled exchange is not rolled back: the lowered note stays lowered. Any change to the from-reserve, even a top-up, cancels it.", "Отменённый обмен не откатывается: уменьшенная расписка остаётся уменьшенной. Любое изменение резерва исходной валюты, даже пополнение, отменяет обмен."),
    ],
  },
  {
    n: 9, id: "exchanges-pending", method: "GET", path: "/exchanges/pending", query: ["issuer_pubkey", "recipient_pubkey"], role: "read", group: "exchange",
    purpose: t("Staged and cancelled exchanges. An applied one leaves this list.", "Обмены в ожидании и отменённые. Применённый обмен из списка исчезает."),
    request: `GET /exchanges/pending?issuer_pubkey=${A}&recipient_pubkey=${B}`,
    response: `{ "success": true, "data": [ { "from_denomination": "erg", "from_old_total": 2500000000, "from_new_total": 2100000000, "to_denomination": "token:${TOKEN}", "to_amount": 100, "to_new_total": 100, "status": "staged", "created_at": ${TS} } ], "error": null }`,
    gotchas: [t("Cancelled records are pruned after 30 days.", "Отменённые записи удаляются через 30 дней.")],
  },

  // ---- acceptance ----
  {
    n: 10, id: "acceptance-check", method: "POST", path: "/acceptance/check", role: "read", group: "acceptance",
    purpose: t("Would this note be accepted? Advisory, against the gross debt.", "Примут ли эту расписку? Только рекомендация, по валовому долгу."),
    request: `{ "issuer_pubkey": "${A}", "total_debt": 2500000000, "recipient_pubkey": "${B}", "denomination": "erg" }`,
    response: `{ "success": true, "data": { "acceptable": false, "reason": "Note rejected by per-recipient policy 'cover-120'" }, "error": null }`,
    errors: [
      { status: 400, message: "issuer_pubkey must be hex-encoded" },
      { status: 400, message: "issuer_pubkey must be 33 bytes" },
    ],
    gotchas: [
      t("Always 200 for a well-formed request; read `acceptable`.", "На корректный запрос всегда 200; смотрите на `acceptable`."),
      t("Without a recipient only the global policy runs. With the default config the answer is \"No acceptance policy configured - rejecting by default\".", "Без получателя работает только глобальная политика. При настройках по умолчанию ответ — «No acceptance policy configured - rejecting by default»."),
    ],
  },
  {
    n: 11, id: "policy-post", method: "POST", path: "/acceptance/policy", role: "write", group: "acceptance",
    purpose: t("Publish my signed acceptance policy.", "Опубликовать свою подписанную политику приёма."),
    request: `{
  "recipient_pubkey": "${B}",
  "policy_json": "{\\"default\\":\\"reject\\",\\"predicates\\":[{\\"type\\":\\"collateralization\\",\\"name\\":\\"cover-120\\",\\"min_ratio\\":1.2}]}",
  "signature": "4b90…7d"
}`,
    response: `{ "success": true, "data": { "uploaded_at": 1795219200, "policy_hash": "9c1e2f0a7b3d4e55" }, "error": null }`,
    errors: [
      { status: 400, message: "signature must be 65 bytes (130 hex chars), got N bytes" },
      { status: 400, message: "Invalid policy JSON: …" },
      { status: 401, message: "Invalid signature: policy signature verification failed" },
      { status: 400, message: "Invalid policy structure: <e>" },
    ],
    gotchas: [
      t("The signature covers the raw policy text only: no nonce, no tracker, no time. An old signed policy can be uploaded again and replace a newer one.", "Подпись покрывает только текст политики: без нонса, трекера и времени. Старую подписанную политику можно загрузить снова, и она заменит новую."),
      t("A policy with a bad structure is stored before it is rejected. Every later check then answers \"Invalid stored policy - rejecting by default\".", "Политика с неверной структурой сохраняется до того, как её отклонят. Все последующие проверки отвечают «Invalid stored policy - rejecting by default»."),
      t("`policy_hash` is a display fingerprint (SipHash), not a cryptographic hash.", "`policy_hash` — отпечаток для показа (SipHash), а не криптографический хеш."),
    ],
  },
  {
    n: 12, id: "policy-get", method: "GET", path: "/acceptance/policy/{pk}", role: "read", group: "acceptance",
    purpose: t("Read anyone's published policy.", "Прочитать опубликованную политику любого ключа."),
    request: `GET /acceptance/policy/${B}`,
    response: `{ "success": true, "data": { "recipient_pubkey": "${B}", "policy_json": "{…}", "signature": "4b90…7d", "uploaded_at": 1795219200 }, "error": null }`,
    errors: [{ status: 404, message: "No policy found for this recipient" }],
  },

  // ---- issuer ----
  {
    n: 13, id: "key-status", method: "GET", path: "/key-status/{pk}", role: "read", group: "issuer",
    purpose: t("Issuer health per denomination: net debt, collateral, coverage, refund flag.", "Состояние эмитента по валютам: чистый долг, обеспечение, покрытие, флаг возврата."),
    request: `GET /key-status/${A}`,
    response: `{
  "success": true,
  "data": {
    "issuer_pubkey": "${A}", "note_count": 3, "last_updated": ${TS}, "has_pending_refund": false,
    "denominations": [{
      "denomination": "erg", "symbol": "ERG", "decimals": 9,
      "total_debt": 2500000000, "collateral": 3000000000,
      "collateralization_ratio": 1.2, "note_count": 3,
      "reserve_box_id": "b1f0…7e", "has_pending_refund": false
    }]
  },
  "error": null
}`,
    errors: [{ status: 409, message: "…A debt note is not bound to a specific reserve, so it would redeem in full against each of them. Close the extra reserves before issuing debt." }],
    gotchas: [
      t("`total_debt` is net: what is still owed. `collateralization_ratio` is 999999 when there is no debt and 0 when there is debt but no reserve.", "`total_debt` — чистый долг, то, что ещё не погашено. `collateralization_ratio` равен 999999, если долга нет, и 0, если долг есть, а резерва нет."),
      t("Never add numbers across denominations.", "Никогда не складывайте числа разных валют."),
    ],
  },

  // ---- reserves ----
  {
    n: 14, id: "reserves", method: "GET", path: "/reserves", role: "read", group: "reserves",
    purpose: t("Every reserve the tracker follows.", "Все резервы, за которыми следит трекер."),
    request: "GET /reserves",
    response: `{ "success": true, "data": [ { "box_id": "b1f0…7e", "owner_pubkey": "${A}", "collateral_amount": 3000000000, "total_debt": 0, "tracker_nft_id": "${NFT}", "last_updated_height": 1921849, "collateralization_ratio": null, "refund_initiation_height": null } ], "error": null }`,
    gotchas: [t("`total_debt` is always 0 and `collateralization_ratio` always null here. Use /key-status for both.", "Здесь `total_debt` всегда 0, а `collateralization_ratio` всегда null. Берите оба значения из /key-status.")],
  },
  {
    n: 15, id: "reserve-by-id", method: "GET", path: "/reserves/{box_id}", role: "read", group: "reserves",
    purpose: t("One reserve by box id.", "Один резерв по id бокса."),
    request: "GET /reserves/b1f0…7e",
    response: `{ "success": true, "data": { "box_id": "b1f0…7e", "…": "…" }, "error": null }`,
    gotchas: [t("An unknown box answers 404 with success: true and data: null.", "Неизвестный бокс даёт 404 с success: true и data: null.")],
  },
  {
    n: 16, id: "reserves-by-issuer", method: "GET", path: "/reserves/issuer/{pk}", role: "read", group: "reserves",
    purpose: t("One issuer's reserves.", "Резервы одного эмитента."),
    request: `GET /reserves/issuer/${A}`,
    response: `{ "success": true, "data": [ { "box_id": "b1f0…7e", "owner_pubkey": "${A}", "…": "…" } ], "error": null }`,
    gotchas: [t("Exact string match: send the 66-hex key in lowercase, without the 07 prefix from R4.", "Сравнение строк точное: отправляйте 66-символьный ключ строчными буквами, без префикса 07 из R4.")],
  },
  {
    n: 17, id: "reserves-quarantined", method: "GET", path: "/reserves/quarantined", role: "read", group: "reserves",
    purpose: t("Reserves the tracker refused to follow, with the reason.", "Резервы, которые трекер отказался учитывать, с причиной."),
    request: "GET /reserves/quarantined",
    response: `{ "success": true, "data": [ { "box_id": "c7a2…19", "owner_pubkey": "${A}", "denomination": "erg", "reason": "an active reserve already exists for this owner and denomination", "quarantined_at": ${TS} } ], "error": null }`,
    gotchas: [t("Quarantine is sticky: a box that entered it stays there. Top up the active reserve instead of creating a second one.", "Карантин необратим: попавший туда бокс там и остаётся. Пополняйте активный резерв, а не создавайте второй.")],
  },
  {
    n: 18, id: "reserves-create", method: "POST", path: "/reserves/create", role: "write", group: "reserves",
    purpose: t("A payment request that creates a reserve. The tracker creates nothing itself; the owner's wallet sends it.", "Платёжный запрос на создание резерва. Сам трекер ничего не создаёт — запрос отправляет кошелёк владельца."),
    request: `{ "nft_id": "e04d…5a", "owner_pubkey": "${A}", "erg_amount": 3000000000, "token_amount": 0, "token_id": "" }`,
    response: `{
  "success": true,
  "data": {
    "requests": [{
      "address": "<reserve contract P2S>",
      "value": 3000000000,
      "assets": [{ "token_id": "e04d…5a", "amount": 1 }],
      "registers": {
        "R4": "07${A}",
        "R5": "644ec61f485b98eb87153f7c57db4f5ecd75556fddbc403b41acf8441fde8e160900032000",
        "R6": "0e20${NFT}",
        "R7": "05000000000000000000"
      }
    }],
    "fee": 1000000,
    "change_address": "9f…owner"
  },
  "error": null
}`,
    errors: [
      { status: 400, message: "nft_id must not be the tracker NFT id" },
      { status: 400, message: "erg_amount X exceeds the configured per-reserve limit of Y nanoERG" },
      { status: 400, message: "token_id X is not served by this tracker (not in ergo.reserve_tokens)" },
      { status: 409, message: "an active reserve already exists for owner X in denomination D; one active reserve per (owner, denomination) is enforced" },
    ],
    gotchas: [
      t("`assets[].token_id` is snake_case; a node expects `tokenId`. Rename it before sending.", "`assets[].token_id` записан через подчёркивание, а узел ждёт `tokenId`. Переименуйте перед отправкой."),
      t("Mint the reserve NFT first, fund the box from the owner's own address, and keep R5 and R7 exactly as given, or the tracker quarantines the reserve.", "Сначала выпустите NFT резерва, оплатите бокс с собственного адреса владельца и оставьте R5 и R7 ровно такими, как в ответе, иначе трекер отправит резерв в карантин."),
      t("There is no endpoint for a top-up or a refund: the owner's wallet builds those transactions.", "Эндпоинтов для пополнения и возврата нет: такие транзакции собирает кошелёк владельца."),
    ],
  },

  // ---- config ----
  {
    n: 19, id: "config-p2s", method: "GET", path: "/config/reserve-contract-p2s", role: "read", group: "config",
    purpose: t("The ERG reserve contract address.", "Адрес контракта резерва в ERG."),
    request: "GET /config/reserve-contract-p2s",
    response: `{ "success": true, "data": "<ERG reserve P2S>", "error": null }`,
    errors: [{ status: 500, message: "Failed to load server configuration" }],
  },
  {
    n: 20, id: "config-token", method: "GET", path: "/config/reserve-token", role: "read", group: "config", legacy: true,
    purpose: t("Older single-token view: the first served token only.", "Старый вид для одного токена: только первый обслуживаемый токен."),
    request: "GET /config/reserve-token",
    response: `{ "success": true, "data": { "reserve_token_id": "${TOKEN}", "reserve_token_decimals": 0, "basis_token_reserve_contract_p2s": "<token reserve P2S>" }, "error": null }`,
  },
  {
    n: 21, id: "config-collateral", method: "GET", path: "/config/reserve-collateral", role: "read", group: "config",
    purpose: t("Both contract addresses and every denomination this tracker serves. Use it to fill currency pickers.", "Оба адреса контрактов и все валюты, которые обслуживает трекер. По нему заполняют выбор валюты."),
    request: "GET /config/reserve-collateral",
    response: `{
  "success": true,
  "data": {
    "erg_contract_p2s": "<ERG reserve P2S>",
    "token_contract_p2s": "<token reserve P2S>",
    "tokens": [{ "token_id": "${TOKEN}", "symbol": "USE", "decimals": 3 }],
    "denominations": [
      { "id": "erg", "symbol": "ERG", "decimals": 9 },
      { "id": "token:${TOKEN}", "symbol": "USE", "decimals": 3 }
    ]
  },
  "error": null
}`,
    gotchas: [t("A per-token minimum coverage may be listed here, but the tracker never enforces it.", "Здесь может быть указано минимальное покрытие для токена, но трекер его не применяет.")],
  },

  // ---- tracker state ----
  {
    n: 22, id: "tracker-state", method: "GET", path: "/tracker/state", role: "read", group: "tracker",
    purpose: t("Local, confirmed and pending digests. When local differs from confirmed, some notes are not committed yet.", "Локальный, подтверждённый и ожидающий дайджесты. Если локальный отличается от подтверждённого, часть расписок ещё не зафиксирована."),
    request: "GET /tracker/state",
    response: `{ "success": true, "data": { "local_digest": "4ec6…1f09", "confirmed_digest": "77ab…3e09", "confirmed_box_id": "d40e…22", "confirmed_height": 1921840, "pending_digest": "4ec6…1f09", "pending_tx_id": "9a3c…b1", "pending_submitted_height": 1921848, "tracker_box_id": "d40e…22" }, "error": null }`,
    gotchas: [t("A digest is 33 bytes in hex: the 32-byte root and one byte of tree height.", "Дайджест — 33 байта в hex: 32-байтный корень и один байт высоты дерева.")],
  },
  {
    n: 23, id: "tracker-pending", method: "GET", path: "/tracker/pending-tx", role: "read", group: "tracker",
    purpose: t("The commit transaction in flight, if any.", "Транзакция фиксации в пути, если она есть."),
    request: "GET /tracker/pending-tx",
    response: `{ "success": true, "data": { "pending_tx_id": "9a3c…b1", "pending_digest": "4ec6…1f09", "submitted_height": 1921848 }, "error": null }`,
  },
  {
    n: 24, id: "tracker-latest-box", method: "GET", path: "/tracker/latest-box-id", role: "read", group: "tracker",
    purpose: t("The current tracker box.", "Текущий бокс трекера."),
    request: "GET /tracker/latest-box-id",
    response: `{ "success": true, "data": { "tracker_box_id": "d40e…22", "timestamp": 1921840, "height": 1921840, "tracker_nft_id": "${NFT}" }, "error": null }`,
    errors: [{ status: 404, message: "No tracker boxes found" }],
    gotchas: [t("`timestamp` holds a block height, not a time.", "В `timestamp` лежит высота блока, а не время.")],
  },

  // ---- proofs ----
  {
    n: 25, id: "tracker-proof", method: "GET", path: "/tracker/proof", query: ["issuer_pubkey", "recipient_pubkey", "denomination"], role: "read", group: "proofs",
    purpose: t("A lookup proof of one note in the tracker's tree.", "Доказательство поиска одной расписки в дереве трекера."),
    request: `GET /tracker/proof?issuer_pubkey=${A}&recipient_pubkey=${B}&denomination=erg`,
    response: `{ "success": true, "data": { "key": "6f1d…c2", "value": "000000009502f900", "proof": "0a77…e4", "total_debt": 2500000000, "tracker_state_digest": "4ec6…1f09" }, "error": null }`,
    errors: [{ status: 404, message: "Debt record not found: <e>" }],
    gotchas: [t("Built from the live tree. It verifies against the on-chain digest only when the local and confirmed digests are equal; check that before saving it for an emergency exit.", "Строится по живому дереву. С дайджестом в блокчейне оно сходится, только если локальный и подтверждённый дайджесты равны; проверьте это, прежде чем сохранять его для аварийного выхода.")],
  },
  {
    n: 26, id: "reserve-proof", method: "GET", path: "/reserve/proof", query: ["issuer_pubkey", "recipient_pubkey", "amount", "timestamp", "denomination"], role: "read", group: "proofs",
    purpose: t("Proofs from the reserve's own tree: what was redeemed, and the update for this redemption.", "Доказательства из дерева резерва: что уже погашено и как дерево изменится после этого погашения."),
    request: `GET /reserve/proof?issuer_pubkey=${A}&recipient_pubkey=${B}&amount=500000000&timestamp=${TS}&denomination=erg`,
    response: `{ "success": true, "data": { "key": "1b9e…40", "value": "…", "proof": null, "already_redeemed": 0, "is_first_redemption": true, "insert_proof": "02c1…88", "new_reserve_state_digest": "5ad0…0109" }, "error": null }`,
    errors: [{ status: 400, message: "cumulative redeemed amount overflows u64" }],
    gotchas: [t("`proof` is null on a pair's first redemption. `timestamp` defaults to 0 when missing.", "`proof` равен null при первом погашении пары. Если `timestamp` не передан, он считается равным 0.")],
  },
  {
    n: 27, id: "proof-redemption", method: "GET", path: "/proof/redemption", query: ["issuer_pubkey", "recipient_pubkey", "denomination"], role: "read", group: "proofs", legacy: true,
    purpose: t("An older bundle of live proofs.", "Старый набор живых доказательств."),
    request: `GET /proof/redemption?issuer_pubkey=${A}&recipient_pubkey=${B}&denomination=erg`,
    response: `{ "success": true, "data": { "issuer_pubkey": "${A}", "recipient_pubkey": "${B}", "proof_data": "…", "tracker_state_digest": "4ec6…1f09", "block_height": 1921849, "timestamp": ${TS} }, "error": null }`,
    gotchas: [t("`timestamp` is the server's current time, not the note's.", "`timestamp` — текущее время сервера, а не метка расписки.")],
  },

  // ---- redemption ----
  {
    n: 28, id: "redemption-build", method: "POST", path: "/redemption/build", role: "write", group: "redemption",
    purpose: t("Build the redemption transaction. The tracker signs its own fee inputs; the receiver signs input 0 locally.", "Собрать транзакцию погашения. Трекер подписывает свои входы для комиссии, получатель подписывает вход 0 у себя."),
    request: `{
  "issuer_pubkey": "${A}",
  "recipient_pubkey": "${B}",
  "amount": 500000000,
  "timestamp": ${TS},
  "issuer_signature": "8f1c…a0",
  "denomination": "erg",
  "emergency": false
}`,
    response: `{
  "success": true,
  "data": {
    "unsigned_tx": { "inputs": [{ "boxId": "b1f0…7e", "extension": { "0": "0200", "5": "…", "1": "…", "6": "…", "2": "…", "3": "…", "8": "…", "4": "…" } }, "…"], "…": "…" },
    "partial_tx": { "…": "…" },
    "input_box_binaries": ["…"], "data_box_binaries": ["…"], "headers": ["…10 headers…"],
    "reserve_box_id": "b1f0…7e", "tracker_box_id": "d40e…22",
    "reserve_output_value": 2500000000, "recipient_output_value": 500000000,
    "total_debt": 2500000000, "change_amount": 0,
    "is_first_redemption": true, "fee": 1000000, "new_already_redeemed": 500000000
  },
  "error": null
}`,
    errors: [
      { status: 429, message: "rate limit exceeded: at most 60 redemption builds per hour per (issuer, recipient) pair" },
      { status: 400, message: "note not found for issuer/recipient" },
      { status: 400, message: "no unspent reserve with >= {required} units collateral and a reserve tree matching the tracker (digest …) for issuer …" },
      { status: 400, message: "failed_policy_violation: … collateralization ratio would drop from … to …" },
      { status: 400, message: "failed_not_oldest_note: reserve is distressed; only the oldest outstanding note (timestamp T1) may redeem, requested note has timestamp T2" },
      { status: 400, message: "note is not committed on-chain yet; wait for the next tracker box update" },
      { status: 400, message: "Committed tree digest mismatch…", when: t("Issue #24; fix proposed in PR #25.", "Issue #24; исправление предложено в PR #25.") },
      { status: 400, message: "reserve token amount would be zero after redemption" },
      { status: 500, message: "tracker secret key not configured for local signing" },
      { status: 503, message: "Too many outstanding redemption builds; try again shortly." },
    ],
    gotchas: [
      t("`timestamp` is required but ignored: the stored note's timestamp is used. `issuer_signature` must be the stored note signature.", "`timestamp` обязателен, но не используется: берётся метка сохранённой расписки. `issuer_signature` должна быть подписью сохранённой расписки."),
      t("At most 60 builds per hour per pair, counted before most checks: failed builds count too.", "Не больше 60 сборок в час на пару, и считаются они до большинства проверок: неудачные сборки тоже идут в счёт."),
      t("An ERG reserve must keep at least 0.001 ERG; a token reserve must keep at least one unit, so the most you can redeem is one unit less than it holds.", "В резерве в ERG должно остаться не меньше 0,001 ERG, в резерве в токене — хотя бы одна единица, поэтому погасить можно максимум на единицу меньше, чем в нём лежит."),
      t("A missing field is refused with a plain-text 422, outside the JSON envelope.", "Если поля не хватает, ответ — 422 обычным текстом, вне JSON-конверта."),
      t("`emergency: true` skips the tracker's policy checks and leaves #6 empty; the contract accepts that only after 2 160 blocks of tracker-box age.", "`emergency: true` пропускает проверки политики трекера и оставляет #6 пустым; контракт примет это только после 2 160 блоков возраста бокса трекера."),
    ],
  },
  {
    n: 29, id: "redemption-submit", method: "POST", path: "/redemption/submit", role: "write", group: "redemption",
    purpose: t("Broadcast the receiver-signed transaction. Single use, within 30 minutes of the build.", "Отправить транзакцию, подписанную получателем. Один раз и не позже 30 минут после сборки."),
    request: `{
  "signed_tx": { "…": "…" },
  "unsigned_tx": <the exact bytes /redemption/build returned>,
  "issuer_pubkey": "${A}",
  "recipient_pubkey": "${B}",
  "redeemed_amount": 500000000,
  "new_already_redeemed": 500000000
}`,
    response: `{ "success": true, "data": { "tx_id": "e2d7…5f" }, "error": null }`,
    errors: [
      { status: 409, message: "Unknown, expired or already-used unsigned_tx. Call POST /redemption/build again to obtain a fresh one." },
      { status: 400, message: "signed_tx is not a valid signed transaction: …" },
      { status: 400, message: "signed_tx <id> is not the transaction <id> built by the matching /redemption/build call" },
      { status: 400, message: "signed_tx reserve output R5 does not match the reserve tree digest computed by /redemption/build" },
      { status: 500, message: "broadcast failed: …" },
    ],
    gotchas: [
      t("Echo `unsigned_tx` byte for byte. The server hashes it with its key order kept; JSON.parse and JSON.stringify sort the extension keys \"0\", \"5\", \"1\", \"6\"… and the submit fails with 409.", "Возвращайте `unsigned_tx` байт в байт. Сервер хеширует его с исходным порядком ключей, а JSON.parse и JSON.stringify сортируют ключи расширения «0», «5», «1», «6»… — и отправка падает с 409."),
      t("The build entry is consumed before validation. Any failure, even a typo, needs a fresh build, which counts against the hourly limit.", "Запись о сборке удаляется до проверки. Любая ошибка, даже опечатка, требует новой сборки, а она идёт в часовой лимит."),
      t("The four last fields are ignored but still required.", "Последние четыре поля не используются, но обязательны."),
    ],
  },
  {
    n: 30, id: "tracker-signature", method: "POST", path: "/tracker/signature", role: "write", group: "redemption",
    purpose: t("The tracker's signature (#6) over a stored note, for clients that build the redemption themselves.", "Подпись трекера (#6) под сохранённой распиской — для клиентов, которые сами собирают погашение."),
    request: `{ "issuer_pubkey": "${A}", "recipient_pubkey": "${B}", "total_debt": 2500000000, "timestamp": ${TS}, "denomination": "erg", "emergency": false }`,
    response: `{ "success": true, "data": { "success": true, "tracker_signature": "03aa…91", "tracker_pubkey": "02f4…6b", "message_signed": "6f1d…(80 bytes)…9b" }, "error": null }`,
    errors: [
      { status: 404, message: "No note is recorded for this (issuer, recipient) pair. The tracker signs stored debt only; submit the note with POST /notes first." },
      { status: 409, message: "Request does not match stored note: caller asked for totalDebt=… timestamp=…, tracker has …" },
      { status: 409, message: "No tracked reserve found for issuer X in denomination D; refusing to sign a redemption the acceptance policy cannot evaluate" },
    ],
    gotchas: [t("The policy check assumes you redeem the whole outstanding amount.", "Проверка политики исходит из того, что вы погашаете весь непогашенный остаток.")],
  },

  // ---- legacy ----
  {
    n: 31, id: "redemption-prepare", method: "POST", path: "/redemption/prepare", role: "write", group: "legacy", legacy: true,
    purpose: t("Older: a live proof and a tracker signature made through the node.", "Старый путь: живое доказательство и подпись трекера через узел."),
    request: `{ "issuer_pubkey": "${A}", "recipient_pubkey": "${B}", "amount": 500000000, "timestamp": ${TS}, "emergency": false, "denomination": "erg" }`,
    response: `{ "success": true, "data": { "redemption_id": "redemption_02a3…_03b7…_${TS}", "avl_proof": "…", "tracker_signature": "…", "tracker_pubkey": "02f4…6b", "tracker_state_digest": "4ec6…1f09", "block_height": 1921849 }, "error": null }`,
    errors: [
      { status: 409, message: "Request timestamp X does not match the stored note timestamp Y." },
      { status: 500, message: "Tracker signature incompatible with Basis contract … Please configure tracker_secret_key for local signing." },
    ],
  },
  {
    n: 32, id: "redeem", method: "POST", path: "/redeem", role: "write", group: "legacy", legacy: true,
    purpose: t("Older: redemption data and a transaction skeleton. It changes nothing on chain.", "Старый путь: данные погашения и заготовка транзакции. В блокчейне ничего не меняется."),
    request: `{ "issuer_pubkey": "${A}", "recipient_pubkey": "${B}", "amount": 500000000, "timestamp": ${TS}, "issuer_signature": "8f1c…a0" }`,
    response: `{ "success": true, "data": { "redemption_id": "…", "amount": 500000000, "timestamp": ${TS}, "proof_available": true, "transaction_pending": true }, "error": null }`,
    errors: [{ status: 400, message: "Redemption failed: …" }],
    gotchas: [t("It only raises the tracker's own redeemed counter; no ERG moves.", "Он только увеличивает счётчик погашенного у самого трекера; ERG никуда не переходят.")],
  },
  {
    n: 33, id: "redeem-complete", method: "POST", path: "/redeem/complete", role: "admin", group: "legacy", legacy: true,
    purpose: t("Older: record a redemption by hand. Admin only.", "Старый путь: записать погашение вручную. Только для администратора."),
    request: `{ "redemption_id": "…", "issuer_pubkey": "${A}", "recipient_pubkey": "${B}", "redeemed_amount": 500000000 }`,
    response: `{ "success": true, "data": { "…": "…" }, "error": null }`,
    errors: [
      { status: 400, message: "redeemed_amount must be greater than 0" },
      { status: 403, message: "Insufficient privileges: route requires Admin access" },
    ],
  },

  // ---- events ----
  {
    n: 34, id: "events", method: "GET", path: "/events", role: "read", group: "events",
    purpose: t("The first 50 events, oldest first.", "Первые 50 событий, начиная с самых старых."),
    request: "GET /events",
    response: `{ "success": true, "data": [ { "id": 7, "event_type": { "type": "NoteUpdated" }, "timestamp": ${TS}, "issuer_pubkey": "${A}", "recipient_pubkey": "${B}", "amount": 2500000000 } ], "error": null }`,
    gotchas: [
      t("Not the latest events: the first 50, and the list starts with seven demo events.", "Это не последние события, а первые 50, и список начинается с семи демонстрационных."),
      t("Kept in memory and lost on restart. Only accepted notes are added; commits and redemptions are not.", "Хранится в памяти и пропадает при перезапуске. Добавляются только принятые расписки; фиксации и погашения — нет."),
    ],
  },
  {
    n: 35, id: "events-paginated", method: "GET", path: "/events/paginated", query: ["page", "page_size"], role: "read", group: "events",
    purpose: t("Events by page (default page 0, 20 per page).", "События по страницам (по умолчанию страница 0, по 20 на странице)."),
    request: "GET /events/paginated?page=0&page_size=20",
    response: `{ "success": true, "data": [ { "id": 1, "event_type": { "type": "ReserveCreated" }, "…": "…" } ], "error": null }`,
    gotchas: [t("A page past the end crashes the handler and drops the connection.", "Страница за концом списка роняет обработчик и обрывает соединение.")],
  },
];

export const trackerApi = {
  title: t("Tracker API", "API трекера"),
  lede: t(
    "The reference tracker speaks HTTP and JSON on port 3048. These are all 35 endpoints at commit 43e2173.",
    "Эталонный трекер общается по HTTP и JSON на порту 3048. Здесь все 35 эндпоинтов на коммите 43e2173.",
  ),
  illustrative: t(
    "Examples are illustrative: hex values are shortened, and amounts are raw units (nanoERG for ERG).",
    "Примеры условные: hex-значения сокращены, суммы указаны в минимальных единицах (nanoERG для ERG).",
  ),
  noPublicTracker: t(
    "ErgoScan's tracker on mainnet (beta) opens only its public read routes, and this site reads them for the Mainnet console. To try every call, run the reference server yourself.",
    "Трекер ErgoScan в mainnet (бета) открывает только публичные маршруты чтения, и этот сайт читает их для консоли основной сети. Чтобы попробовать все запросы, запустите эталонный сервер сами.",
  ),
  envelope: {
    title: t("Response envelope", "Конверт ответа"),
    shape: `{ "success": boolean, "data": T | null, "error": string | null }`,
    text: t(
      "Every JSON route answers with this envelope. Two routes answer \"not found\" as 404 with success: true and data: null, so check data rather than success.",
      "Все JSON-маршруты отвечают в этом конверте. Два маршрута сообщают «не найдено» как 404 с success: true и data: null, поэтому проверяйте data, а не success.",
    ),
  },
  statusCodes: [
    { status: 400, text: t("Validation failed, and most domain errors.", "Ошибка проверки и большинство предметных ошибок.") },
    { status: 401, text: t("No valid credential.", "Нет действительных учётных данных.") },
    { status: 403, text: t("Role too low, or a non-loopback Host header in open mode.", "Недостаточная роль или Host не loopback в открытом режиме.") },
    { status: 404, text: t("Not found.", "Не найдено.") },
    { status: 409, text: t("Stored state differs from the request. The most important code for a client.", "Сохранённое состояние расходится с запросом. Самый важный код для клиента.") },
    { status: 413, text: t("Body larger than 256 KiB.", "Тело больше 256 КиБ.") },
    { status: 422, text: t("A required field is missing (plain text).", "Не хватает обязательного поля (обычный текст).") },
    { status: 429, text: t("Redemption build limit reached.", "Достигнут лимит сборок погашения.") },
    { status: 500, text: t("Internal or node error.", "Внутренняя ошибка или ошибка узла.") },
    { status: 503, text: t("Tracker busy, or too many open builds.", "Трекер занят или слишком много открытых сборок.") },
  ] as { status: number; text: Text }[],
  roles: {
    public: t("public", "публичный"),
    read: t("read", "чтение"),
    write: t("write", "запись"),
    admin: t("admin", "админ"),
  } satisfies Record<ApiRole, Text>,
  auth: {
    title: t("Authentication", "Аутентификация"),
    text: t(
      "With a credential mode on, every route except GET / needs a credential, reads included. In open mode the server answers only on loopback.",
      "Когда включён режим с учётными данными, они нужны всем маршрутам, кроме GET /, включая чтение. В открытом режиме сервер отвечает только на loopback.",
    ),
    modes: [
      { id: "none", headers: [] as string[], text: t("Default. Every caller is an admin, so the server refuses a public address unless told otherwise.", "По умолчанию. Любой вызывающий — администратор, поэтому сервер не слушает публичный адрес, если это явно не разрешено.") },
      { id: "api_key", headers: ["Authorization: Bearer <key>", "X-API-Key: <key>"], text: t("One key gives write access, a separate admin key gives admin access. No replay protection.", "Один ключ даёт право записи, отдельный ключ — права администратора. Защиты от повтора нет.") },
      { id: "signature", headers: ["X-Signature-Pubkey: <66 hex>", "X-Signature: <130 hex>", "X-Signature-Timestamp: <ms>", "X-Signature-Nonce: <string>"], text: t("Each request is signed with the same Schnorr scheme as notes; the key's role comes from the server's client list. Timestamps must be within ±30 000 ms.", "Каждый запрос подписывается той же схемой Шнорра, что и расписки; роль ключа берётся из списка клиентов сервера. Метка времени должна укладываться в ±30 000 мс.") },
    ],
    canonicalLines: ["METHOD", "PATH", "QUERY", "TIMESTAMP_MS", "NONCE", "sha256hex(BODY)"],
    canonicalText: t("The signed string: these six lines joined with \\n.", "Подписываемая строка: эти шесть строк, соединённые через \\n."),
    errors: [
      "Missing X-Signature-Pubkey header",
      "Invalid signature length: expected 130 hex characters, got {}",
      "Public key is not authorized",
      "Insufficient privileges: route requires Admin access",
      "Forbidden: Host header is not a loopback address",
    ],
  },
  limits: [
    { id: "body", value: "256 KiB", text: t("Request body cap.", "Предел размера тела запроса.") },
    { id: "timeout", value: "30 s", text: t("Request timeout.", "Тайм-аут запроса.") },
    { id: "builds", value: "60 / h / pair", text: t("Redemption builds per issuer–receiver pair. The only rate limit.", "Сборок погашения на пару эмитент–получатель. Единственный лимит частоты.") },
    { id: "ttl", value: "30 min", text: t("Lifetime of a build before submit.", "Время жизни сборки до отправки.") },
    { id: "pending", value: "1024", text: t("Open builds at once.", "Открытых сборок одновременно.") },
    { id: "commit", value: "600 s", text: t("Commit cadence; unchanged digests are not posted.", "Частота фиксаций; неизменный дайджест не публикуется.") },
    { id: "depth", value: "2", text: t("Confirmation depth.", "Глубина подтверждения.") },
  ] as { id: string; value: string; text: Text }[],
  /** The traps worth a banner on the API page. */
  gotchas: [
    t("Echo `unsigned_tx` exactly as received. Re-serialising it in JavaScript reorders its keys and breaks the submit.", "Возвращайте `unsigned_tx` ровно в том виде, в каком получили. Повторная сериализация в JavaScript меняет порядок ключей и ломает отправку."),
    t("A submit works once. Any failure means a new build, and builds are limited to 60 per hour per pair.", "Отправка срабатывает один раз. Любая ошибка — значит новая сборка, а сборок не больше 60 в час на пару."),
    t("Browsers cannot call a tracker directly unless its allow-list names your origin. A web app needs a same-origin proxy that holds the credential, never an admin one.", "Браузер не может обращаться к трекеру напрямую, если в списке разрешённых нет вашего источника. Веб-приложению нужен прокси на том же источнике, который хранит учётные данные — и никогда не административные."),
    t("Send the denomination explicitly. An empty value silently resolves to the pair's only denomination, or to ERG.", "Всегда указывайте валюту явно. Пустое значение молча превращается в единственную валюту пары или в ERG."),
    t("Public keys are 66 hex characters. Strip the 07 prefix that R4 adds.", "Открытые ключи — 66 hex-символов. Убирайте префикс 07, который добавляет R4."),
    t("Amounts are raw units below 2^63.", "Суммы — в минимальных единицах и меньше 2^63."),
    t("/reserves shows debt 0 and coverage null; use /key-status. `redeemable` ignores status; check status = \"confirmed\" too.", "/reserves показывает долг 0 и покрытие null — используйте /key-status. `redeemable` не учитывает status — проверяйте ещё и status = «confirmed»."),
    t("/tracker/latest-box-id returns a height in `timestamp`. /tracker/proof uses the live tree. /reserve/proof has no proof on a first redemption.", "/tracker/latest-box-id возвращает высоту в `timestamp`. /tracker/proof строится по живому дереву. /reserve/proof не отдаёт доказательство при первом погашении."),
    t("/events starts with demo data and keeps only the first 50; past the last page /events/paginated drops the connection.", "/events начинается с демонстрационных данных и отдаёт только первые 50; за последней страницей /events/paginated обрывает соединение."),
  ],
  sources: ["bt-openapi", "bt-spec-tracker", "bt-21", "bt-24"] as SourceId[],
};
