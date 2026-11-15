// Единые демо-данные для дизайн-вариантов карточек и PDF (условные, для показа
// оформления; адрес реальный из теста заказчика, суммы — синтетика).
// ВАЖНО: помечено DEMO во всех артефактах, чтобы не путать с реальным отчётом.

export const DEMO = {
  address: 'TK2xgkMBsUp6Hk1R5PjLQUb7mZaASw3AiB',
  chain: 'TRON',
  provider: 'TronGrid',
  demoDays: 14,
  verdict: { score: 46, level: 'medium', levelRu: 'СРЕДНИЙ' },
  riskScore: 60,
  kpi: [
    { label: 'ПОЛУЧЕНО', value: '812 400 $', sub: '42 операции', tone: 'ok' },
    { label: 'ОТПРАВЛЕНО', value: '806 100 $', sub: '517 операций', tone: 'bad' },
    { label: 'ОСЕЛО НА АДРЕСЕ', value: '0,8%', sub: 'от всего входящего', tone: 'muted' },
    { label: 'КОНТРАГЕНТОВ', value: '431', sub: '18 отпр. / 413 получ.', tone: 'muted' },
    { label: 'ОБОРОТ', value: '1,62 млн $', sub: 'сумма всех движений', tone: 'muted' },
    { label: 'СРЕДНИЙ ПЕРЕВОД', value: '3 108 $', sub: 'медиана 120 $', tone: 'muted' },
    { label: 'КРУПНЕЙШИЙ ПЕРЕВОД', value: '85 000 $', sub: 'USDT · 09.11.2026', tone: 'info' },
    { label: 'АКТИВНЫХ ДНЕЙ', value: '14', sub: 'адресу 14 дней', tone: 'muted' },
  ],
  findings: [
    {
      severity: 'red',
      title: 'Свежий адрес с большим оборотом',
      detail: 'Адрес создан 14 дн. назад, оборот уже 1,62 млн $ — типично для транзитных кошельков',
      rows: [],
    },
    {
      severity: 'yellow',
      title: 'Веерная рассылка (fan-out)',
      detail: '413 получателей против 18 отправителей — массовые выплаты',
      rows: [
        { addr: 'TUeapnPq…7aSiwE', dir: 'out', amount: '190 000 $', n: 3 },
        { addr: 'TXeLzi1A…ZJeWAU', dir: 'out', amount: '191 416 $', n: 7 },
        { addr: 'TU4vEruv…r7Pvaa', dir: 'out', amount: '26 408 $', n: 1 },
      ],
    },
    {
      severity: 'yellow',
      title: 'Нулевой остаток при обороте',
      detail: 'Оседает 0,8% входящего — кошелёк не для хранения',
      rows: [],
    },
    {
      severity: 'blue',
      title: 'Машинный ритм операций',
      detail: 'Интервалы регулярны (CV=3,93, модальный интервал 0 мин) — работает скрипт',
      rows: [],
    },
    {
      severity: 'gray',
      title: 'Прямой выход на биржи',
      detail: '1 биржевой контрагент — точка KYC-деанонимизации',
      rows: [{ addr: 'TLgjqHKE…dyxkPP', dir: 'out', amount: '33,9 $', n: 1, tag: 'Heleket Hot Wallet 3' }],
    },
  ],
  profile: {
    title: 'Раздающий кошелёк (fan-out)',
    confidence: 'high',
    bars: [
      { name: 'Раздача', v: 60 },
      { name: 'Автомат', v: 50 },
      { name: 'Биржа/сервис', v: 47 },
      { name: 'Транзит', v: 46 },
      { name: 'Личный', v: 15 },
    ],
  },
  transit: {
    pct: 53, matched: 16, of: 30, medianMin: 150, medianNote: '28% быстрее часа',
    rows: [
      { delay: '1 209 мин', in: '34 640', out: '32 562', to: 'TL5aEjyk…Mn1X4' },
      { delay: '932 мин', in: '20,46', out: '20,31', to: 'TT1YT6dm…erWkhm' },
      { delay: '229 мин', in: '355,6', out: '316,78', to: 'TNuJfWZT…rCSNoi' },
      { delay: '158 мин', in: '60,99', out: '55,3', to: 'TWUUPkiP…2YWwzp' },
    ],
  },
  // AML в формате Quppy-примеров заказчика: Exposure-вердикт + разбор
  // происхождения средств по категориям (доля объёма входящих, %).
  aml: {
    exposure: 'MEDIUM', exposureRu: 'СРЕДНИЙ',
    source: 'доля объёма входящих средств по типам источников · как в Quppy-примерах',
    categories: [
      { ru: 'Биржи', pct: 88.78, tone: 'blue' },
      { ru: 'Пыль (dust)', pct: 3.86, tone: 'gray' },
      { ru: 'Биржи повыш. риска', pct: 2.34, tone: 'bad' },
      { ru: 'Принудит. изъятия (enforcement)', pct: 2.02, tone: 'bad' },
      { ru: 'Неименов. сервисы', pct: 0.62, tone: 'gray' },
      { ru: 'Кастодиальные кошельки', pct: 0.59, tone: 'gray' },
      { ru: 'Санкции', pct: 0.56, tone: 'bad' },
      { ru: 'Мосты', pct: 0.39, tone: 'gray' },
      { ru: 'Гемблинг', pct: 0.28, tone: 'gray' },
      { ru: 'Платёж. сервисы', pct: 0.15, tone: 'gray' },
      { ru: 'Прочее', pct: 0.12, tone: 'gray' },
      { ru: 'DEX', pct: 0.11, tone: 'gray' },
      { ru: 'Смарт-контракты', pct: 0.06, tone: 'gray' },
      { ru: 'Террофинансирование', pct: 0.05, tone: 'bad' },
      { ru: 'Лендинг', pct: 0.03, tone: 'gray' },
      { ru: 'Риск-юрисдикции', pct: 0.03, tone: 'bad' },
      { ru: 'P2P-обменники', pct: 0.01, tone: 'gray' },
    ],
  },
  riskLevels: [
    { name: 'No Risk', ru: 'Чисто', note: 'средства полностью легитимны' },
    { name: 'Low Risk', ru: 'Низкий', note: 'безопасно, минимальные индикаторы' },
    { name: 'Medium Risk', ru: 'Средний', note: 'с 50% — повышенный контроль, возможны блокировки на биржах' },
    { name: 'High Risk', ru: 'Высокий', note: 'высокая вероятность блокировки транзакций' },
    { name: 'Severe Risk', ru: 'Критический', note: 'немедленная блокировка, связь с тяжкими активностями' },
  ],
  leaks: [
    { addr: 'TUeapnPq…7aSiwE', amount: '665,92 тыс $', share: 73, label: 'частный кошелёк' },
    { addr: 'TXeLzi1A…ZJeWAU', amount: '245,11 тыс $', share: 27, label: 'частный кошелёк' },
  ],
  spark: [3, 8, 5, 12, 9, 22, 18, 31, 26, 44, 38, 57, 49, 66], // операций за 14 дней
  disclaimer: 'Ares Crypto-Analytics · ДЕМО-данные для выбора оформления · публичные блокчейны · вероятностные оценки · не финансовый совет',
};
