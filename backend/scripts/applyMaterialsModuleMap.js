#!/usr/bin/env node
/**
 * Перепривязка модулей материалов по финальной карте.
 *
 * Usage:
 *   node scripts/applyMaterialsModuleMap.js [--dry-run] [--apply]
 *   npm run apply:materials-modules -- --dry-run
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { normalizeMaterialModules, patchMaterialModules, resolveMaterialModules } from "../../shared/materialModules.js";
import { initDb, db, getDbPath, rowToMaterial } from "../src/db.js";
import {
  listModulesAdmin,
  createModule,
  updateModule,
  archiveModule,
  restoreModule,
} from "../src/routes/materials.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dryRun = !args.includes("--apply");

/** Финальный список активных модулей */
const FINAL_ACTIVE_MODULES = [
  "Автоматика и датчики",
  "Водоподготовка",
  "Климат и вентиляция",
  "Манипуляционная зона",
  "Насосная группа и обвязка",
  "Общая закупка на ферму",
  "Общая магистраль полива и дренажа",
  "Освещение стеллажей",
  "Работы, услуги и доставка",
  "Рассадное отделение подтопление",
  "Расходники запуска",
  "Инструмент и инвентарь",
  "Стеллаж аэропоника",
  "Стеллаж клубника / ягода",
  "Стеллаж подтопление",
  "Стеллаж проточка / NFT 200×100 широкий",
  "Стеллаж проточка / NFT 200×74 узкий",
  "Электрика и щит",
];

/** Переименование существующих модулей (старое имя → новое) */
const MODULE_RENAMES = [
  ["Автоматика", "Автоматика и датчики"],
  ["Электрика", "Электрика и щит"],
  ["Освещение", "Освещение стеллажей"],
  ["Обвязка насосной станции", "Насосная группа и обвязка"],
  ["Расходники", "Расходники запуска"],
  ["Стеллаж клубника", "Стеллаж клубника / ягода"],
  ["Стеллаж периодическое подтопление", "Стеллаж подтопление"],
  ["Стеллаж проточка 200\\100\\N мм широкий", "Стеллаж проточка / NFT 200×100 широкий"],
  ["Стеллаж проточка 200\\740\\N мм узкий", "Стеллаж проточка / NFT 200×74 узкий"],
  ["Стеллаж проточка / NFT 200×100, широкий", "Стеллаж проточка / NFT 200×100 широкий"],
  ["Стеллаж проточка / NFT 200×74, узкий", "Стеллаж проточка / NFT 200×74 узкий"],
  ["Монтажные работы и запуск", "Работы, услуги и доставка"],
];

/** Новые модули (если переименование не покрывает) */
const MODULE_CREATES = [
  {
    id: "mod_magistral",
    name: "Общая магистраль полива и дренажа",
    type: "general",
    tech: "",
    section: "Общая магистраль полива и дренажа",
    farmSectionId: "",
  },
  {
    id: "tools_inventory",
    name: "Инструмент и инвентарь",
    type: "general",
    tech: "",
    section: "Инструмент и инвентарь",
    farmSectionId: "tools",
  },
  {
    id: "mod_works_delivery",
    name: "Работы, услуги и доставка",
    type: "general",
    tech: "",
    section: "Работы, услуги и доставка",
    farmSectionId: "works_delivery",
  },
];

/** Явно архивируемые модули */
const MODULE_ARCHIVE_NAMES = [
  "Кабель",
  "Полив",
  "Полив/дренаж подтопление",
  "Полив/дренаж проточка",
  "Климат, вентиляция, автоматика",
  "Охлаждение",
  "Каркас и крепеж",
  "Каркас и крепёж",
  "Моно стеллажи",
  "Сантехника",
  "Мелочи на ферму",
  "Насосы",
  "Ёмкости",
  "Автоматы",
  "Запуск",
  "Отопление",
  "Влажность",
];

