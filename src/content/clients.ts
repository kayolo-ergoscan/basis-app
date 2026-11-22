// Ready-made programs: the three clients in the Basis reference software (BetterMoneyLabs/basis-tracker at the pinned
// commit, CC0, all written in Rust) and what ErgoScan's tracker accepts from them. Only the /learn/api#clients block
// shows these facts; every other page links there with CLIENTS_HREF instead of repeating them.
//
// The route lists name endpoints of the API catalogue by id (trackerApi.ts), so the block shows the catalogue's paths
// and links each one to its entry (#ep-<id>). A family of routes with no single entry goes in `paths`, as written.

import { GIT_REF_SHORT } from "./contractSource";
import { copy } from "./copy";
import { BT_TREE } from "./sources";
import { t, type AppRoute, type Text } from "./types";

/** The block on the API page that other pages link to. */
export const CLIENTS_HREF: AppRoute = "/learn/api#clients";

/** ErgoScan's tracker, as these programs reach it. */
export const ERGOSCAN_TRACKER_URL = "https://basis.ergoscan.me/api/tracker";

export type ClientId = "cli" | "tui" | "mcp";

export interface ClientProgram {
  id: ClientId;
  /** The name the program calls itself. */
  name: string;
  /** Its kind, the same in both languages. */
  tag: "CLI" | "TUI" | "MCP";
  /** Its folder in basis-tracker. */
  crate: string;
  /** That folder on GitHub at the pinned commit. */
  url: string;
  /** What it is and who it is for, in one line. */
  line: Text;
  /** What it does: 3–5 short points. */
  does: Text[];
  /** A footnote under the points. */
  note?: Text;
}

export interface ClientRouteGroup {
  id: string;
  title: Text;
  /** Endpoint ids of the API catalogue (`apiEndpoints`). */
  endpoints: string[];
  /** Routes with no single catalogue entry. */
  paths?: string[];
  text?: Text;
}

const crate = (dir: string) => ({ crate: `crates/${dir}`, url: `${BT_TREE}/crates/${dir}` });

export const clientPrograms: ClientProgram[] = [
  {
    id: "cli",
    name: "basis-cli",
    tag: "CLI",
    ...crate("basis_cli"),
    line: t("A command-line client, for people who work in a terminal and for scripts.", "Клиент для командной строки — для тех, кто работает в терминале, и для скриптов."),
    does: [
      t("Accounts and notes", "Аккаунты и расписки"),
      t("Reserves and redemptions", "Резервы и погашения"),
      t("The acceptance policy and status", "Политика приёма и статус"),
      t("`--json` output for scripts", "Вывод `--json` для скриптов"),
    ],
  },
  {
    id: "tui",
    name: "basis-ui",
    tag: "TUI",
    ...crate("basis_app"),
    line: t(
      "A wallet in the terminal, on the same library as basis-cli, for people who prefer a wallet screen to commands.",
      "Кошелёк в терминале на той же библиотеке, что и basis-cli, — для тех, кому удобнее экран кошелька, чем команды.",
    ),
    does: [
      t("Accounts, issuing and receiving notes", "Аккаунты, выпуск и получение расписок"),
      t("Creating and watching reserves", "Создание резервов и наблюдение за ними"),
      t("Redeeming and the acceptance policy", "Погашение и политика приёма"),
      t("A main menu with assets, liabilities, net position and reserve coverage", "Главное меню: активы, обязательства, чистая позиция и покрытие резервом"),
      t("Warnings below 150 %, 120 % and 100 % coverage", "Предупреждения при покрытии ниже 150 %, 120 % и 100 %"),
    ],
    note: copy.thresholdsArePolicy,
  },
  {
    id: "mcp",
    name: "basis-mcp",
    tag: "MCP",
    ...crate("basis_mcp"),
    line: t("An MCP (Model Context Protocol) server over stdio, for AI agents.", "Сервер MCP (Model Context Protocol) через stdio — для ИИ-агентов."),
    does: [
      t("Accounts, issuing and redeeming notes", "Аккаунты, выпуск и погашение расписок"),
      t("Checking reserves and managing the acceptance policy", "Проверка резервов и управление политикой приёма"),
      t("The same command cores as `basis-cli --json`", "Те же командные ядра, что и у `basis-cli --json`"),
      t("Private keys stay in the process and are never sent back to the agent", "Закрытые ключи остаются в процессе и никогда не передаются агенту"),
    ],
  },
];

