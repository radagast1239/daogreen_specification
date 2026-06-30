/**
 * Аудит склейки закупки для проекта (JSON из API или backup).
 *
 * Usage:
 *   node scripts/auditClientPurchase.js backend/data/project-live.json
 *   node scripts/auditClientPurchase.js path/to/export.json --project "Алексей тест"
 */

import fs from "fs";
import { purchaseMergeKey, findPurchaseDuplicateGroups } from "../shared/purchaseMerge.js";
import { mergedPurchaseRows } from "../src/store/helpers.js";
import { clientPurchaseItems, lineVisibleToClient } from "../src/lib/itemHelpers.js";
import { resolveClientSection } from "../shared/clientSections.js";

function normName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/×/g, "x")
    .replace(/,/g, ".")
    .replace(/\s+/g, " ");
}

function normSupplier(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/ozon\/wb|ozon wb/gi, "ozon")
    .replace(/\s+/g, " ");
}

function loadProject(filePath, nameFilter) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const projects = Array.isArray(raw) ? raw : raw.projects ? raw.projects : [raw];
  if (nameFilter) {
    const re = new RegExp(nameFilter, "i");
    const hit = projects.find((p) => re.test(p.name || "") || re.test(p.client || ""));
    if (!hit) throw new Error(`Project not found matching: ${nameFilter}`);
    return hit;
  }
  return projects[0];
}

function nearDuplicateGroups(items) {
  const byNameUnit = new Map();
  for (const it of items) {
    const nk = `${normName(it.name)}|${(it.unit || "").toLowerCase()}`;
    if (!byNameUnit.has(nk)) byNameUnit.set(nk, []);
    byNameUnit.get(nk).push(it);
  }
  return [...byNameUnit.entries()]
    .filter(([, g]) => {
      if (g.length < 2) return false;
      const keys = new Set(g.map(purchaseMergeKey));
      return keys.size > 1;
    })
    .map(([nk, g]) => ({ nameUnit: nk, items: g, keys: [...new Set(g.map(purchaseMergeKey))] }));
}

function supplierMismatchGroups(items) {
  const byNameUnit = new Map();
  for (const it of items) {
    const nk = `${normName(it.name)}|${(it.unit || "").toLowerCase()}`;
    if (!byNameUnit.has(nk)) byNameUnit.set(nk, []);
    byNameUnit.get(nk).push(it);
  }
  return [...byNameUnit.entries()]
    .filter(([, g]) => {
      if (g.length < 2) return false;
      const suppliers = new Set(g.map((i) => normSupplier(i.supplier)));
      return suppliers.size > 1;
    })
    .map(([nk, g]) => ({
      nameUnit: nk,
      suppliers: [...new Set(g.map((i) => i.supplier || "—"))],
      count: g.length,
    }));
}

function audit(project) {
  const all = project.items || [];
  const visible = all.filter(lineVisibleToClient);
  const hidden = all.length - visible.length;
  const purchase = clientPurchaseItems({ items: visible });
  const merged = mergedPurchaseRows(purchase);
  const mergedGroups = findPurchaseDuplicateGroups(purchase);
  const near = nearDuplicateGroups(purchase);
  const supplierSplit = supplierMismatchGroups(purchase);

  const sectionRaw = new Map();
  const sectionMerged = new Map();
  for (const it of purchase) {
    const { label } = resolveClientSection(it);
    sectionRaw.set(label, (sectionRaw.get(label) || 0) + 1);
  }
  for (const row of merged) {
    const label = row.clientSectionLabel || "Прочее";
    sectionMerged.set(label, (sectionMerged.get(label) || 0) + 1);
  }

  const mergedIds = new Set();
  for (const row of merged) {
    for (const it of row.sourceItems || []) mergedIds.add(it.id);
  }
  const notInMerged = purchase.filter((it) => !mergedIds.has(it.id));

  return {
    project: { name: project.name, version: project.version, client: project.client },
    counts: {
      totalItems: all.length,
      hiddenFromClient: hidden,
      purchaseLines: purchase.length,
      mergedLines: merged.length,
      savedByMerge: purchase.length - merged.length,
      successfullyMergedGroups: mergedGroups.length,
      nearDuplicateGroups: near.length,
      supplierSplitGroups: supplierSplit.length,
    },
    pdfFullEstimate: {
      generalListRows: merged.length,
      bySectionRows: merged.length,
      approxTotalTableRows: merged.length * 2 + merged.length * 0.8,
      note: "Полный PDF повторяет те же merged-строки в нескольких блоках — это не ошибка склейки",
    },
    nearDuplicates: near.slice(0, 30).map((g) => ({
      name: g.nameUnit.split("|")[0],
      unit: g.nameUnit.split("|")[1],
      lines: g.items.length,
      mergeKeys: g.keys.length,
      modules: [...new Set(g.items.map((i) => i.module))],
      suppliers: [...new Set(g.items.map((i) => i.supplier || "—"))],
      reasons: g.items.map((i) => ({
        module: i.module,
        supplier: i.supplier || "—",
        link: (i.link || "").slice(0, 60),
        key: purchaseMergeKey(i),
      })),
    })),
    supplierSplits: supplierSplit.slice(0, 20),
    sections: [...sectionRaw.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, raw]) => ({ label, raw, merged: sectionMerged.get(label) || 0 })),
    anomalies: {
      notInMergedCount: notInMerged.length,
    },
  };
}

const file = process.argv[2];
const nameIdx = process.argv.indexOf("--project");
const nameFilter = nameIdx >= 0 ? process.argv[nameIdx + 1] : "";

if (!file) {
  console.error("Usage: node scripts/auditClientPurchase.js <project.json> [--project name]");
  process.exit(1);
}

const project = loadProject(file, nameFilter);
const report = audit(project);
console.log(JSON.stringify(report, null, 2));
