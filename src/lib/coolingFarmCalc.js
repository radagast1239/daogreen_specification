/** Расчёт мощности охлаждения вертикальной фермы — логика из «РАСЧЁТ ОХЛАЖДЕНИЯ ФЕРМА v2.xlsx» */

export const COOLING_FARM_DEFAULTS = {
  length: 5,
  width: 3.5,
  height: 2.48,
  tOut: 25,
  tIn: 20,
  shelves: 10,
  tiers: 5,
  lampW: 40,
  lmPerWIdeal: 683,
  lmPerWLamp: 165,
  lightHours: 16,
  waterDaily: 100,
  drainPct: 90,
  transpirationPct: 60,
  vaporizationJ: 2450,
  heaterW: 0,
  heaterEff: 0,
  uWall: 0.3,
  uRoof: 0.2,
  uFloor: 0,
  glassArea: 0,
  uGlass: 0,
  insolGlassArea: 0,
  insolIntensity: 0,
  insolShade: 0,
  insolOrient: 0,
  insolRoofShare: 0,
  staff: 1,
  staffW: 120,
  equipW: 0,
  equipEff: 0.85,
  airExchange: 12,
  airDensity: 1.2,
  airCp: 1005,
  recuperation: 0,
  infiltrationPct: 8,
  nightVentPct: 30,
  dehumidPct: 40,
  dehumidCop: 2.5,
  safetyFactor: 1.1,
  cop: 3.2,
  tariff: 6,
  dayHours: 16,
  invCost: 85000,
  nonInvCost: 45000,
  nonInvCop: 2.5,
  installCost: 95000,
  lossWithoutAc: 150000,
};

const BTU = 3412.14;

function pickStandardBtu(btu) {
  const steps = [9000, 12000, 18000, 24000, 36000, 48000, 60000];
  for (const s of steps) if (btu <= s) return s;
  return 60000;
}

export function computeCoolingFarm(raw = {}) {
  const i = { ...COOLING_FARM_DEFAULTS, ...raw };
  const n = (v, d = 0) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : d;
  };

  const length = n(i.length);
  const width = n(i.width);
  const height = n(i.height);
  const tOut = n(i.tOut);
  const tIn = n(i.tIn);
  const floorArea = length * width;
  const volume = floorArea * height;
  const deltaT = tOut - tIn;

  const lampTotalW = n(i.shelves) * n(i.tiers) * n(i.lampW);
  const etaLight = n(i.lmPerWLamp) / n(i.lmPerWIdeal, 1);
  const etaHeat = 1 - etaLight;
  const lampHeatW = lampTotalW * etaHeat;
  const lampHeatKw = lampHeatW / 1000;
  const lampBtu = lampHeatKw * BTU;

  const waterNet = n(i.waterDaily) * (1 - n(i.drainPct) / 100);
  const waterTransp = waterNet * (n(i.transpirationPct) / 100);
  const transpW = (waterTransp * 1000 * n(i.vaporizationJ)) / 86400;
  const rootsW = n(i.heaterW) * n(i.heaterEff);
  const plantsBtu = ((transpW + rootsW) / 1000) * BTU;

  const wallArea = 2 * (length + width) * height;
  const roofArea = floorArea;
  const envelopeW =
    (wallArea * n(i.uWall) +
      roofArea * n(i.uRoof) +
      floorArea * n(i.uFloor) +
      n(i.glassArea) * n(i.uGlass)) *
    deltaT;
  const envelopeBtu = (envelopeW / 1000) * BTU;

  const insolBtu =
    ((n(i.insolGlassArea) * n(i.insolIntensity) * n(i.insolShade) * n(i.insolOrient) +
      roofArea * n(i.insolIntensity) * n(i.insolRoofShare) * n(i.insolShade)) /
      1000) *
    BTU;

  const peopleBtu = ((n(i.staff) * n(i.staffW) + n(i.equipW) * n(i.equipEff)) / 1000) * BTU;

  const ventW =
    (n(i.airExchange) * volume * n(i.airDensity) * n(i.airCp) * deltaT * (1 - n(i.recuperation))) /
    3600;
  const ventBtu = (ventW / 1000) * BTU * (1 + n(i.infiltrationPct) / 100);

  const nightHours = 24 - n(i.lightHours);
  const nightLoadBtu = envelopeBtu + insolBtu + peopleBtu + ventBtu * (n(i.nightVentPct) / 100);
  const nightLoadKw = nightLoadBtu / BTU;

  const totalBtu = lampBtu + plantsBtu + envelopeBtu + insolBtu + peopleBtu + ventBtu;
  const totalKw = totalBtu / BTU;
  const totalKwSafety = totalKw * n(i.safetyFactor);
  const elecKw = totalKwSafety / n(i.cop, 1);
  const modelBtu = totalKwSafety * BTU;
  const standardBtu = pickStandardBtu(modelBtu);

  const dehumidKw = (n(i.safetyFactor) * n(i.dehumidPct)) / 100;
  const dehumidElec = dehumidKw / n(i.dehumidCop, 1);

  const dayKwh = elecKw * n(i.dayHours);
  const nightKwh = dehumidElec * nightHours;
  const dailyKwh = dayKwh + nightKwh;
  const dailyCost = dailyKwh * n(i.tariff);
  const monthlyCost = dailyCost * 30;
  const yearlyCost = dailyCost * 365;

  const yearlyHours = n(i.dayHours) * 365 + nightHours * 365;
  const invYearKwh = elecKw * yearlyHours;
  const nonInvYearKwh = (totalKwSafety / n(i.nonInvCop, 1)) * yearlyHours;
  const invYearCost = invYearKwh * n(i.tariff);
  const nonInvYearCost = nonInvYearKwh * n(i.tariff);
  const invSavings = nonInvYearCost - invYearCost;
  const invPayback = invSavings > 0 ? (n(i.invCost) - n(i.nonInvCost)) / invSavings : 999;
  const acPayback = n(i.lossWithoutAc) > 0 ? n(i.installCost) / n(i.lossWithoutAc) : 999;

  return {
    ...i,
    floorArea,
    volume,
    deltaT,
    etaLight,
    etaHeat,
    lampTotalW,
    lampHeatW,
    lampHeatKw,
    lampBtu,
    waterNet,
    waterTransp,
    transpW,
    rootsW,
    plantsBtu,
    wallArea,
    roofArea,
    envelopeW,
    envelopeBtu,
    insolBtu,
    peopleBtu,
    ventW,
    ventBtu,
    nightHours,
    nightLoadBtu,
    nightLoadKw,
    totalBtu,
    totalKw,
    totalKwSafety,
    elecKw,
    modelBtu,
    standardBtu,
    dehumidKw,
    dehumidElec,
    dayKwh,
    nightKwh,
    dailyKwh,
    dailyCost,
    monthlyCost,
    yearlyCost,
    yearlyHours,
    invYearCost,
    nonInvYearCost,
    invSavings,
    invPayback,
    acPayback,
  };
}