/** Карта: наименование материала → модули (разделитель «;») */
const MATERIAL_MAP = [
  ["Механический таймер суточный", "Автоматика и датчики"],
  ["Программируемый цифровой таймер на DIN-рейку", "Автоматика и датчики; Электрика и щит"],
  ["Электромагнитный клапан", "Автоматика и датчики; Общая магистраль полива и дренажа"],
  ["EC-метр", "Водоподготовка; Расходники запуска"],
  ["pH-метр", "Водоподготовка; Расходники запуска"],
  ["Ёмкость для питьевой воды 1 м³", "Водоподготовка"],
  ["Калибровочные растворы для pH-метра", "Водоподготовка; Расходники запуска"],
  ["Канистра для удобрений 10 л", "Водоподготовка; Расходники запуска"],
  ["Комплект удобрений", "Водоподготовка; Расходники запуска"],
  ["Миксер-насадка строительная для раствора", "Водоподготовка; Инструмент и инвентарь"],
  ["Ортофосфорная кислота 57%, 5 л", "Водоподготовка; Расходники запуска"],
  ["Ортофосфорная кислота 75%, 1 л", "Водоподготовка; Расходники запуска"],
  ["Перекись водорода 36–38%, 10 л", "Водоподготовка; Расходники запуска"],
  ["Перекись водорода 37%, 5 л", "Водоподготовка; Расходники запуска"],
  ["Растворный узел Reogen", "Водоподготовка; Автоматика и датчики"],
  ["Вилка электрическая с заземлением", "Электрика и щит"],
  ["Кабель-канал 40×40 мм, L=2000 мм", "Электрика и щит"],
  ["Кабель-канал 60×40 мм, L=2000 мм", "Электрика и щит"],
  ["Клемма WAGO", "Электрика и щит"],
  ["Клемма WAGO, 3 контакта", "Электрика и щит"],
  ["Контактор 32 А", "Электрика и щит"],
  ["Провод ПВС 3×0.75 мм²", "Электрика и щит"],
  ["Провод ПВС 3×0.75 мм² / 2×0.75 мм²", "Электрика и щит"],
  ["Провод ПУВ 1×0.5 мм²", "Электрика и щит"],
  ["Умная Wi-Fi розетка Tuya", "Автоматика и датчики; Электрика и щит"],
  ["Щит на DIN-рейку для автоматики, X модулей", "Электрика и щит; Автоматика и датчики"],
  ["Щит управления с готовой системой автоматики", "Электрика и щит; Автоматика и датчики"],
  ["Алюминиевый скотч для воздуховодов", "Климат и вентиляция"],
  ["Воздуховод пластиковый 55×110 мм, L=2000 мм", "Климат и вентиляция"],
  ["Колено воздуховода 55×110 мм, 90°", "Климат и вентиляция"],
  ["Соединитель пластикового воздуховода 55×110 мм", "Климат и вентиляция"],
  ["Сплит-система / кондиционер", "Климат и вентиляция"],
  ["Дезинфекционный коврик", "Манипуляционная зона"],
  ["Раковина из нержавеющей стали", "Манипуляционная зона"],
  ["Стол манипуляционный из нержавеющей стали", "Манипуляционная зона"],
  ["Доставка", "Работы, услуги и доставка"],
  ["Ёмкость 2 м³", "Насосная группа и обвязка"],
  ["Бак пластиковый 200 л", "Насосная группа и обвязка"],
  ["Насос дренажный погружной", "Насосная группа и обвязка"],
  ["Пластиковая ёмкость / строительный таз 90–120 л", "Насосная группа и обвязка; Инструмент и инвентарь"],
  ["Автоматический выключатель 6 А, 1P, DIN", "Электрика и щит"],
  ["Автоматический выключатель 10 А, 1P, DIN", "Электрика и щит"],
  ["Автоматический выключатель 16 А, 1P, DIN", "Электрика и щит"],
  ["Автоматический выключатель 20 А, 1P, DIN", "Электрика и щит"],
  ["Автоматический выключатель 25 А, 1P, DIN", "Электрика и щит"],
  ["Автоматический выключатель 32 А, 1P, DIN", "Электрика и щит"],
  ["Автоматический выключатель 40 А, 1P, DIN", "Электрика и щит"],
  ["Блок питания 12/24 В для таймеров и автоматики", "Электрика и щит; Автоматика и датчики"],
  ["Вентилятор напольный/настенный, от 3800 м³/ч", "Климат и вентиляция"],
  ["Врезка в бочку д50, 2\"", "Насосная группа и обвязка; Водоподготовка"],
  ["Вытяжной вентилятор", "Климат и вентиляция"],
  ["Гибкая канализационная подводка д50, вход/выход д50", "Общая магистраль полива и дренажа"],
  ["Гибкий воздуховод / гофра для вытяжки", "Климат и вентиляция"],
  ["Датчик уровня воды для дренажной ёмкости", "Автоматика и датчики; Насосная группа и обвязка"],
  ["Заглушка канализационная д110, серая", "Общая магистраль полива и дренажа; Стеллаж проточка / NFT 200×100 широкий"],
  ["Кран шаровый ПП д32, 1 1/4\"", "Общая магистраль полива и дренажа; Водоподготовка"],
  ["Муфта ПНД переходная д32×25 / д32×32", "Общая магистраль полива и дренажа; Рассадное отделение подтопление"],
  ["Муфта канализационная д50, серая", "Общая магистраль полива и дренажа; Стеллаж проточка / NFT 200×100 широкий; Стеллаж проточка / NFT 200×74 узкий; Стеллаж клубника / ягода; Стеллаж аэропоника"],
  ["Муфта компрессионная ПНД д50×50, 2\"", "Общая магистраль полива и дренажа; Насосная группа и обвязка"],
  ["Муфта соединительная канализационная д110, серая", "Общая магистраль полива и дренажа; Стеллаж проточка / NFT 200×100 широкий; Стеллаж проточка / NFT 200×74 узкий; Стеллаж клубника / ягода; Стеллаж аэропоника"],
  ["Муфта-американка комбинированная 1 1/4\", штуцер/ПП", "Насосная группа и обвязка; Общая магистраль полива и дренажа"],
  ["Муфта-американка переходная латунь/ПП д25, 1\"", "Насосная группа и обвязка; Общая магистраль полива и дренажа"],
  ["Муфта-американка переходная латунь/ПП д25×д32, 1\"×1 1/4\"", "Насосная группа и обвязка; Общая магистраль полива и дренажа; Рассадное отделение подтопление"],
  ["Насос полива для подтопления", "Насосная группа и обвязка"],
  ["Насос полива для проточки / NFT", "Насосная группа и обвязка"],
  ["Обратный клапан ПП д32, 1 1/4\"", "Насосная группа и обвязка; Общая магистраль полива и дренажа"],
  ["Отвод ПП д25 90°, 1\"", "Общая магистраль полива и дренажа; Стеллаж проточка / NFT 200×74 узкий"],
  ["Отвод ПП д32 90°, 1 1/4\"", "Общая магистраль полива и дренажа"],
  ["Отвод ПП д32×25 90°, 1 1/4\"×1\"", "Общая магистраль полива и дренажа"],
  ["Отвод канализационный д110 90°", "Общая магистраль полива и дренажа"],
  ["Отвод канализационный д110×50×110, правый", "Общая магистраль полива и дренажа"],
  ["Отвод канализационный д50 45°", "Общая магистраль полива и дренажа"],
  ["Складской стеллаж / полки", "Инструмент и инвентарь"],
  ["Термогигрометр", "Климат и вентиляция; Автоматика и датчики; Расходники запуска"],
  ["Тройник ПП д25×25×25, 1\"", "Общая магистраль полива и дренажа"],
  ["Тройник ПП д32×25×32, 1 1/4\"×1\"×1 1/4\"", "Общая магистраль полива и дренажа"],
  ["Тройник ПП д32×32×32, 1 1/4\"", "Общая магистраль полива и дренажа"],
  ["Тройник канализационный д50, серая", "Общая магистраль полива и дренажа"],
  ["Тройник канализационный д110×50×110, серая", "Общая магистраль полива и дренажа; Стеллаж проточка / NFT 200×100 широкий"],
  ["Труба ПП д25 тонкостенная неармированная, стенка 2.4–2.8 мм", "Общая магистраль полива и дренажа"],
  ["Труба ПП д32 тонкостенная неармированная, стенка 2.4–2.8 мм", "Общая магистраль полива и дренажа"],
  ["Труба канализационная д110, L=1500 мм, серая", "Общая магистраль полива и дренажа"],
  ["Труба канализационная д110, L=2000 мм, серая", "Общая магистраль полива и дренажа"],
  ["Труба канализационная д50, L=1500 мм, серая", "Общая магистраль полива и дренажа"],
  ["Труба канализационная д50, L=2000 мм, серая", "Общая магистраль полива и дренажа"],
  ["Труба канализационная д50, L=500 мм, серая", "Общая магистраль полива и дренажа; Стеллаж аэропоника"],
  ["Светильник LED для стеллажа", "Освещение стеллажей"],
  ["Хомут металлический для крепления труб", "Общая магистраль полива и дренажа"],
  ["Zip-пакеты 10×15 см, 100 шт", "Расходники запуска"],
  ["Аптечка", "Инструмент и инвентарь"],
  ["Ведро 10 л", "Инструмент и инвентарь"],
  ["Весы кухонные до 5 кг", "Инструмент и инвентарь"],
  ["Весы ювелирные", "Инструмент и инвентарь"],
  ["Воронка с широким горлышком", "Инструмент и инвентарь"],
  ["Жёлтые клеевые ловушки от насекомых, 50 шт", "Расходники запуска"],
  ["Комплект СИЗ для персонала", "Расходники запуска"],
  ["Контейнер для хранения семян, от 20 л", "Инструмент и инвентарь; Расходники запуска"],
  ["Коробки/корзины для доставки продукции", "Расходники запуска"],
  ["Мерный стакан 1 л", "Инструмент и инвентарь"],
  ["Ножницы / секатор", "Инструмент и инвентарь"],
  ["Пинцет", "Инструмент и инвентарь"],
  ["Пульверизатор помповый/аккумуляторный 10 л", "Инструмент и инвентарь"],
  ["Пульверизатор ручной 1 л", "Инструмент и инвентарь"],
  ["Сито", "Инструмент и инвентарь"],
  ["Таблички для растений, 50 шт", "Расходники запуска"],
  ["Этикетки самоклеящиеся белые", "Расходники запуска"],
  ["Дезинфицирующее средство Экоцид / Лигроцид", "Расходники запуска"],
  ["Болт М6×20", "Стеллаж аэропоника; Стеллаж клубника / ягода; Стеллаж проточка / NFT 200×100 широкий; Стеллаж проточка / NFT 200×74 узкий; Стеллаж подтопление; Рассадное отделение подтопление"],
  ["Гайка М6", "Стеллаж аэропоника; Стеллаж клубника / ягода; Стеллаж проточка / NFT 200×100 широкий; Стеллаж проточка / NFT 200×74 узкий; Стеллаж подтопление; Рассадное отделение подтопление"],
  ["Гибкая подводка для воды 1/2\", гайка-гайка, L=600–800 мм", "Стеллаж аэропоника; Стеллаж клубника / ягода; Стеллаж проточка / NFT 200×100 широкий; Стеллаж проточка / NFT 200×74 узкий"],
  ["Заглушка ПП д20 мм", "Стеллаж аэропоника"],
  ["Заглушка латунная 3/4\" для коллектора", "Стеллаж аэропоника; Стеллаж клубника / ягода; Стеллаж проточка / NFT 200×100 широкий; Стеллаж проточка / NFT 200×74 узкий"],
  ["Краб-система X-образная 20×20", "Стеллаж аэропоника; Стеллаж клубника / ягода; Стеллаж проточка / NFT 200×100 широкий; Стеллаж проточка / NFT 200×74 узкий; Стеллаж подтопление; Рассадное отделение подтопление"],
  ["Краб-система Г-образная 20×20, 1.2 мм", "Стеллаж аэропоника; Стеллаж клубника / ягода; Стеллаж проточка / NFT 200×100 широкий; Стеллаж проточка / NFT 200×74 узкий; Стеллаж подтопление; Рассадное отделение подтопление"],
  ["Краб-система Т-образная 20×20, 1.2 мм", "Стеллаж аэропоника; Стеллаж клубника / ягода; Стеллаж проточка / NFT 200×100 широкий; Стеллаж проточка / NFT 200×74 узкий; Стеллаж подтопление; Рассадное отделение подтопление"],
  ["Обратный клапан латунный 1 1/4\", штуцер/гайка", "Насосная группа и обвязка; Стеллаж аэропоника; Стеллаж клубника / ягода; Стеллаж проточка / NFT 200×100 широкий; Стеллаж проточка / NFT 200×74 узкий"],
  ["Обратный клапан латунный 1\", штуцер/гайка", "Насосная группа и обвязка; Стеллаж аэропоника; Стеллаж клубника / ягода; Стеллаж проточка / NFT 200×100 широкий; Стеллаж проточка / NFT 200×74 узкий"],
  ["Окраска профильной трубы", "Стеллаж аэропоника; Стеллаж клубника / ягода; Стеллаж проточка / NFT 200×100 широкий; Стеллаж проточка / NFT 200×74 узкий; Стеллаж подтопление; Рассадное отделение подтопление"],
  ["Отвод ПНД д25×20 мм", "Стеллаж аэропоника"],
  ["Отвод ПП д20 90°", "Стеллаж аэропоника"],
  ["Профильная труба 20×20×1.5 мм", "Стеллаж аэропоника; Стеллаж клубника / ягода; Стеллаж проточка / NFT 200×100 широкий; Стеллаж проточка / NFT 200×74 узкий; Стеллаж подтопление; Рассадное отделение подтопление"],
  ["Саморез с прессшайбой 4.2×13 мм", "Стеллаж аэропоника; Стеллаж клубника / ягода; Стеллаж проточка / NFT 200×100 широкий; Стеллаж проточка / NFT 200×74 узкий; Стеллаж подтопление; Рассадное отделение подтопление"],
  ["Тройник ПП д20 мм", "Стеллаж аэропоника"],
  ["Тройник пластиковый 40×40×40 мм", "Стеллаж аэропоника"],
  ["Труба ПП д20 мм", "Стеллаж аэропоника"],
  ["Форсунки-дождеватели для аэропоники", "Стеллаж аэропоника"],
  ["Шайба гроверная М6", "Стеллаж аэропоника; Стеллаж клубника / ягода; Стеллаж проточка / NFT 200×100 широкий; Стеллаж проточка / NFT 200×74 узкий; Стеллаж подтопление; Рассадное отделение подтопление"],
  ["Анаэробный герметик красный", "Стеллаж проточка / NFT 200×100 широкий; Общая магистраль полива и дренажа"],
  ["Врезка в бочку 1/2\"", "Стеллаж проточка / NFT 200×100 широкий"],
  ["Держатель трубы д110 мм", "Стеллаж проточка / NFT 200×100 широкий"],
  ["Кабель-канал 40×40 или 60×60 мм, L=2000 мм", "Электрика и щит; Освещение стеллажей; Автоматика и датчики"],
  ["Кассета салатная/рассадная", "Стеллаж проточка / NFT 200×100 широкий; Стеллаж проточка / NFT 200×74 узкий; Стеллаж аэропоника; Рассадное отделение подтопление"],
  ["Клапан сливной для гидропонного поддона", "Стеллаж проточка / NFT 200×100 широкий; Стеллаж проточка / NFT 200×74 узкий; Рассадное отделение подтопление"],
  ["Клей для ПВХ-труб Bailey, 473 мл", "Стеллаж проточка / NFT 200×100 широкий; Общая магистраль полива и дренажа"],
  ["Коллектор распределительный 3/4\", 5 выходов 1/2\"", "Стеллаж проточка / NFT 200×100 широкий; Общая магистраль полива и дренажа"],
  ["Крышка на гидропонный поддон", "Стеллаж проточка / NFT 200×100 широкий; Стеллаж проточка / NFT 200×74 узкий; Стеллаж аэропоника; Рассадное отделение подтопление"],
  ["Лента ФУМ", "Общая магистраль полива и дренажа; Насосная группа и обвязка"],
  ["Муфта-американка 3/4\" штуцер латунь × 1\" ПП", "Насосная группа и обвязка; Общая магистраль полива и дренажа"],
  ["Поддон гидропонный", "Стеллаж проточка / NFT 200×100 широкий; Стеллаж проточка / NFT 200×74 узкий; Стеллаж аэропоника; Рассадное отделение подтопление"],
  ["Кран шаровый ПП д25 мм", "Стеллаж проточка / NFT 200×74 узкий; Общая магистраль полива и дренажа"],
  ["Труба профильная 20/20/1,5 мм / Профильная труба 20×20×1.5 мм", "Стеллаж проточка / NFT 200×74 узкий"],
  ["Хомут ПП д25 мм", "Стеллаж проточка / NFT 200×74 узкий; Общая магистраль полива и дренажа"],
  ["Хомут пластиковый д50 мм", "Стеллаж проточка / NFT 200×74 узкий; Общая магистраль полива и дренажа"],
  ["Шланг д25 мм", "Стеллаж проточка / NFT 200×74 узкий; Общая магистраль полива и дренажа"],
];

