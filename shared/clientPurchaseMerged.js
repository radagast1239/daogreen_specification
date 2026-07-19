/** Склейка клиентских строк закупки — единая точка для UI / PDF / Excel / preview. */

import { purchaseMergeKey } from "./purchaseMerge.js";
import { resolveClientSection } from "./clientSections.js";
import {
  isProfilePipeName,
  mergePipeCutsFromItems,
  pipeCutsClientNote,
  resolveStellageCountForProjectItem,
} from "./profilePipeCuts.js";
import {
  mergeClientItemNotes,
  resolveClientItemNote,
} from "./clientPurchaseRows.js";
import { lineContributesToSum } from "./itemTypes.js";
import { buildPurchaseStatusSummary } from "./purchaseStatusRules.js";
import { isFrameBomLine } from "./frameBomProjectItems.js";

function lineNet(it) {
  if (!lineContributesToSum(it)) return 0;
  return (Number(it.qty) || 0) * (Number(it.price) || 0);
}

function lineGross(it) {
  const net = lineNet(it);
  return net + net * ((Number(it.vatRate) || 0) / 100);
}

function resolveMergedSupplier(items) {
  for (const it of items || []) {
    const s = (it.supplier || "").trim();
    if (s) return s;
  }
  return "";
}

function resolveMergedLink(items) {
  for (const it of items || []) {
    const u = (it.link || "").trim();
    if (u) return u;
  }
  return "";
}

function pickMergedPhoto(items) {
  for (const it of items || []) {
    const u = it?.imageUrl || it?.photoUrl;
    if (u) return u;
  }
  return "";
}

function formatQtyShort(qty) {
  const v = Number(qty) || 0;
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

function buildMergedSourceText(row) {
  const unit = row.unit || "шт.";
  const sources = row.sources || [];
  const mods = [...new Set(sources.map((s) => s.module).filter(Boolean))];
  const detail = sources
    .map((s) => `${s.module || "Раздел"} — ${formatQtyShort(s.qty)} ${unit}`)
    .join("; ");
  if (mods.length <= 1) return detail;
  const stellage = mods.every((m) => /^стеллаж/i.test(String(m).trim()));
  const noun = stellage ? "стеллажей" : "модулей";
  return `из ${mods.length} ${noun}: ${detail}`;
}

function finalizeMergedRow(row, options = {}) {
  const stellageConfigs = options.stellageConfigs || [];
  const rep = row.sourceItems?.[0];
  row.supplier = resolveMergedSupplier(row.sourceItems) || row.supplier || "";
  row.link = resolveMergedLink(row.sourceItems) || row.link || "";
  row.imageUrl = row.imageUrl || pickMergedPhoto(row.sourceItems);
  const resolved = resolveClientSection(rep || {});
  row.clientSection = resolved.section;
  row.clientSubsection = resolved.subsection || row.clientSubsection || "";
  row.clientSectionLabel = resolved.label;
  row.sourceIds = row.sourceItems.map((i) => i.id);
  row.sourceCount = row.sourceItems.length;
  for (const s of row.sources) {
    s.unit = row.unit;
  }
  row.sourceText = buildMergedSourceText(row);
  row.statusSummary = buildPurchaseStatusSummary(row.sourceItems);
  row.status = row.statusSummary.status;
  row.statusLabel = row.statusSummary.statusLabel;
  if (isProfilePipeName(row.name) && row.sourceItems?.length) {
    // Catalog/builder pipes store per-rack segments; qty is already × count.
    // Frame BOM pipeCuts are already scaled when added to the project.
    const mergedCuts = mergePipeCutsFromItems(row.sourceItems, {
      scaleOf: (it) =>
        isFrameBomLine(it) ? 1 : resolveStellageCountForProjectItem(it, stellageConfigs),
    });
    if (mergedCuts.length) {
      row.pipeCuts = mergedCuts;
      row.clientNote = pipeCutsClientNote(mergedCuts);
    }
  } else {
    const mergedNote = mergeClientItemNotes(row.sourceItems);
    if (mergedNote) row.clientNote = mergedNote;
    else if (!row.clientNote) row.clientNote = resolveClientItemNote(rep || {}) || rep?.clientNote || "";
  }
  return row;
}

export function buildClientPurchaseMergedRows(items, options = {}) {
  const map = new Map();
  for (const it of items || []) {
    const key = purchaseMergeKey(it);
    if (!map.has(key)) {
      map.set(key, {
        mergeKey: key,
        name: it.name,
        unit: it.unit,
        category: it.category,
        clientSection: it.clientSection,
        clientSubsection: it.clientSubsection,
        supplier: it.supplier,
        link: it.link,
        imageUrl: it.imageUrl || it.photoUrl,
        clientNote: it.clientNote,
        price: it.price,
        vatRate: it.vatRate,
        qty: 0,
        sum: 0,
        sumVat: 0,
        sources: [],
        sourceItems: [],
      });
    }
    const row = map.get(key);
    row.qty += Number(it.qty) || 0;
    row.sum += lineNet(it);
    row.sumVat += lineGross(it);
    if (!row.imageUrl && (it.imageUrl || it.photoUrl)) {
      row.imageUrl = it.imageUrl || it.photoUrl;
    }
    row.sources.push({ id: it.id, module: it.module, qty: Number(it.qty) || 0, unit: it.unit });
    row.sourceItems.push(it);
  }
  return [...map.values()].map((row) => finalizeMergedRow(row, options)).sort((a, b) => b.sumVat - a.sumVat);
}