export const COOLING_FARM_SECTIONS = [
  {
    title: "1. Параметры помещения",
    rows: [
      { key: "length", label: "Длина помещения", unit: "м", input: true },
      { key: "width", label: "Ширина помещения", unit: "м", input: true },
      { key: "height", label: "Высота помещения", unit: "м", input: true },
      { key: "tOut", label: "Температура снаружи (лето)", unit: "°C", input: true },
      { key: "tIn", label: "Целевая температура внутри", unit: "°C", input: true },
      { key: "floorArea", label: "Площадь пола", unit: "м²" },
      { key: "volume", label: "Объём помещения", unit: "м³" },
      { key: "deltaT", label: "ΔT (лето)", unit: "°C" },
    ],
  },
  {
    title: "2. Тепловыделение фитоламп",
    rows: [
      { key: "shelves", label: "Количество стеллажей", unit: "шт", input: true },
      { key: "tiers", label: "Ярусов на стеллаже", unit: "шт", input: true },
      { key: "lampW", label: "Мощность ламп на ярус", unit: "Вт", input: true },
      { key: "lmPerWIdeal", label: "Световая отдача идеала", unit: "лм/Вт", input: true },
      { key: "lmPerWLamp", label: "Отдача светильника", unit: "лм/Вт", input: true },
      { key: "lightHours", label: "Световой день", unit: "ч/сут", input: true },
      { key: "etaLight", label: "КПД светового потока", unit: "—", pct: true },
      { key: "etaHeat", label: "КПД тепловыделения", unit: "—", pct: true },
      { key: "lampTotalW", label: "Суммарная мощность ламп", unit: "Вт" },
      { key: "lampHeatW", label: "Тепло от ламп", unit: "Вт" },
      { key: "lampHeatKw", label: "Тепло от ламп", unit: "кВт" },
      { key: "lampBtu", label: "Тепло от ламп", unit: "BTU/ч" },
    ],
  },
  {
    title: "3. Тепло от растений",
    rows: [
      { key: "waterDaily", label: "Объём полива в сутки", unit: "л/сут", input: true },
      { key: "drainPct", label: "Дренаж", unit: "%", input: true },
      { key: "transpirationPct", label: "Транспирация", unit: "%", input: true },
      { key: "vaporizationJ", label: "Теплота парообразования", unit: "Дж/г", input: true },
      { key: "heaterW", label: "Подогрев раствора", unit: "Вт", input: true },
      { key: "heaterEff", label: "КПД нагревателя", unit: "—", input: true },
      { key: "waterNet", label: "Вода без дренажа", unit: "л/сут" },
      { key: "waterTransp", label: "Вода на транспирацию", unit: "л/сут" },
      { key: "transpW", label: "Нагрузка транспирации", unit: "Вт" },
      { key: "plantsBtu", label: "Суммарно", unit: "BTU/ч" },
    ],
  },
  {
    title: "4. Ограждающие конструкции",
    rows: [
      { key: "wallArea", label: "Площадь стен", unit: "м²" },
      { key: "roofArea", label: "Площадь кровли", unit: "м²" },
      { key: "uWall", label: "U стен", unit: "Вт/(м²·К)", input: true },
      { key: "uRoof", label: "U кровли", unit: "Вт/(м²·К)", input: true },
      { key: "uFloor", label: "U пола", unit: "Вт/(м²·К)", input: true },
      { key: "glassArea", label: "Остекление/двери", unit: "м²", input: true },
      { key: "uGlass", label: "U остекления", unit: "Вт/(м²·К)", input: true },
      { key: "envelopeW", label: "Теплоприток", unit: "Вт" },
      { key: "envelopeBtu", label: "Теплоприток", unit: "BTU/ч" },
    ],
  },
  {
    title: "5. Инсоляция",
    rows: [
      { key: "insolGlassArea", label: "Остекление (юг/восток)", unit: "м²", input: true },
      { key: "insolIntensity", label: "Солнечная радиация", unit: "Вт/м²", input: true },
      { key: "insolShade", label: "Коэф. затенения", unit: "—", input: true },
      { key: "insolOrient", label: "Коэф. ориентации", unit: "—", input: true },
      { key: "insolRoofShare", label: "Доля кровли", unit: "—", input: true },
      { key: "insolBtu", label: "Теплоприток", unit: "BTU/ч" },
    ],
  },
  {
    title: "6. Люди и оборудование",
    rows: [
      { key: "staff", label: "Персонал", unit: "чел", input: true },
      { key: "staffW", label: "Тепло на человека", unit: "Вт/чел", input: true },
      { key: "equipW", label: "Прочее оборудование", unit: "Вт", input: true },
      { key: "equipEff", label: "КПД → тепло", unit: "—", input: true },
      { key: "peopleBtu", label: "Суммарно", unit: "BTU/ч" },
    ],
  },
  {
    title: "7. Вентиляция",
    rows: [
      { key: "airExchange", label: "Кратность воздухообмена", unit: "1/ч", input: true },
      { key: "airDensity", label: "Плотность воздуха", unit: "кг/м³", input: true },
      { key: "airCp", label: "Теплоёмкость", unit: "Дж/(кг·К)", input: true },
      { key: "recuperation", label: "Рекуперация", unit: "—", input: true },
      { key: "infiltrationPct", label: "Инфильтрация", unit: "%", input: true },
      { key: "ventW", label: "Теплонагрузка", unit: "Вт" },
      { key: "ventBtu", label: "Суммарно", unit: "BTU/ч" },
    ],
  },
  {
    title: "8–10. Итог — подбор сплит-системы",
    highlight: true,
    rows: [
      { key: "nightVentPct", label: "Ночная вентиляция", unit: "%", input: true },
      { key: "nightLoadBtu", label: "Ночная нагрузка", unit: "BTU/ч" },
      { key: "nightLoadKw", label: "Ночная нагрузка", unit: "кВт" },
      { key: "safetyFactor", label: "Запасной коэфф.", unit: "—", input: true },
      { key: "cop", label: "COP кондиционера", unit: "—", input: true },
      { key: "totalBtu", label: "Нагрузка без запаса", unit: "BTU/ч" },
      { key: "totalKw", label: "Нагрузка без запаса", unit: "кВт" },
      { key: "totalKwSafety", label: "С запасом", unit: "кВт (хол)", result: true },
      { key: "elecKw", label: "Электропотребление", unit: "кВт (эл)", result: true },
      { key: "modelBtu", label: "Расчёт BTU/ч", unit: "BTU/ч", result: true },
      { key: "standardBtu", label: "Модель сплита", unit: "BTU", result: true },
    ],
  },
];

export function seasonalCooling(calc, seasons) {
  const envFactor =
    (calc.wallArea * calc.uWall +
      calc.roofArea * calc.uRoof +
      calc.floorArea * calc.uFloor +
      calc.glassArea * calc.uGlass) /
    1000 /
    BTU;
  return seasons.map((s) => {
    const dT = s.tOut - s.tIn;
    const envelope = envFactor * dT * BTU;
    const insol = calc.insolBtu * (s.insolMul ?? 1);
    const total = envelope + insol + calc.lampBtu + calc.plantsBtu + calc.ventBtu * (dT / (calc.deltaT || 1));
    return { ...s, dT, envelope, insol, total, totalKw: total / BTU };
  });
}

export const COOLING_SEASONS_DEFAULT = [
  { id: "summer", label: "Лето", tOut: 35, tIn: 22, insolMul: 1 },
  { id: "autumn", label: "Осень", tOut: 10, tIn: 22, insolMul: 1 },
  { id: "winter", label: "Зима", tOut: -20, tIn: 22, insolMul: 0.3 },
  { id: "spring", label: "Весна", tOut: 5, tIn: 22, insolMul: 0.3 },
];