/** Дополнительные алиасы имён материалов в базе */
const MATERIAL_ALIASES = {
  "Насос полива для подтопления": ["Насос полив подтопление", "Насос дренажный погружной на 6000 л\\ч"],
  "Насос полива для проточки / NFT": ["Насос полив проточка"],
  "Кабель-канал 40×40 или 60×60 мм, L=2000 мм": ["Кабель канал L=2000 мм 40\\40 или 60\\60"],
  "Краб-система X-образная 20×20": ["Краб X образный"],
  "Краб-система Г-образная 20×20, 1.2 мм": ["Краб система Г-образная 20/20/1,2 мм"],
  "Краб-система Т-образная 20×20, 1.2 мм": ["Краб система Т-образная 20/20/1,2 мм"],
  "Саморез с прессшайбой 4.2×13 мм": ["Саморез (пресшайба) 4,2*13мм"],
  "Программируемый цифровой таймер на DIN-рейку": [
    "Программируемый цифровой таймер / астрономическое реле времени",
  ],
  "Пластиковая ёмкость / строительный таз 90–120 л": ["Пластиковая ёмкость 90 л (строительный таз)"],
  "Труба профильная 20/20/1,5 мм / Профильная труба 20×20×1.5 мм": ["Труба профильная 20/20 толщина 1,5мм"],
  "Провод ПВС 3×0.75 мм² / 2×0.75 мм²": ["Провод ПВС 3*0.75\\2*0.75(если без заземления) мм3"],
  "Провод ПУВ 1×0.5 мм²": ["Провод ПУВ 1*0.5 мм3 по"],
  "Клемма WAGO": [
    "Клемма WAGO 2 контакта (3 если с заземлением)",
    "Клемма WAGO 2 контакта (или 3, если будет заземление)",
  ],
  "Электромагнитный клапан": ["Э\\м Клапан PGV-101-G-B Hunter"],
  "Умная Wi-Fi розетка Tuya": ["Умная розетка Wi-Fi https://ozon.ru/t/6322Ey4"],
  "Труба ПП д32 тонкостенная неармированная, стенка 2.4–2.8 мм": [
    "Труба ПП д32 тонкостенная неармированная, стенка 2.4–2.8 мм",
  ],
};