export const clients = {
  /** The one line above the cards. */
  lede: t("These are the reference programs by Better Money Labs, not ErgoScan's.", "Это эталонные программы Better Money Labs, а не ErgoScan."),
  foot: t(
    `All three are written in Rust and live in the basis-tracker repository (CC0). The code links point to commit ${GIT_REF_SHORT}.`,
    `Все три написаны на Rust и лежат в репозитории basis-tracker (CC0). Ссылки на код ведут на коммит ${GIT_REF_SHORT}.`,
  ),
  /** Each card's "With ErgoScan's tracker" lines (the three share one library, so the answer is the same). */
  withTracker: {
    yes: t("reading data, new notes, and creating a reserve through your own node's wallet", "чтение данных, новые расписки и создание резерва через кошелёк вашего узла"),
    no: t("redemption and a few other requests (listed below)", "погашение и ещё несколько запросов (список ниже)"),
  },
  /** The redemption caveat, in one plain sentence. */
  redemption: t(
    "You cannot redeem notes through ErgoScan's tracker with these programs: the tracker requires the receiver's signature on the redemption request, and the programs do not add it.",
    "Погасить расписку через трекер ErgoScan этими программами нельзя: трекер требует подпись получателя на запросе погашения, а программы её не ставят.",
  ),
  routesLede: t(
    "Request by request, from the programs' code and the tracker's rules. We have not run the programs against it end to end.",
    "По каждому запросу — по коду программ и правилам трекера. Целиком мы эти программы с трекером ErgoScan не запускали.",
  ),
  accepted: [
    {
      id: "reads",
      title: t("Reads", "Чтение"),
      endpoints: ["root", "tracker-state", "tracker-latest-box", "tracker-pending", "config-p2s", "config-token", "config-collateral", "reserves", "reserve-by-id", "reserves-by-issuer", "key-status", "note-pair", "note-state"],
      text: t(
        "Health, the tracker's state and configuration, reserves, an issuer's status, and one pair's note with its commit state.",
        "Проверка работы, состояние и конфигурация трекера, резервы, состояние эмитента и расписка одной пары с состоянием её фиксации.",
      ),
    },
    {
      id: "notes",
      title: t("New notes", "Новые расписки"),
      endpoints: ["notes-post"],
      text: t(
        "The issuer needs one active reserve under ErgoScan's tracker, and there are per-issuer caps.",
        "У эмитента должен быть один действующий резерв под трекером ErgoScan, и есть лимиты на каждого эмитента.",
      ),
    },
    {
      id: "reserve",
      title: t("Creating a reserve", "Создание резерва"),
      endpoints: ["reserves-create"],
      text: t(
        "The tracker returns a payment request, and the program sends it to your own Ergo node's wallet (`node_url` and `node_api_key` in `cli.toml`). That wallet must be the reserve owner's, so you need your own node with a wallet.",
        "Трекер возвращает платёжный запрос, а программа отправляет его в кошелёк вашего узла Ergo (`node_url` и `node_api_key` в `cli.toml`). Этот кошелёк должен принадлежать владельцу резерва, так что нужен свой узел с кошельком.",
      ),
    },
  ] satisfies ClientRouteGroup[],
  refused: [
    {
      id: "redemption",
      title: t("Redemption", "Погашение"),
      endpoints: ["redemption-build", "redeem", "redemption-prepare", "tracker-proof"],
      text: t(
        "ErgoScan's tracker requires the receiver to sign the build request (`basis-build-v1`). These programs do not sign it, so `POST /redemption/build` returns error 400. `/redeem`, `/redemption/prepare` and `/tracker/proof` are closed at its public address.",
        "Трекер ErgoScan требует, чтобы получатель подписал запрос на сборку (`basis-build-v1`). Эти программы его не подписывают, поэтому `POST /redemption/build` возвращает ошибку 400. `/redeem`, `/redemption/prepare` и `/tracker/proof` на его публичном адресе закрыты.",
      ),
    },
    {
      id: "key-notes",
      title: t("All notes of one key", "Все расписки одного ключа"),
      endpoints: ["notes-by-issuer", "notes-by-recipient"],
      text: t("Closed, so that a key does not show who it works with.", "Закрыто, чтобы ключ не выдавал, с кем он работает."),
    },
    {
      id: "policy-events",
      title: t("Acceptance policy upload and the events feed", "Загрузка политики приёма и лента событий"),
      endpoints: ["events"],
      paths: ["/acceptance/*"],
    },
  ] satisfies ClientRouteGroup[],
};
