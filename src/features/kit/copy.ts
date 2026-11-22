// Long kit copy (EN / RU): materials board and the never / instead list (VISUAL §2, §16).
export const MATERIALS = {
  en: [
    ["Ink", "Words, numbers, structure. Every amount is ink first.", "Never decorative. Hairlines, not boxes.", "--ink · --ink-2 · --ink-3"],
    ["Paper", "Notes and seals are paper in both themes — real objects you hold.", "Never for chrome, panels or buttons.", "--paper · seal discs · note face"],
    ["Line", "A promise resting on trust: credit, unbacked share, limits.", "Never for value locked on Ergo.", "hatch 135° · 1 px / 4.5 px"],
    ["Metal", "Backing on Ergo: reserves, ERG, tokens, redemption.", "Never the brand colour or a generic CTA.", "--metal · --foil-metal"],
    ["Light", "Proof: this exact total is in the tracker's latest digest.", "Never on anything unproven. Stale → grey.", "--holo · --holo-stale"],
  ],
  ru: [
    ["Чернила", "Слова, числа, структура. Любая сумма — сначала чернила.", "Никогда не для украшения. Тонкие линии, а не рамки.", "--ink · --ink-2 · --ink-3"],
    ["Бумага", "Расписки и печати — бумага в обеих темах, настоящие вещи в руках.", "Никогда не для панелей и кнопок.", "--paper · диски печатей · лицо расписки"],
    ["Линия", "Обещание на доверии: кредит, необеспеченная доля, лимиты.", "Никогда для того, что заблокировано в Ergo.", "штриховка 135° · 1 px / 4.5 px"],
    ["Металл", "Обеспечение в Ergo: резервы, ERG, токены, погашение.", "Никогда как цвет бренда или обычная кнопка.", "--metal · --foil-metal"],
    ["Свет", "Доказательство: этот итог есть в последнем дайджесте трекера.", "Никогда на недоказанном. Устарело → серое.", "--holo · --holo-stale"],
  ],
} as const;

export const NEVER = {
  en: [
    ["Orange anywhere (ErgoScan's colour on the same host).", "Ink, paper, line, metal, light."],
    ["Gold on a generic button, the logo or a border.", "Metal only where ERG or tokens are locked or move."],
    ["Foil or holo on a note that is not in the latest digest.", "Grey foil plus “not yet in a digest”."],
    ["“Send”, “transfer”, coins flying between wallets.", "“Raise your note to Bob to 1 240.00.”"],
    ["Red for “you owe”.", "Words and a minus sign; red only when something is wrong."],
    ["A banknote you could hand to someone else.", "Both names on every note; the seal is the pair."],
    ["Loops that pulse for no reason.", "One commitment = one pulse. Silence is a state."],
    ["“Trustless”, “guaranteed”, “safe”, “unstoppable”.", "“Cannot steal · Can censor”, next to every tracker."],
    ["Serif below 24 px in UI; a line screen below 96 px.", "Geist for every small number and label."],
    ["A 3D graph, a hairball, or a pie chart for coverage.", "A 2D graph with arrows, labels and tubes; a linear meter."],
    ["Glass on cards or notes; gradients on panels.", "Flat surfaces, 1 px rules."],
    ["A seal shown as proof of identity.", "Seal + fingerprint + three words; proof is the signature and digest."],
    ["U+202F or a regular space inside numbers.", "U+2009 + U+2060; units after U+00A0."],
    ["A fee the contract does not have.", "“Protocol fee: none (basis.es)”."],
    ["More than one metal key or one alarm toast per view.", "Pick the one action that moves money."],
    ["Emoji, exclamation marks, rocket energy.", "Calm sentences."],
  ],
  ru: [
    ["Оранжевый где угодно (цвет ErgoScan на том же сервере).", "Чернила, бумага, линия, металл, свет."],
    ["Золото на обычной кнопке, логотипе или рамке.", "Металл — только там, где ERG или токены заблокированы или движутся."],
    ["Фольга или голограмма на расписке, которой нет в последнем дайджесте.", "Серая фольга и «ещё не в дайджесте»."],
    ["«Отправить», «перевести», монеты летят между кошельками.", "«Увеличьте расписку Bob до 1 240.00.»"],
    ["Красный для «вы должны».", "Слова и знак минус; красный — только когда что-то не так."],
    ["Банкнота, которую можно отдать другому.", "Оба имени на каждой расписке; печать — это пара."],
    ["Анимации, которые пульсируют без причины.", "Одна фиксация — один импульс. Тишина — тоже состояние."],
    ["«Без доверия», «гарантировано», «безопасно», «неостановимо».", "«Не может украсть · Может цензурировать» рядом с каждым трекером."],
    ["Антиква мельче 24 px в интерфейсе; гравировка мельче 96 px.", "Geist для всех мелких чисел и подписей."],
    ["3D-граф, клубок связей или круговая диаграмма для покрытия.", "2D-граф со стрелками, подписями и трубками; линейная шкала."],
    ["Стекло на карточках и расписках; градиенты на панелях.", "Плоские поверхности, линии в 1 px."],
    ["Печать как доказательство личности.", "Печать + отпечаток + три слова; доказательство — подпись и дайджест."],
    ["U+202F или обычный пробел внутри чисел.", "U+2009 + U+2060; единицы после U+00A0."],
    ["Комиссия, которой нет в контракте.", "«Комиссия протокола: нет (basis.es)»."],
    ["Больше одной металлической кнопки или одного тревожного уведомления на экране.", "Выберите одно действие, которое двигает деньги."],
    ["Эмодзи, восклицательные знаки, «ракетная» энергия.", "Спокойные фразы."],
  ],
} as const;

/** Night and Cotton surfaces (documentation copy of tokens.css §1). */
export const PALETTE = {
  night: [["bg", "#0B0B0C"], ["surface", "#141416"], ["surface-2", "#1A1A1D"], ["well", "#202024"], ["rule", "#2A2A2E"], ["rule-2", "#3B3B40"], ["ink-3", "#96938B"], ["ink-2", "#BDB9AF"], ["ink", "#F2EEE5"]],
  cotton: [["bg", "#F2EFE8"], ["surface", "#FBFAF7"], ["surface-2", "#F6F4EE"], ["well", "#E7E3D9"], ["rule", "#DCD7CB"], ["rule-2", "#C7C1B3"], ["ink-3", "#626267"], ["ink-2", "#46464B"], ["ink", "#131315"]],
  meaning: ["paper", "metal", "metal-ink", "up", "alarm", "alarm-fill", "holo", "holo-stale", "paper-ink"],
} as const;
