// /learn/faq: sixteen questions. The first six are the community's own questions (forum, Telegram);
// the rest are the ones every visitor asks. Each answer starts with a one-line `short` answer.

import { copy } from "./copy";
import type { SourceId } from "./sources";
import { denial, t, type InternalLink, type Text } from "./types";

export type FaqTag = "community" | "trust" | "money" | "status" | "wallet" | "tracker" | "site";

export interface Faq {
  id: string;
  q: Text;
  /** One line; safe to show alone in a teaser. */
  short: Text;
  /** Paragraphs. */
  a: Text[];
  tags: FaqTag[];
  /** The original community question, verbatim (English), when someone asked it in public. */
  asked?: { who: string; quote: string; source: SourceId };
  links?: InternalLink[];
  sources: SourceId[];
}

export const faqTitle: Text = t("Questions", "Вопросы");

export const faq: Faq[] = [
  {
    id: "who-issues",
    q: t("Who issues the notes, and who backs them?", "Кто выпускает расписки и кто их обеспечивает?"),
    short: t("Everyone issues their own notes. Only the issuer's own reserve can back them.", "Каждый выпускает свои расписки сам. Обеспечить их может только собственный резерв эмитента."),
    a: [
      t("Every participant is an issuer. A note is signed with the issuer's own key and names the receiver.", "Каждый участник — эмитент. Расписка подписана его собственным ключом, и в ней указан получатель."),
      t("Backing is optional and personal. An issuer may lock ERG or one token in a reserve, and only that reserve pays that issuer's notes.", "Обеспечение необязательно и персонально. Эмитент может положить в резерв ERG или один токен, и только этот резерв платит по его распискам."),
      t("Whose key would run a first community tracker has no public answer yet.", "Чей ключ будет у первого трекера сообщества, публично пока не решено."),
    ],
    tags: ["community", "money"],
    asked: { who: "bob", quote: "Whos key/s will the community IOUs be issued under?", source: "f5368-2" },
    sources: ["bt-basis-es", "f5368-1"],
  },
  {
    id: "what-stands-behind",
    q: t("What stands behind a note right now, and how fresh is that view?", "Что стоит за распиской прямо сейчас и насколько это свежие данные?"),
    short: t("The issuer's reserve as of the last block, and the total as of the tracker's last commit.", "Резерв эмитента на последнем блоке и итог на момент последней фиксации трекера."),
    a: [
      t("Two things: the issuer's reserve on Ergo, if there is one, and the total the tracker last committed.", "Две вещи: резерв эмитента в Ergo, если он есть, и итог, который трекер зафиксировал последним."),
      t("Coverage is the reserve divided by what the issuer owes. It changes when others redeem or the issuer issues more, so it is always shown as of a block.", "Покрытие — это резерв, делённый на долг эмитента. Оно меняется, когда другие погашают или эмитент выписывает новые расписки, поэтому его всегда показывают на конкретном блоке."),
      t("A new payment can be redeemed once it is confirmed, usually about 14 minutes later.", "Новый платёж можно погасить, когда он подтверждён, — обычно примерно через 14 минут."),
    ],
    tags: ["community", "money", "trust"],
    sources: ["bt-spec-tracker", "bt-spec-acceptance"],
  },
  {
    id: "can-i-be-cheated",
    q: t("Can I be cheated by the tracker, the issuer, or someone with many keys?", "Могут ли меня обмануть трекер, эмитент или человек с множеством ключей?"),
    short: t("Nobody can rewrite what the issuer signed, but the tracker can censor and the issuer can let the reserve run down.", "Подписанное эмитентом никто не перепишет, но трекер может цензурировать, а эмитент — довести резерв до нуля."),
    a: [
      t("The tracker cannot steal or forge notes. It can refuse or leave out your note, and the contract cannot make it include it.", "Трекер не может украсть или подделать расписку. Он может отказать или не включить вашу расписку, и контракт не заставит его это сделать."),
      t("The issuer cannot lower a total they signed. They can promise more than their reserve holds, or announce a refund, so watch coverage and refund warnings.", "Эмитент не может уменьшить подписанный итог. Но он может наобещать больше, чем лежит в резерве, или объявить возврат, — следите за покрытием и предупреждениями."),
      t("One person can make many keys and pose as many neighbours. Basis does not detect that; your whitelist and limits are your defence.", "Один человек может завести много ключей и выдавать себя за разных соседей. Basis этого не распознаёт; ваша защита — белый список и лимиты."),
      t("When a reserve is short, redemptions race: the first valid transaction on chain is paid first.", "Если резерва не хватает, погашения соревнуются: первой получает та корректная транзакция, что раньше попала в блок."),
    ],
    tags: ["community", "trust"],
    links: [{ label: t("Trust model", "Модель доверия"), to: "/learn/trust" }],
    sources: ["bt-readme", "bt-15", "bt-spec-redemption-policy"],
  },
  {
    id: "investment",
    q: t("Is this an investment?", "Это инвестиция?"),
    short: denial("No. A note is a debt someone owes you; it does not earn anything.", "Нет. Расписка — это долг перед вами, она ничего не приносит."),
    a: [
      denial("Notes pay no interest and no yield. A note is worth what its issuer can and will pay.", "По распискам нет ни процентов, ни доходности. Расписка стоит столько, сколько эмитент может и готов заплатить."),
      t("There is no Basis token and no protocol fee. The software is public domain (CC0).", "Токена Basis нет, комиссии протокола нет. Программы — общественное достояние (CC0)."),
      t("Treat a note like an IOU from that person, because that is what it is.", "Относитесь к расписке как к долговой расписке этого человека — это она и есть."),
    ],
    tags: ["community", "money"],
    asked: { who: "eddnorris", quote: "How do you see this differing from an investment portal?", source: "f5368-3" },
    sources: ["bt-readme", "bt-deck"],
  },
  {
    id: "work-quality",
    q: t("Does Basis check that the work was good?", "Проверяет ли Basis, что работа сделана хорошо?"),
    short: t("No. It records promises and pays them out; judging the work stays with people.", "Нет. Он записывает обещания и выплачивает их, а оценивать работу остаётся людям."),
    a: [
      t("A note says that someone owes you, not why.", "Расписка говорит, что вам должны, но не говорит за что."),
      t("Limits cap how much you can lose to one issuer. Reputation and reviews live outside the protocol.", "Лимиты ограничивают, сколько можно потерять на одном эмитенте. Репутация и отзывы — вне протокола."),
    ],
    tags: ["community", "trust"],
    sources: ["bt-spec-acceptance"],
  },
  {
    id: "no-blockchain",
    q: t("Can I use it without the blockchain, in my own unit?", "Можно ли пользоваться без блокчейна и в своей валюте?"),
    short: t("Paying needs no blockchain. Only backing and redeeming touch Ergo, and units are ERG or tokens on Ergo.", "Для платежа блокчейн не нужен. Ergo участвует только в обеспечении и погашении, а валюта — ERG или токены в Ergo."),
    a: [
      t("Paying is a signature. You touch Ergo only to back your notes or to redeem them.", "Платёж — это подпись. С Ergo вы имеете дело, только когда обеспечиваете расписки или погашаете их."),
      t("A note's unit is ERG or one token on Ergo. A fiat unit would need a token that tracks it; Basis itself converts nothing.", "Расписка выражена в ERG или в одном токене Ergo. Для фиатной валюты нужен токен, который её отслеживает; сам Basis ничего не конвертирует."),
      t("A friendly app can hide keys and blocks. This site shows them on purpose, so you can see how it works.", "Удобное приложение может спрятать ключи и блоки. Этот сайт показывает их намеренно, чтобы было видно, как всё устроено."),
    ],
    tags: ["community", "wallet"],
    asked: { who: "bob", quote: "A consumer friendly app would need to hide all that blockchain stuff as much as possible, also should be denominated in chosable fiat, not mg of gold or erg.", source: "tg-1419" },
    sources: ["bt-readme", "bt-spec-multi-collateral"],
  },
  {
    id: "fee",
    q: t("Is there a fee?", "Есть ли комиссия?"),
    short: t("No protocol fee. A redemption pays the 0.001 ERG miner fee; paying with a note is free.", "Комиссии протокола нет. Погашение платит комиссию майнера 0,001 ERG; платёж распиской бесплатен."),
    a: [
      t("The reserve contract takes nothing: the receiver gets exactly the amount redeemed.", "Контракт резерва ничего не удерживает: получатель получает ровно погашенную сумму."),
      t("Every Ergo transaction pays a miner fee, 0.001 ERG here. When the tracker builds the redemption, the tracker pays it.", "Каждая транзакция в Ergo платит комиссию майнера, здесь — 0,001 ERG. Если погашение собирает трекер, её платит трекер."),
      copy.feeDenial,
      t("A tracker operator may charge for its service in future. Nothing in the contract does.", "Оператор трекера в будущем может брать плату за свою услугу. В контракте ничего такого нет."),
    ],
    tags: ["money"],
    sources: ["bt-basis-es", "cc-reserve-es"],
  },
  {
    id: "tracker-disappears",
    q: t("What if the tracker disappears?", "Что, если трекер исчезнет?"),
    short: t("After 2 160 blocks ≈ 3 days without a new tracker box, you can redeem without its signature, if you kept the proof of your note.", "Через 2 160 блоков ≈ 3 дня без нового бокса трекера можно погашать без его подписи — если вы сохранили доказательство своей расписки."),
    a: [
      t("The contract watches the age of the tracker's box. Once it is older than 2 160 blocks, the tracker's signature becomes optional.", "Контракт смотрит на возраст бокса трекера. Когда ему больше 2 160 блоков, подпись трекера становится необязательной."),
      t("You still need the issuer's signature and a proof that your note is in the last committed tree.", "По-прежнему нужны подпись эмитента и доказательство, что ваша расписка есть в последнем зафиксированном дереве."),
      t("Today only the tracker holds that tree. A wallet should save your proofs while the tracker is online.", "Сейчас это дерево есть только у трекера. Кошельку стоит сохранять ваши доказательства, пока трекер на связи."),
      t("Payments made after the last commit cannot be redeemed on chain: they never reached the tree.", "Платежи после последней фиксации погасить в блокчейне нельзя: они так и не попали в дерево."),
    ],
    tags: ["tracker", "trust"],
    links: [{ label: t("Play: the tracker vanishes", "Сыграть: трекер исчезает"), to: "/play/tracker-vanishes" }],
    sources: ["bt-basis-es", "bt-readme"],
  },
  {
    id: "tracker-censors",
    q: t("What if the tracker censors me?", "Что, если трекер меня цензурирует?"),
    short: t("Then there is no on-chain way to redeem the note it left out. This is the main trust you place in a tracker.", "Тогда расписку, которую он не включил, нельзя погасить через блокчейн. Это главное, в чём вы доверяете трекеру."),
    a: [
      t("Every redemption path checks that your note is in the tracker's committed tree. A note left out, or frozen at an older total, cannot be redeemed beyond what was committed.", "Любой путь погашения проверяет, что ваша расписка есть в зафиксированном дереве трекера. Пропущенную или замороженную на старом итоге расписку нельзя погасить сверх зафиксированного."),
      t("The emergency path does not help. A tracker that keeps posting never opens it, and it still needs your note in the tree.", "Аварийный путь не поможет. Трекер, который продолжает публиковать фиксации, его не открывает, а расписка всё равно должна быть в дереве."),
      t("What you can do: watch the tracker's commits, redeem early, keep your proofs, and prefer trackers you have reason to trust. On-chain protection against censorship is future work.", "Что можно сделать: следить за фиксациями трекера, погашать пораньше, хранить доказательства и выбирать трекеры, которым есть причины доверять. Ончейн-защита от цензуры пока в планах."),
    ],
    tags: ["tracker", "trust"],
    links: [{ label: t("Play: a censoring tracker", "Сыграть: трекер-цензор"), to: "/play/censoring-tracker" }],
    sources: ["bt-readme"],
  },
  {
    id: "lose-money",
    q: t("Can I lose money?", "Могу ли я потерять деньги?"),
    short: t("Yes. A note is a promise; if the issuer cannot or will not pay, or the tracker censors you, you can lose what you are owed.", "Да. Расписка — это обещание: если эмитент не может или не хочет платить или трекер вас цензурирует, долг перед вами может пропасть."),
    a: [
      t("With pure credit there is nothing on chain behind the note.", "При чистом кредите за распиской в блокчейне ничего нет."),
      t("With a reserve you can still be late: other creditors may redeem first, and the issuer can take what is left after a 60-day refund.", "С резервом можно опоздать: другие кредиторы могут погасить раньше, а эмитент — забрать остаток после 60-дневного возврата."),
      t("Software can be wrong. The latest review says the tracker server is not ready for a public launch.", "В программах бывают ошибки. Последнее ревью говорит, что сервер трекера не готов к публичному запуску."),
      t("In the sandbox nothing is real money, so you can try every failure here at no cost.", "В песочнице нет настоящих денег, поэтому здесь можно бесплатно проверить любой сбой."),
    ],
    tags: ["money", "trust"],
    sources: ["bt-readme", "bt-15"],
  },
  {
    id: "nautilus",
    q: t("Why can't Nautilus sign notes?", "Почему Nautilus не может подписывать расписки?"),
    short: t(
      "Ergo wallets sign only transactions, and a note is not a transaction: it is a signature over the debt total in a format wallets don't support yet.",
      "Кошельки Ergo подписывают только транзакции, а расписка — не транзакция: это подпись под суммой долга в формате, который кошельки пока не поддерживают.",
    ),
    a: [
      t("Ergo wallets connect to sites through the EIP-12 standard. It signs transactions and their inputs, not arbitrary messages.", "Кошельки Ergo подключаются к сайтам по стандарту EIP-12. Он подписывает транзакции и их входы, а не произвольные сообщения."),
      t("A note is not a transaction: it is a signature over the debt total in a special format, and wallets don't support it yet. The Signature X-ray shows its bytes.", "Расписка — не транзакция, а подпись под суммой долга в особом формате, и кошельки его пока не поддерживают. Её байты показывает «Рентген подписи»."),
      t("So notes are signed by a key inside the app. In this sandbox that is a play key in your browser.", "Поэтому расписки подписывает ключ внутри приложения. В этой песочнице это игровой ключ в вашем браузере."),
      t("You can top up a reserve with a regular wallet: that is an ordinary transaction.", "Пополнить резерв можно и обычным кошельком: это обычная транзакция."),
    ],
    tags: ["wallet"],
    links: [{ label: t("Signature X-ray", "Рентген подписи"), to: "/learn/signature" }],
    sources: ["bt-spec-schnorr"],
  },
  {
    id: "launched",
    q: t("Can I use real ERG yet?", "Можно ли уже с настоящими ERG?"),
    short: t(
      "Not on this site: its wallet is a sandbox with play money. On Ergo mainnet, ErgoScan's tracker has run in beta since 22 November 2026, and reserves under the current contracts can bind to it. Basis is experimental: use small amounts only.",
      "Не на этом сайте: его кошелёк — песочница с игровыми деньгами. В основной сети Ergo трекер ErgoScan работает в бета-режиме с 22 ноября 2026 года, и к нему можно привязать резервы под текущими контрактами. Basis экспериментальный: используйте только небольшие суммы.",
    ),
    a: [
      t(
        "This site does not move real ERG yet. Its wallet and the sandbox run on play money; the Network and Tracker pages only read Ergo mainnet.",
        "Этот сайт пока не работает с настоящими ERG. Его кошелёк и песочница — на игровых деньгах, а страницы «Сеть» и «Трекер» только читают основную сеть Ergo.",
      ),
      t("ErgoScan's tracker has run on Ergo mainnet in beta since 22 November 2026. Reserves under the contracts reviewed in October 2026 can bind to it; the Network page shows them as the chain and the tracker report them.", "Трекер ErgoScan работает в mainnet Ergo в бета-режиме с 22 ноября 2026 года. К нему можно привязать резервы под контрактами, прошедшими ревью в октябре 2026 года; страница «Сеть» показывает их так, как их видят блокчейн и трекер."),
      t("Older contract versions hold the early test use: 99 reserve boxes (58 unspent, holding 8.995 ERG) and 41 redemptions at the last snapshot.", "Под старыми версиями контракта — ранние тесты: 99 боксов резервов (58 непотраченных, в них 8,995 ERG) и 41 погашение на момент последнего снимка."),
      t("A first community tracker was proposed on 2026-09-30. On 2026-11-19 the author was still fixing review findings.", "Первый трекер сообщества предложили 2026-09-30. На 2026-11-19 автор всё ещё исправлял находки ревью."),
    ],
    tags: ["status"],
    links: [
      { label: t("Open the network", "Открыть сеть"), to: "/network" },
      // CLIENTS_HREF (clients.ts), written out so this file stays light for the ⌘K bar (content.test checks it)
      { label: t("Ready-made programs", "Готовые программы"), to: "/learn/api#clients" },
    ],
    sources: ["bt-15", "f5368-1", "tg-1675", "bt-spec-compiled"],
  },
  {
    id: "refund-wait",
    q: t("What happens when an issuer wants the reserve back?", "Что будет, если эмитент захочет забрать резерв?"),
    short: t("They announce it in R7 and wait 43 200 blocks ≈ 60 days. You can redeem the whole time.", "Он объявляет об этом в R7 и ждёт 43 200 блоков ≈ 60 дней. Всё это время вы можете погашать."),
    a: [
      t("The announcement is a transaction the owner signs. It can be made once and cannot be restarted.", "Объявление — транзакция, которую подписывает владелец. Её можно сделать один раз, перезапустить отсчёт нельзя."),
      t("During the wait, creditors redeem as usual. A good wallet warns you as soon as R7 is set.", "Во время ожидания кредиторы погашают как обычно. Хороший кошелёк предупредит вас, как только появится R7."),
      t("After the wait the owner takes what is left. Until they do, redemptions still work.", "После ожидания владелец забирает остаток. Пока он этого не сделал, погашения работают."),
    ],
    tags: ["money", "trust"],
    links: [{ label: t("Play: the refund race", "Сыграть: гонка с возвратом"), to: "/play/refund-race" }],
    sources: ["bt-basis-es"],
  },
  {
    id: "pass-on",
    q: t("Can I pass a note on to someone else?", "Можно ли передать расписку кому-то другому?"),
    short: t("Not by yourself. A note names both people; moving it takes a new note from the issuer.", "Сами — нет. В расписке указаны оба участника; чтобы её перенести, нужна новая расписка от эмитента."),
    a: [
      copy.noteNotBearer,
      t("With Alice's consent, Bob can pay Carol: Alice signs a note to Carol, and Bob refrains from redeeming that part, because totals never go down.", "С согласия Алисы Боб может расплатиться с Кэрол: Алиса выписывает расписку Кэрол, а Боб не погашает эту часть, ведь итоги не уменьшаются."),
      t("Debt transfer with the creditor's signature is proposed in PR #22, but it is not part of the reference software yet.", "Перевод долга с подписью кредитора предложен в PR #22, но в эталонное ПО пока не вошёл."),
    ],
    tags: ["money"],
    links: [{ label: t("Play: triangle and novation", "Сыграть: треугольник и новация"), to: "/play/triangle-novation" }],
    sources: ["bt-basis-es", "bt-22"],
  },
  {
    id: "this-site",
    q: t("Who made this site? Is it Basis itself?", "Кто сделал этот сайт? Это сам Basis?"),
    short: t("An independent interface by ErgoScan. Better Money Labs did not make or review it.", "Это независимый интерфейс от ErgoScan. Better Money Labs его не делали и не проверяли."),
    a: [
      t("Basis is public-domain (CC0) work by kushti and Better Money Labs. This site reads their contracts and code and runs the protocol in your browser.", "Basis — общественное достояние (CC0), его авторы — kushti и Better Money Labs. Этот сайт читает их контракты и код и запускает протокол в вашем браузере."),
      copy.noEndorsement,
      t("Mainnet data comes from ErgoScan, and links to transactions go to ergoscan.me.", "Данные mainnet берутся из ErgoScan, ссылки на транзакции ведут на ergoscan.me."),
      t("Questions about the protocol belong in the ChainCash & Basis Telegram group or on the Ergo forum.", "Вопросы о протоколе лучше задавать в Telegram-группе ChainCash & Basis или на форуме Ergo."),
    ],
    tags: ["site"],
    sources: ["bt-repo", "tg", "f5153-3"],
  },
  {
    id: "sandbox",
    q: t("Is anything in the sandbox real?", "Есть ли в песочнице что-то настоящее?"),
    short: t("The cryptography is real; the money is not.", "Криптография настоящая, деньги — нет."),
    a: [
      t("Keys, signatures, the 80-byte message and the AVL+ tree are the real algorithms. The contract is checked rule by rule, as Ergo would check it.", "Ключи, подписи, 80-байтное сообщение и AVL+-дерево — настоящие алгоритмы. Контракт проверяется правило за правилом, как это сделал бы Ergo."),
      t("The ERG and tokens are play money in your browser. Nothing is sent to Ergo.", "ERG и токены — игровые деньги в вашем браузере. В Ergo ничего не отправляется."),
      copy.sandboxKey,
    ],
    tags: ["site", "wallet"],
    links: [{ label: t("Open the sandbox", "Открыть песочницу"), to: "/play" }],
    sources: ["bt-basis-es"],
  },
];
