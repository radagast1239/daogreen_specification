#!/usr/bin/env node
/**
 * Импорт карты правок материалов из Excel.
 *
 * Usage:
 *   node scripts/importMaterialsNamingMap.js [--dry-run] [--apply] [path/to/map.xlsx]
 *   npm run import:materials-map -- --dry-run
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";
import {
  DEFAULT_CLIENT_SECTIONS,
  normalizeClientSectionCode,
  clientSectionsFromExcelSheet,
  isSubsectionValid,
} from "../../shared/clientSections.js";
import { normalizeMaterialModules, resolveMaterialModules } from "../../shared/materialModules.js";
import { initDb, db, getDbPath, rowToMaterial } from "../src/db.js";
import { updateMaterial, listModulesAdmin } from "../src/routes/materials.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "../..");

const args = process.argv.slice(2);
const dryRun = !args.includes("--apply");
const excelArg = args.find((a) => !a.startsWith("--"));
const defaultExcel = path.join(projectRoot, "import/daogreen_materials_naming_map_client_subsections.xlsx");
const excelPath = excelArg ? path.resolve(excelArg) : defaultExcel;

const SHEET_EDITS = "Правки материалов";
const SHEET_SUBS = "Подразделы клиента";

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

function isCompositeMapRow(name) {
  return String(name || "").includes(" | ");
}

function purchaseKey(name, unit) {
  return [normName(name), String(unit || "").trim().toLowerCase()].join("|");
}

function needsManualReview(comment, action) {
  const text = `${action || ""} ${comment || ""}`.toLowerCase();
  return /разделить|уточнить.*вручн|требует.*разбор|не объединять.*размер|разные диаметры|разные длины|разные концентрации|разные фасовки/i.test(
    text
  );
}

function wantsMerge(comment) {
  return /склеив|объедин|одинаков.*назван|повтор с таким же/i.test(String(comment || "").toLowerCase());
}

function backupDb() {
  const src = getDbPath();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dest = `${src}.backup-${stamp}`;
  fs.copyFileSync(src, dest);
  return dest;
}

function backupSettings() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dest = path.join(path.dirname(getDbPath()), `settings-backup-${stamp}.json`);
  fs.writeFileSync(dest, JSON.stringify(Object.fromEntries(rows.map((r) => [r.key, r.value])), null, 2));
  return dest;
}

function loadExcel() {
  if (!fs.existsSync(excelPath)) {
    throw new Error(`Файл не найден: ${excelPath}`);
  }
  const wb = XLSX.readFile(excelPath);
  const editsWs = wb.Sheets[SHEET_EDITS];
  if (!editsWs) throw new Error(`Лист «${SHEET_EDITS}» не найден`);
  const edits = XLSX.utils.sheet_to_json(editsWs, { defval: "" });

  const subsWs = wb.Sheets[SHEET_SUBS];
  const subsRows = subsWs
    ? XLSX.utils.sheet_to_json(subsWs, { header: 1, defval: "" }).slice(1).map((r) => ({
        order: r[0],
        label: r[1],
        id: r[2],
        subsection: r[3],
      }))
    : [];
  return { edits, clientSections: clientSectionsFromExcelSheet(subsRows) };
}

function buildSectionLabelMap(clientSections) {
  const map = {};
  for (const s of clientSections.length ? clientSections : DEFAULT_CLIENT_SECTIONS) {
    map[s.label.toLowerCase().replace(/ё/g, "е")] = s.id;
  }
  return map;
}

function resolveSectionCode(label, labelMap, category) {
  const key = String(label || "").trim().toLowerCase().replace(/ё/g, "е");
  return normalizeClientSectionCode(labelMap[key] || label, { category });
}

function buildModuleResolver(dbModules) {
  const names = dbModules.map((m) => m.name);
  const activeNames = dbModules.filter((m) => m.active).map((m) => m.name);

  function matchOne(part) {
    const p = part.trim();
    if (!p) return null;
    const aliases = MODULE_ALIASES[p] || [];
    for (const alias of aliases) {
      const aliasHit = names.find((n) => n === alias);
      if (aliasHit) return aliasHit;
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
      } else {
        unknown.push(part);
      }
    }
    return { resolved, unknown, hasArchived: resolved.some((n) => !activeNames.includes(n)) };
  };
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

function findMaterialByName(allMaterials, sourceName) {
  if (isCompositeMapRow(sourceName)) return [];

  const target = normName(sourceName);
  if (!target) return [];

  let hits = allMaterials.filter((m) => normName(m.name) === target);
  if (hits.length) return hits;

  const partial = allMaterials.filter((m) => {
    const n = normName(m.name);
    return n.startsWith(target) || target.startsWith(n);
  });
  if (partial.length === 1) return partial;

  if (partial.length > 1) {
    const core = target.slice(0, Math.min(24, target.length));
    const narrowed = partial.filter((m) => normName(m.name).includes(core));
    if (narrowed.length === 1) return narrowed;
  }

  const scored = allMaterials
    .map((m) => ({ m, score: tokenScore(sourceName, m.name) }))
    .filter((x) => x.score >= 0.72)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 1) return [scored[0].m];
  if (scored.length > 1 && scored[0].score - scored[1].score >= 0.12) return [scored[0].m];

  return [];
}

function appendNote(existing, addition) {
  const a = String(addition || "").trim();
  if (!a) return existing || "";
  const e = String(existing || "").trim();
  if (!e) return a;
  if (e.includes(a)) return e;
  return `${e}\n${a}`;
}

function updateClientSectionsSetting(clientSections) {
  const json = JSON.stringify(
    clientSections.map((s, i) => ({
      id: s.id,
      label: s.label,
      order: s.order ?? i + 1,
      subsections: s.subsections,
      hidden: s.hidden ?? false,
    })),
    null,
    0
  );
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('clientSectionsJson', @v) ON CONFLICT(key) DO UPDATE SET value = @v"
  ).run({ v: json });
}

function migrateLegacyClientSections() {
  const rows = db.prepare("SELECT id, client_section FROM materials WHERE client_section != ''").all();
  let n = 0;
  for (const row of rows) {
    const next = normalizeClientSectionCode(row.client_section);
    if (next && next !== row.client_section) {
      if (!dryRun) {
        db.prepare("UPDATE materials SET client_section = ? WHERE id = ?").run(next, row.id);
      }
      n++;
    }
  }
  return n;
}

function run() {
  console.log(`Режим: ${dryRun ? "DRY-RUN (без записи, добавьте --apply)" : "APPLY"}`);
  console.log(`Excel: ${excelPath}`);

  initDb();
  const { edits, clientSections } = loadExcel();
  const labelMap = buildSectionLabelMap(clientSections);
  const dbModules = listModulesAdmin({ includeArchived: true });
  const resolveModules = buildModuleResolver(dbModules);
  const allMaterials = db.prepare("SELECT * FROM materials").all().map(rowToMaterial);

  const byNormName = new Map();
  for (const m of allMaterials) {
    const k = normName(m.name);
    if (!byNormName.has(k)) byNormName.set(k, []);
    byNormName.get(k).push(m);
  }

  const report = {
    mode: dryRun ? "dry-run" : "apply",
    excelPath,
    dbPath: getDbPath(),
    updated: [],
    notFound: [],
    manualReview: [],
    moduleConflicts: [],
    sectionConflicts: [],
    archivedModules: [],
    skipped: [],
    legacyMigrated: 0,
    settingsUpdated: false,
    backups: {},
  };

  if (!dryRun) {
    report.backups.db = backupDb();
    report.backups.settings = backupSettings();
    console.log("Backup DB:", report.backups.db);
    console.log("Backup settings:", report.backups.settings);
    updateClientSectionsSetting(clientSections);
    report.settingsUpdated = true;
    report.legacyMigrated = migrateLegacyClientSections();
  }

  const mergeGroups = new Map();

  for (const row of edits) {
    const sourceName = row["Исходное наименование"];
    const newName = row["Рекомендуемое техническое наименование"] || sourceName;
    const unit = row["Рекомендуемая ед."] || "";
    const category = row["Категория (внутренняя)"] || "";
    const clientSectionLabel = row["Раздел для клиента"] || "";
    const clientSubsection = row["Подраздел для клиента"] || "";
    const modulesRaw = row["Рекомендуемые модули / разделы"] || "";
    const comment = row["Комментарий"] || "";
    const action = row["Действие"] || "";

    if (!sourceName) continue;

    if (isCompositeMapRow(sourceName)) {
      report.manualReview.push({
        sourceName,
        comment: "Сводная строка карты — отдельные позиции в базе не трогаем",
      });
      continue;
    }

    const matches = findMaterialByName(allMaterials, sourceName);
    if (!matches.length) {
      report.notFound.push({ sourceName, newName });
      continue;
    }

    const clientSection = resolveSectionCode(clientSectionLabel, labelMap, category);
    const { resolved: modules, unknown, hasArchived } = resolveModules(modulesRaw);

    if (unknown.length) {
      report.moduleConflicts.push({ sourceName, unknown, modulesRaw });
    }
    if (hasArchived) {
      report.archivedModules.push({ sourceName, modules });
    }
    if (clientSection && clientSubsection && !isSubsectionValid(clientSection, clientSubsection)) {
      report.sectionConflicts.push({ sourceName, clientSection, clientSubsection });
    }

    const manual = needsManualReview(comment, action);
    if (manual) {
      report.manualReview.push({ sourceName, comment, action });
    }

    const pKey = wantsMerge(comment) ? purchaseKey(newName, unit) : "";
    if (pKey) {
      if (!mergeGroups.has(pKey)) mergeGroups.set(pKey, []);
      mergeGroups.get(pKey).push(sourceName);
    }

    for (const mat of matches) {
      if (matches.length > 1) {
        report.manualReview.push({
          sourceName,
          comment: `Найдено ${matches.length} материалов с одинаковым названием — обновлены все`,
        });
      }

      const patch = {};
      let changed = false;

      if (newName && newName !== mat.name) {
        patch.name = newName;
        changed = true;
      }
      if (unit && unit !== mat.unit) {
        patch.unit = unit;
        changed = true;
      }
      if (category && category !== mat.category) {
        patch.category = category;
        changed = true;
      }
      if (clientSection && clientSection !== mat.clientSection) {
        patch.clientSection = clientSection;
        changed = true;
      }
      if (clientSubsection && clientSubsection !== mat.clientSubsection) {
        patch.clientSubsection = clientSubsection;
        changed = true;
      }

      if (modules.length && !manual) {
        const curMods = resolveMaterialModules(mat);
        const same =
          curMods.length === modules.length && curMods.every((m, i) => m === modules[i]);
        if (!same) {
          patch.modules = modules;
          changed = true;
        }
      }

      if (comment) {
        const note = appendNote(mat.internalNote, `[карта] ${comment}`);
        if (note !== mat.internalNote) {
          patch.internalNote = note;
          changed = true;
        }
      }

      if (!changed) {
        report.skipped.push({ id: mat.id, name: mat.name, reason: "без изменений" });
        continue;
      }

      report.updated.push({
        id: mat.id,
        from: mat.name,
        to: patch.name || mat.name,
        fields: Object.keys(patch),
        manual,
      });

      if (!dryRun) {
        updateMaterial(mat.id, patch);
        if (pKey) {
          db.prepare("UPDATE materials SET purchase_key = ? WHERE id = ?").run(pKey, mat.id);
        }
      }
    }
  }

  for (const [key, names] of mergeGroups) {
    if (names.length > 1 && !dryRun) {
      const mats = names.flatMap((n) => findMaterialByName(allMaterials, n));
      for (const m of mats) {
        db.prepare("UPDATE materials SET purchase_key = ? WHERE id = ?").run(key, m.id);
      }
    }
  }

  const reportPath = path.join(
    path.dirname(getDbPath()),
    `materials-map-report-${Date.now()}.json`
  );
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log("\n=== Отчёт ===");
  console.log("Обновлено:", report.updated.length);
  console.log("Не найдено:", report.notFound.length);
  console.log("Требует ручного решения:", report.manualReview.length);
  console.log("Конфликт модулей:", report.moduleConflicts.length);
  console.log("Конфликт разделов:", report.sectionConflicts.length);
  console.log("Архивные модули:", report.archivedModules.length);
  console.log("Без изменений:", report.skipped.length);
  if (report.legacyMigrated) console.log("Мигрировано legacy client_section:", report.legacyMigrated);
  console.log("Отчёт:", reportPath);

  if (report.notFound.length) {
    console.log("\nНе найдены (первые 10):");
    for (const x of report.notFound.slice(0, 10)) console.log(" -", x.sourceName);
  }
}

try {
  run();
} catch (e) {
  console.error("Ошибка:", e.message);
  process.exit(1);
}