const ARCHIVED_MODULE_CHECKS = [
  "Кабель",
  "Полив",
  "Расходники",
  "Полив/дренаж подтопление",
  "Полив/дренаж проточка",
  "Монтажные работы и запуск",
];

function normName(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/‑/g, "-")
    .replace(/–/g, "-")
    .replace(/—/g, "-")
    .replace(/-/g, " ")
    .replace(/×/g, "x")
    .replace(/[х*]/g, "x")
    .replace(/\//g, "x")
    .replace(/\\/g, "x")
    .replace(/,/g, ".")
    .replace(/["']/g, "")
    .replace(/\s*мм\.?\s*$/g, "")
    .replace(/\s+/g, " ");
}

function cleanMultilineName(name) {
  return String(name || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function backupDb() {
  const src = getDbPath();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dest = `${src}.backup-${stamp}`;
  fs.copyFileSync(src, dest);
  return dest;
}

function nameTokens(s) {
  return normName(s)
    .replace(/[^a-z0-9а-я.]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1);
}

function tokenScore(a, b) {
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

function findMaterialsByMapName(allMaterials, mapName) {
  const aliases = [mapName, ...(MATERIAL_ALIASES[mapName] || [])];
  const found = new Map();

  for (const alias of aliases) {
    const target = normName(alias);
    if (!target) continue;

    for (const m of allMaterials) {
      const n = normName(m.name);
      if (n === target) found.set(m.id, m);
    }

    const partial = allMaterials.filter((m) => {
      const n = normName(m.name);
      return n.startsWith(target) || target.startsWith(n);
    });
    if (partial.length === 1) found.set(partial[0].id, partial[0]);

    if (partial.length > 1) {
      const core = target.slice(0, Math.min(24, target.length));
      for (const m of partial.filter((x) => normName(x.name).includes(core))) {
        found.set(m.id, m);
      }
    }

    const scored = allMaterials
      .map((m) => ({ m, score: tokenScore(alias, m.name) }))
      .filter((x) => x.score >= 0.72)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 1) found.set(scored[0].m.id, scored[0].m);
    else if (scored.length > 1 && scored[0].score - scored[1].score >= 0.12) {
      found.set(scored[0].m.id, scored[0].m);
    }
  }

  return [...found.values()];
}

function getModuleByName(modules, name) {
  return modules.find((m) => m.name === name) || null;
}

function fixTypoModuleName(name) {
  return name.replace("обvязка", "обвязка").replace("тонkostенная", "тонкостенная");
}

function parseModuleList(raw, activeNames) {
  const parts = String(raw || "")
    .split(";")
    .map((s) => fixTypoModuleName(s.trim()))
    .filter(Boolean);
  const resolved = [];
  const unknown = [];
  for (const part of parts) {
    if (activeNames.includes(part)) {
      if (!resolved.includes(part)) resolved.push(part);
      continue;
    }
    const hit = activeNames.find(
      (n) => n.toLowerCase().replace(/ё/g, "е") === part.toLowerCase().replace(/ё/g, "е")
    );
    if (hit) {
      if (!resolved.includes(hit)) resolved.push(hit);
    } else {
      unknown.push(part);
    }
  }
  return { resolved, unknown };
}

function applyMaterialModules(mat, modules, dryRunFlag) {
  const next = patchMaterialModules(mat, modules);
  if (!dryRunFlag) {
    db.prepare(
      "UPDATE materials SET module=@module, modules_json=@modules_json, updated_at=datetime('now') WHERE id=@id"
    ).run({
      id: mat.id,
      module: next.module,
      modules_json: JSON.stringify(next.modules),
    });
  }
  return next;
}

function mergeModuleIntoTarget(oldName, newName, report, dryRunFlag) {
  const oldMod = getModuleByName(listModulesAdmin({ includeArchived: true }), oldName);
  const newMod = getModuleByName(listModulesAdmin({ includeArchived: true }), newName);
  if (!oldMod || !newMod || oldMod.id === newMod.id) return false;

  report.modules.merged.push(`${oldName} → ${newName}`);
  if (dryRunFlag) return true;

  for (const row of db.prepare("SELECT * FROM materials").all()) {
    const mat = rowToMaterial(row);
    if (!resolveMaterialModules(mat).includes(oldName)) continue;
    const nextMods = resolveMaterialModules(mat).map((n) => (n === oldName ? newName : n));
    applyMaterialModules(mat, [...new Set(nextMods)], false);
  }
  if (oldMod.active) archiveModule(oldMod.id);
  if (!newMod.active) restoreModule(newMod.id);
  return true;
}

function setupModules(report) {
  let modules = listModulesAdmin({ includeArchived: true });

  for (const spec of MODULE_CREATES) {
    const hit = getModuleByName(modules, spec.name);
    if (hit) {
      if (!hit.active && !dryRun) restoreModule(hit.id);
      report.modules.existing.push(spec.name);
      continue;
    }
    const renameSource = MODULE_RENAMES.find(([, newName]) => newName === spec.name);
    if (renameSource) {
      const [oldName] = renameSource;
      const oldMod = getModuleByName(modules, oldName);
      if (oldMod) {
        report.modules.renamed.push(`${oldName} → ${spec.name}`);
        if (!dryRun) {
          if (!oldMod.active) restoreModule(oldMod.id);
          try {
            updateModule(oldMod.id, { name: spec.name });
          } catch (e) {
            if (!mergeModuleIntoTarget(oldName, spec.name, report, dryRun)) throw e;
          }
        }
        continue;
      }
    }
    report.modules.created.push(spec.name);
    if (!dryRun) {
      createModule(spec);
    }
  }

  modules = listModulesAdmin({ includeArchived: true });

  for (const [oldName, newName] of MODULE_RENAMES) {
    const oldMod = getModuleByName(modules, oldName);
    const newMod = getModuleByName(modules, newName);
    if (!oldMod) {
      if (newMod) report.modules.renameSkipped.push(`${oldName} → ${newName} (уже ${newName})`);
      continue;
    }
    if (newMod && newMod.id !== oldMod.id) {
      mergeModuleIntoTarget(oldName, newName, report, dryRun);
      continue;
    }
    report.modules.renamed.push(`${oldName} → ${newName}`);
    if (!dryRun) {
      if (!oldMod.active) restoreModule(oldMod.id);
      try {
        updateModule(oldMod.id, { name: newName });
      } catch (e) {
        if (!mergeModuleIntoTarget(oldName, newName, report, dryRun)) throw e;
      }
    }
  }

  modules = listModulesAdmin({ includeArchived: true });
  const activeSet = new Set(FINAL_ACTIVE_MODULES);

  for (const name of MODULE_ARCHIVE_NAMES) {
    const mod = getModuleByName(modules, name);
    if (!mod || !mod.active) continue;
    report.modules.archived.push(name);
    if (!dryRun) archiveModule(mod.id);
  }

  modules = listModulesAdmin({ includeArchived: true });
  for (const mod of modules) {
    if (!mod.active) continue;
    if (activeSet.has(mod.name)) continue;
    if (MODULE_ARCHIVE_NAMES.includes(mod.name)) continue;
    report.modules.archivedExtra.push(mod.name);
    if (!dryRun) archiveModule(mod.id);
  }

  for (const name of FINAL_ACTIVE_MODULES) {
    const mod = getModuleByName(listModulesAdmin({ includeArchived: true }), name);
    if (mod && !mod.active) {
      report.modules.restored.push(name);
      if (!dryRun) restoreModule(mod.id);
    }
  }
}

function applyMaterialMap(allMaterials, activeNames, report) {
  const touched = new Set();

  for (const [mapName, modulesRaw] of MATERIAL_MAP) {
    const { resolved, unknown } = parseModuleList(modulesRaw, activeNames);
    if (unknown.length) {
      report.moduleResolveErrors.push({ mapName, unknown });
    }
    const hits = findMaterialsByMapName(allMaterials, mapName);
    if (!hits.length) {
      report.notFound.push(mapName);
      continue;
    }
    for (const mat of hits) {
      touched.add(mat.id);
      const before = resolveMaterialModules(mat);
      report.updated.push({ id: mat.id, name: mat.name, mapName, before, after: resolved });
      applyMaterialModules(mat, resolved, dryRun);
    }
  }

  for (const mat of allMaterials) {
    if (/насос/i.test(mat.name)) {
      const { resolved } = parseModuleList("Насосная группа и обвязка", activeNames);
      if (resolved.length) {
        const before = resolveMaterialModules(mat);
        const same =
          before.length === resolved.length && before.every((m, i) => m === resolved[i]);
        if (!same) {
          touched.add(mat.id);
          report.pumpsUpdated.push({ name: mat.name, before, after: resolved });
          applyMaterialModules(mat, resolved, dryRun);
        }
      }
    }
  }

  return touched;
}

function cleanupMaterialNames(allMaterials, report) {
  for (const mat of allMaterials) {
    const cleaned = cleanMultilineName(mat.name);
    if (cleaned !== mat.name) {
      report.namesCleaned.push({ id: mat.id, before: mat.name, after: cleaned });
      if (!dryRun) {
        db.prepare("UPDATE materials SET name=@name, updated_at=datetime('now') WHERE id=@id").run({
          id: mat.id,
          name: cleaned,
        });
      }
    }
  }
}

function stripArchivedFromMaterials(activeNames, report) {
  const activeSet = new Set(activeNames);
  const rows = db.prepare("SELECT * FROM materials").all().map(rowToMaterial);
  for (const mat of rows) {
    const mods = resolveMaterialModules(mat);
    const kept = mods.filter((m) => activeSet.has(m));
    if (kept.length === mods.length) continue;
    if (!kept.length) {
      report.noActiveModule.push({ id: mat.id, name: mat.name, was: mods });
    }
    report.strippedArchived.push({ id: mat.id, name: mat.name, before: mods, after: kept });
    if (!dryRun) applyMaterialModules(mat, kept, false);
  }
}

function runVerification(activeNames) {
  const activeSet = new Set(activeNames);
  const materials = db.prepare("SELECT * FROM materials").all().map(rowToMaterial);
  const modules = listModulesAdmin({ includeArchived: false });
  const checks = {};

  for (const archivedName of ARCHIVED_MODULE_CHECKS) {
    checks[`no_${archivedName}`] = materials.filter((m) => resolveMaterialModules(m).includes(archivedName));
  }

  checks.activeModulesWithComma = modules.filter(
    (m) => /\/ NFT \d+×\d+,/.test(m.name) || (/,\s*(широкий|узкий)\s*$/.test(m.name) && /NFT/.test(m.name))
  );
  checks.materialsWithoutActiveModule = materials.filter((m) => {
    const mods = resolveMaterialModules(m).filter((n) => activeSet.has(n));
    return mods.length === 0;
  });
  checks.multilineNames = materials.filter((m) => /[\r\n]/.test(m.name));
  checks.oldModulesStillActive = listModulesAdmin({ includeArchived: false }).filter(
    (m) => MODULE_ARCHIVE_NAMES.includes(m.name) || !FINAL_ACTIVE_MODULES.includes(m.name)
  );
  checks.archivedNotActive = listModulesAdmin({ includeArchived: true }).filter(
    (m) => MODULE_ARCHIVE_NAMES.includes(m.name) && m.active
  );

  return checks;
}

function run() {
  console.log(`Режим: ${dryRun ? "DRY-RUN (добавьте --apply)" : "APPLY"}`);
  initDb();

  const report = {
    mode: dryRun ? "dry-run" : "apply",
    dbPath: getDbPath(),
    backup: null,
    modules: {
      created: [],
      renamed: [],
      archived: [],
      archivedExtra: [],
      restored: [],
      existing: [],
      renameSkipped: [],
      mergeNeeded: [],
      merged: [],
    },
    updated: [],
    notFound: [],
    pumpsUpdated: [],
    moduleResolveErrors: [],
    namesCleaned: [],
    strippedArchived: [],
    noActiveModule: [],
    verification: null,
  };

  if (!dryRun) {
    report.backup = backupDb();
    console.log(`Backup: ${report.backup}`);
  }

  const allMaterials = db.prepare("SELECT * FROM materials").all().map(rowToMaterial);

  setupModules(report);
  cleanupMaterialNames(allMaterials, report);

  const activeNames = FINAL_ACTIVE_MODULES.slice();
  applyMaterialMap(allMaterials, activeNames, report);

  if (!dryRun) {
    stripArchivedFromMaterials(activeNames, report);
  }

  report.verification = dryRun ? null : runVerification(activeNames);

  console.log("\n=== Модули ===");
  console.log("Создано:", report.modules.created.length, report.modules.created);
  console.log("Переименовано:", report.modules.renamed.length);
  for (const r of report.modules.renamed) console.log(" ", r);
  console.log("Архивировано:", report.modules.archived.length, report.modules.archived);
  if (report.modules.archivedExtra.length) {
    console.log("Архив (прочие не из финального списка):", report.modules.archivedExtra);
  }

  console.log("\n=== Материалы ===");
  console.log("Обновлено по карте:", report.updated.length);
  console.log("Насосы:", report.pumpsUpdated.length);
  console.log("Не найдено:", report.notFound.length);
  if (report.notFound.length) for (const n of report.notFound) console.log(" ", n);
  if (report.moduleResolveErrors.length) {
    console.log("Ошибки модулей:", report.moduleResolveErrors);
  }

  if (!dryRun && report.verification) {
    console.log("\n=== Проверка ===");
    let ok = true;
    for (const archivedName of ARCHIVED_MODULE_CHECKS) {
      const key = `no_${archivedName}`;
      const hits = report.verification[key];
      if (hits.length) {
        ok = false;
        console.log(`FAIL: материалы с модулем «${archivedName}»:`, hits.map((m) => m.name));
      } else {
        console.log(`OK: нет материалов с «${archivedName}»`);
      }
    }
    if (report.verification.activeModulesWithComma.length) {
      ok = false;
      console.log("FAIL: активные модули с запятой:", report.verification.activeModulesWithComma.map((m) => m.name));
    } else {
      console.log("OK: нет активных модулей с запятой");
    }
    if (report.verification.materialsWithoutActiveModule.length) {
      ok = false;
      console.log(
        "FAIL: материалы без активного модуля:",
        report.verification.materialsWithoutActiveModule.map((m) => m.name)
      );
    } else {
      console.log("OK: у всех материалов есть активный модуль");
    }
    if (report.verification.multilineNames.length) {
      ok = false;
      console.log("FAIL: многострочные названия:", report.verification.multilineNames.map((m) => m.name));
    } else {
      console.log("OK: многострочных названий нет");
    }
    if (report.verification.archivedNotActive.length) {
      ok = false;
      console.log("FAIL: старые модули всё ещё активны:", report.verification.archivedNotActive.map((m) => m.name));
    } else {
      console.log("OK: старые модули архивированы");
    }
    console.log(ok ? "\nВсе проверки пройдены." : "\nЕсть проблемы — см. выше.");
  }

  const outPath = path.join(__dirname, "../data/apply-modules-report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nОтчёт: ${outPath}`);
}

run();
