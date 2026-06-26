import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";
import { initDb, db, rowToMaterial } from "../src/db.js";
import { listModulesAdmin } from "../src/routes/materials.js";
import { resolveMaterialModules, normalizeMaterialModules } from "../../shared/materialModules.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const excelPath = path.join(__dirname, "../../import/daogreen_materials_naming_map_client_subsections.xlsx");

const MODULE_ALIASES = {
  "Насосная группа и обвязка": ["Обвязка насосной станции", "Насосы"],
  "Электрика и щит": ["Электрика", "Кабель", "Автоматы"],
  "Общая магистраль полива и дренажа": ["Сантехника", "Полив"],
  "Освещение стеллажей": ["Освещение"],
  "Расходники запуска": ["Расходники", "Запуск"],
  "Работы и доставка": ["Монтажные работы и запуск"],
  "Стеллаж проточка / NFT 200×100, широкий": ["Стеллаж проточка 200\\100\\N мм широкий"],
  "Стеллаж проточка / NFT 200×74, узкий": ["Стеллаж проточка 200\\740\\N мм узкий"],
  "Стеллаж клубника / ягода": ["Стеллаж клубника"],
  "Автоматика и датчики": ["Автоматика"],
};

function normName(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/-/g, " ")
    .replace(/×/g, "x")
    .replace(/[х*]/g, "x")
    .replace(/\//g, "x")
    .replace(/,/g, ".")
    .replace(/["']/g, "")
    .replace(/\s*мм\.?\s*$/g, "")
    .replace(/\s+/g, " ");
}

function needsManualReview(comment, action) {
  const text = `${action || ""} ${comment || ""}`.toLowerCase();
  return /разделить|уточнить.*вручн|требует.*разбор|не объединять.*размер|разные диаметры|разные длины|разные концентрации|разные фасовки/i.test(
    text
  );
}

function buildModuleResolver(dbModules) {
  const names = dbModules.map((m) => m.name);
  function matchOne(part) {
    const p = part.trim();
    if (!p) return null;
    for (const alias of MODULE_ALIASES[p] || []) {
      const hit = names.find((n) => n === alias);
      if (hit) return hit;
    }
    let hit = names.find((n) => n === p);
    if (hit) return hit;
    hit = names.find((n) => n.startsWith(p) || p.startsWith(n));
    if (hit) return hit;
    hit = names.find((n) => {
      const a = n.toLowerCase().replace(/ё/g, "е");
      const b = p.toLowerCase().replace(/ё/g, "е");
      return a.includes(b) || b.includes(a);
    });
    return hit || null;
  }
  return function resolveModules(raw) {
    const parts = String(raw || "")
      .split(/[,;|]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const resolved = [];
    const unknown = [];
    for (const part of parts) {
      const hit = matchOne(part);
      if (hit) {
        if (!resolved.includes(hit)) resolved.push(hit);
      } else unknown.push(part);
    }
    return { resolved, unknown };
  };
}

function findMaterial(allMaterials, sourceName, newName) {
  const target = normName(sourceName);
  let hits = allMaterials.filter((m) => normName(m.name) === target);
  if (hits.length) return hits;
  hits = allMaterials.filter((m) => normName(m.name) === normName(newName));
  return hits;
}

function sameModules(a, b) {
  const na = normalizeMaterialModules(a);
  const nb = normalizeMaterialModules(b);
  return na.length === nb.length && na.every((m, i) => m === nb[i]);
}

initDb();
const wb = XLSX.readFile(excelPath);
const edits = XLSX.utils.sheet_to_json(wb.Sheets["Правки материалов"], { defval: "" });
const materials = db.prepare("SELECT * FROM materials").all().map(rowToMaterial);
const resolveModules = buildModuleResolver(listModulesAdmin({ includeArchived: true }));

const notFound = [];
const skippedManual = [];
const moduleMismatch = [];
const moduleConflict = [];
const noModulesInMap = [];
const modulesOk = [];

for (const row of edits) {
  const sourceName = row["Исходное наименование"];
  const newName = row["Рекомендуемое техническое наименование"] || sourceName;
  const modulesRaw = row["Рекомендуемые модули / разделы"] || "";
  const comment = row["Комментарий"] || "";
  if (!sourceName || String(sourceName).includes(" | ")) continue;
  if (!modulesRaw.trim()) {
    noModulesInMap.push({ sourceName, newName });
    continue;
  }

  const { resolved: expected, unknown } = resolveModules(modulesRaw);
  const matches = findMaterial(materials, sourceName, newName);

  if (!matches.length) {
    notFound.push({ sourceName, newName, expected: expected.join(", "), modulesRaw, unknown });
    continue;
  }

  const manual = needsManualReview(comment, row["Действие"] || "");

  for (const m of matches) {
    const current = resolveMaterialModules(m);
    if (manual) {
      if (!sameModules(current, expected)) {
        skippedManual.push({
          name: m.name,
          reason: "комментарий карты (склейка/размеры)",
          current: current.join(", "),
          expected: expected.join(", "),
          comment: String(comment).slice(0, 80),
        });
      }
      continue;
    }

    if (unknown.length) {
      moduleConflict.push({
        name: m.name,
        unknown: unknown.join(", "),
        expected: expected.join(", "),
        current: current.join(", "),
        modulesRaw,
      });
    }

    if (expected.length && !sameModules(current, expected)) {
      moduleMismatch.push({
        name: m.name,
        current: current.join(", "),
        expected: expected.join(", "),
        modulesRaw,
      });
    } else if (expected.length) {
      modulesOk.push(m.name);
    }
  }
}

console.log("=== МОДУЛИ: СВОДКА ===");
console.log("Строк в карте с модулями:", edits.filter((r) => r["Рекомендуемые модули / разделы"]).length);
console.log("Совпадают с картой:", modulesOk.length);
console.log("НЕ применены (расхождение с картой):", moduleMismatch.length);
console.log("Пропущены из‑за комментария (manual):", skippedManual.length);
console.log("Не найдены в базе:", notFound.length);
console.log("Конфликт имён модулей в карте:", moduleConflict.length);

function show(title, list, fmt) {
  if (!list.length) return;
  console.log(`\n=== ${title} (${list.length}) ===`);
  list.forEach((x, i) => console.log(`${i + 1}. ${fmt(x)}`));
}

show(
  "Расхождение: в базе другие модули, чем в карте",
  moduleMismatch,
  (x) => `${x.name}\n   сейчас: ${x.current || "(пусто)"}\n   карта:  ${x.expected}\n   raw: ${x.modulesRaw}`
);
show(
  "Пропущено из‑за комментария (модули не трогали)",
  skippedManual,
  (x) => `${x.name}\n   сейчас: ${x.current}\n   карта:  ${x.expected}\n   → ${x.comment}`
);
show(
  "Не найдено в базе (модули не применялись)",
  notFound,
  (x) => `${x.sourceName}\n   карта: ${x.expected}${x.unknown?.length ? " | unknown: " + x.unknown.join(", ") : ""}`
);
show(
  "Часть модулей из карты не сопоставилась",
  moduleConflict.filter((x) => x.unknown),
  (x) => `${x.name}: unknown [${x.unknown}] | resolved [${x.expected}] | now [${x.current}]`
);
