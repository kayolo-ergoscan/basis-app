// Long kit copy (EN / RU): the lights board and the never / instead list.
export const MATERIALS = {
  en: [
    ["Ink", "Words, numbers, structure. Every amount is ink first.", "Never decorative. Hairlines, not boxes.", "--ink · --ink-2 · --ink-3"],
    ["Paper", "Notes and seals are lit paper in both themes — the things you hold.", "Never for chrome, panels or buttons.", "--paper · seal discs · note face"],
    ["Unlit", "A promise resting on trust: credit, unbacked share, limits.", "Never for value locked on Ergo.", "hatch 135° · 1 px / 4.5 px · outline"],
    ["Gold light", "Backing on Ergo: reserves, ERG, tokens, redemption.", "Never the mark, a generic button or the town.", "--metal · --foil-metal · --glow-metal"],
    ["Moonlight", "Proof: this exact total is in the tracker's latest digest.", "Never on anything unproven. Stale → grey.", "--holo · --moon · --holo-stale"],
    ["Window light", "The town and you: the mark, your house, steps done, the main key.", "Never money: no amounts, no reserves.", "--lamp · --glow-lamp · --key-bg"],
  ],
  ru: [
    ["Чернила", "Слова, числа, структура. Любая сумма — сначала чернила.", "Никогда не для украшения. Тонкие линии, а не рамки.", "--ink · --ink-2 · --ink-3"],
    ["Бумага", "Расписки и печати — освещённая бумага в обеих темах, вещи в руках.", "Никогда не для панелей и кнопок.", "--paper · диски печатей · лицо расписки"],
    ["Без света", "Обещание на доверии: кредит, необеспеченная доля, лимиты.", "Никогда для того, что заблокировано в Ergo.", "штриховка 135° · 1 px / 4.5 px · контур"],
    ["Золотой свет", "Обеспечение в Ergo: резервы, ERG, токены, погашение.", "Никогда для знака, обычной кнопки или города.", "--metal · --foil-metal · --glow-metal"],
    ["Лунный свет", "Доказательство: этот итог есть в последнем дайджесте трекера.", "Никогда на недоказанном. Устарело → серое.", "--holo · --moon · --holo-stale"],
    ["Свет в окнах", "Город и вы: знак, ваш дом, пройденные шаги, главная кнопка.", "Никогда не деньги: ни сумм, ни резервов.", "--lamp · --glow-lamp · --key-bg"],
  ],
} as const;

export const NEVER = {
  en: [
    ["Orange anywhere (ErgoScan's colour on the same host).", "Ink, paper and the three lights; gold stays a yellow gold."],
    ["Gold on a generic button, the mark, the town or a border.", "Gold only where ERG or tokens are locked or move."],
    ["Foil or holo on a note that is not in the latest digest.", "Grey foil plus “not yet in a digest”."],
    ["“Send”, “transfer”, coins flying between wallets.", "“Raise your note to Bob to 1 240.00.”"],
    ["Red for “you owe”.", "Words and a minus sign; red only when something is wrong."],
    ["A banknote you could hand to someone else.", "Both names on every note; the seal is the pair."],
    ["Loops that pulse for no reason; town lights that flicker.", "One commitment = one pulse of moonlight. Silence is a state."],
    ["“Trustless”, “guaranteed”, “safe”, “unstoppable”.", "“Cannot steal · Can censor”, next to every tracker."],
    ["The display face in body text or below 13 px.", "Geist for every small number, label and sentence."],
    ["A 3D graph, a hairball, or a pie chart for coverage.", "A 2D graph with arrows, labels and tubes; a linear meter."],
    ["Glass, blur or neon on cards and notes.", "Lit panes: a flat fill, a 1 px rule, one soft top highlight."],
    ["A seal shown as proof of identity.", "Seal + fingerprint + three words; proof is the signature and digest."],
    ["U+202F or a regular space inside numbers.", "U+2009 + U+2060; units after U+00A0."],
    ["A fee the contract does not have.", "“Protocol fee: none (basis.es)”."],
    ["More than one gold key or one alarm toast per view.", "Pick the one action that moves money."],
    ["Emoji, exclamation marks, rocket energy.", "Calm sentences."],
  ],
  ru: [
    ["Оранжевый где угодно (цвет ErgoScan на том же сервере).", "Чернила, бумага и три огня; золото остаётся жёлтым золотом."],
    ["Золото на обычной кнопке, знаке, в городе или на рамке.", "Золото — только там, где ERG или токены заблокированы или движутся."],
    ["Фольга или голограмма на расписке, которой нет в последнем дайджесте.", "Серая фольга и «ещё не в дайджесте»."],
    ["«Отправить», «перевести», монеты летят между кошельками.", "«Увеличьте расписку Bob до 1 240.00.»"],
    ["Красный для «вы должны».", "Слова и знак минус; красный — только когда что-то не так."],
    ["Банкнота, которую можно отдать другому.", "Оба имени на каждой расписке; печать — это пара."],
    ["Анимации, которые пульсируют без причины; мигающие огни города.", "Одна фиксация — одна вспышка лунного света. Тишина — тоже состояние."],
    ["«Без доверия», «гарантировано», «безопасно», «неостановимо».", "«Не может украсть · Может цензурировать» рядом с каждым трекером."],
    ["Дисплейный шрифт в основном тексте или мельче 13 px.", "Geist для всех мелких чисел, подписей и фраз."],
    ["3D-граф, клубок связей или круговая диаграмма для покрытия.", "2D-граф со стрелками, подписями и трубками; линейная шкала."],
    ["Стекло, размытие или неон на карточках и расписках.", "Освещённые панели: ровная заливка, линия 1 px, мягкий блик сверху."],
    ["Печать как доказательство личности.", "Печать + отпечаток + три слова; доказательство — подпись и дайджест."],
    ["U+202F или обычный пробел внутри чисел.", "U+2009 + U+2060; единицы после U+00A0."],
    ["Комиссия, которой нет в контракте.", "«Комиссия протокола: нет (basis.es)»."],
    ["Больше одной золотой кнопки или одного тревожного уведомления на экране.", "Выберите одно действие, которое двигает деньги."],
    ["Эмодзи, восклицательные знаки, «ракетная» энергия.", "Спокойные фразы."],
  ],
} as const;

/** Night and Day surfaces (documentation copy of tokens.css §1). */
export const PALETTE = {
  night: [["bg", "#0A0E1B"], ["surface", "#121935"], ["surface-2", "#18203F"], ["well", "#0F1530"], ["rule", "#222C52"], ["rule-2", "#33407A"], ["ink-3", "#8E97B8"], ["ink-2", "#B9BFD6"], ["ink", "#EEF0F8"]],
  cotton: [["bg", "#F3F2EE"], ["surface", "#FFFFFF"], ["surface-2", "#F7F6F2"], ["well", "#EEEDF3"], ["rule", "#DEDDE6"], ["rule-2", "#C6C6D6"], ["ink-3", "#5A6280"], ["ink-2", "#434A66"], ["ink", "#151A33"]],
  meaning: ["paper", "metal", "metal-ink", "lamp", "up", "alarm", "alarm-fill", "holo", "holo-stale", "paper-ink"],
} as const;
