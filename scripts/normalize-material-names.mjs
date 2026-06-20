#!/usr/bin/env node
/**
 * Normalize material names: capitalization, obvious typos.
 * Usage: node scripts/normalize-material-names.mjs [--dry-run] [dbPath]
 */
import { DatabaseSync } from "node:sqlite";
import fs from "fs";

const dryRun = process.argv.includes("--dry-run");
const dbPath =
  process.argv.find((a) => !a.startsWith("-") && a.endsWith(".db")) ||
  process.env.DATABASE_PATH ||
  new URL("../backend/data/daogreen.db", import.meta.url).pathname;

if (!fs.existsSync(dbPath)) {
  console.error("DB not found:", dbPath);
  process.exit(1);
}

/** Confident per-id fixes */
const ID_FIXES = {
  m004: "Краб Г-образный",
  m008: "Гроверная шайба",
  m041: "Гроверная шайба М6",
  m075: "Гроверная шайба М6",
  m006: "Болт М6×20 мм",
  m039: "Болт М6×20 мм",
  m073: "Болт М6×20 мм",
  m007: "Гайка М6",
  m040: "Гайка М6",
  m074: "Гайка М6",
  m025: "Тройник канализационный 110\\50\\110",
  m155: "Тройник ПП д32\\32\\32\n1 1\\4\"",
  m160: "Тройник ПП д32\\32\\32\n1 1\\4\"",
  m060: "Металлические хомуты",
  m099: "Металлические хомуты",
  m129: "Отвод канализационный 45 гр д50\n2\"",
  m125: "Отвод угол 45 гр канализационный\n2\"",
  m183: "Щит с системой автоматики готовый",
  m033: "Умная Wi-Fi розетка",
  m047: "Хомут 25 мм ПП",
  m188: "Автомат 16А",
  m187: "Контактор 32А",
  m192: "Вытяжка",
  m199: "Сплит-система",
  m104: "Кабель-канал 40\\40 мм L=2000 мм",
  m065: "Кабель-канал 60\\40 мм L=2000 мм",
  m038: "Краб система Г-образная 20/20/1,2 мм",
  m072: "Краб система Г-образная 20/20/1,2 мм",
  m037: "Краб система Т-образная 20/20/1,2 мм",
  m071: "Краб система Т-образная 20/20/1,2 мм",
  m151: "Ёмкость 60–90 л",
  m159: "Ёмкость 60–90 л (строительный таз)",
  m178: "Ёмкость 2 м³",
  m173: "Ёмкость для питьевой воды от 1 м³",
  m026: "Бак пластиковый 200 л",
  m058: "Пластиковая ёмкость 90 л (строительный таз)",
  m097: "Пластиковая ёмкость 90–120 л (строительный таз)",
  m051: "Отвод 50 мм 90 градусов, пластик",
  m087: "Отвод 50 мм 90 градусов, пластик",
  m013: "Лента ФУМ",
  m105: "Клемма WAGO",
  m066: "Клемма WAGO 2 контакта (3 если с заземлением)",
  m020: "Клемма WAGO 2 контакта (или 3, если будет заземление)",
};

const GLOBAL = [
  [/Металличекие/gi, "Металлические"],
  [/Тройнк/gi, "Тройник"],
  [/Тройнник/gi, "Тройник"],
  [/каналицаионный/gi, "канализационный"],
  [/каналиазионный/gi, "канализационный"],
  [/аврмированная/gi, "армированная"],
  [/ситемой авоматики/gi, "системой автоматики"],
  [/граверная/gi, "гроверная"],
  [/обраный/gi, "образный"],
  [/90градусов/gi, "90 градусов"],
  [/пПП/g, "ПП"],
  [/\bм6\b/gi, "М6"],
  [/\b16а\b/gi, "16А"],
  [/\b32а\b/gi, "32А"],
  [/вай\s*фай/gi, "Wi-Fi"],
  [/\bЕмкость/g, "Ёмкость"],
  [/\bемкость/g, "ёмкость"],
  [/(\d)мм\./g, "$1 мм"],
  [/(\d)мм([^.\s])/g, "$1 мм $2"],
  [/\s+\./g, "."],
  [/\s{2,}/g, " "],
];

function capitalizeFirst(s) {
  if (!s) return s;
  const i = [...s].findIndex((ch) => /[A-Za-zА-ЯЁа-яё]/.test(ch));
  if (i < 0) return s;
  const chars = [...s];
  chars[i] = chars[i].toUpperCase();
  return chars.join("");
}

function normalizeName(name, id) {
  if (ID_FIXES[id]) return ID_FIXES[id];

  let n = name.replace(/\r\n/g, "\n").trim();
  for (const [re, rep] of GLOBAL) n = n.replace(re, rep);
  n = n.replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n");
  n = capitalizeFirst(n);
  return n.trim();
}

const db = new DatabaseSync(dbPath);
const materials = db.prepare("SELECT id, name FROM materials ORDER BY id").all();
const updMat = db.prepare("UPDATE materials SET name = ?, updated_at = datetime('now') WHERE id = ?");
const updItem = db.prepare(
  "UPDATE project_items SET name = ? WHERE material_id = ? AND name = ?"
);

const changes = [];
for (const { id, name } of materials) {
  const next = normalizeName(name, id);
  if (next === name) continue;
  changes.push({ id, from: name, to: next });
}

if (dryRun) {
  console.log(JSON.stringify(changes, null, 2));
  console.log(`\nWould update ${changes.length} materials`);
  process.exit(0);
}

const tx = db.transaction(() => {
  for (const { id, from, to } of changes) {
    updMat.run(to, id);
    updItem.run(to, id, from);
  }
});
tx();

console.log(`Updated ${changes.length} material names`);
for (const c of changes) {
  console.log(`${c.id}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
}
