import { DONE_STATUSES } from "../data/modules.js";
import {
  lineNet,
  lineVat,
  lineGross,
  clientVisibleItems,
  projectBudgetItems,
  clientPurchaseItems,
  buildMergedSourceText,
  summarizeMergedStatus,
} from "../lib/itemHelpers.js";
import { lineVisibleToClient } from "../../shared/itemTypes.js";
import { resolveClientSection } from "../../shared/clientSections.js";

import { uid as makeUid } from "../lib/ids.js";

export const uid = makeUid;

export const money = (n, currency = "₽") => {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString("ru-RU") + " " + currency;
};

export const num = (n) => {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
};

const factGross = (it) => {
  const q = Number(it.qty) || 0;
  const p = it.actualPrice != null ? Number(it.actualPrice) : Number(it.price) || 0;
  const net = q * p;
  return net + net * ((Number(it.vatRate) || 0) / 100);
};

export function projectTotals(project) {
  const budgetItems = projectBudgetItems(project);
  const budgetNet = budgetItems.reduce((s, i) => s + lineNet(i), 0);
  const vatAmount = budgetItems.reduce((s, i) => s + lineVat(i), 0);
  const budget = budgetNet + vatAmount;
  const visible = clientVisibleItems(project);
  const purchasePool = clientPurchaseItems(project);
  const done = purchasePool.filter((i) => DONE_STATUSES.includes(i.status));
  const spent = done.reduce((s, i) => s + factGross(i), 0);
  const doneCount = done.length;
  const total = purchasePool.length;
  const progress = total ? Math.round((doneCount / total) * 100) : 0;
  const remaining = Math.max(budget - spent, 0);
  const overrun = Math.max(spent - budget, 0);
  let economy = 0;
  for (const i of done) {
    const planned = lineGross(i);
    const actual = factGross(i);
    if (actual < planned) economy += planned - actual;
  }
  return { budgetNet, vatAmount, budget, spent, remaining, overrun, economy, progress, total, doneCount };
}

export function projectStats(project) {
  const items = project.items || [];
  return {
    total: items.length,
    approved: items.filter((i) => lineVisibleToClient(i)).length,
    hidden: items.filter((i) => i.includedInProject !== false && i.enabled !== false && !lineVisibleToClient(i)).length,
    disabled: items.filter((i) => i.includedInProject === false || i.enabled === false || (Number(i.qty) || 0) === 0).length,
    noPrice: items.filter((i) => !i.price).length,
    noLink: items.filter((i) => !i.link).length,
    noImage: items.filter((i) => !i.imageUrl && !i.photoUrl).length,
    noSupplier: items.filter((i) => !i.supplier).length,
  };
}

export function groupBy(items, key) {
  const map = new Map();
  for (const it of items) {
    const k = it[key] || "Прочее";
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(it);
  }
  return [...map.entries()];
}

import { purchaseMergeKey } from "../../shared/purchaseMerge.js";

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
function finalizeMergedRow(row) {
  const rep = row.sourceItems?.[0];
  row.supplier = resolveMergedSupplier(row.sourceItems) || row.supplier || "";
  row.link = resolveMergedLink(row.sourceItems) || row.link || "";
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
  row.statusSummary = summarizeMergedStatus(row.sourceItems);
  row.status = row.statusSummary.status;
  if (!row.clientNote && rep?.clientNote) row.clientNote = rep.clientNote;
  return row;
}

export function mergedPurchaseRows(items) {
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
    row.sources.push({ id: it.id, module: it.module, qty: Number(it.qty) || 0, unit: it.unit });
    row.sourceItems.push(it);
  }
  return [...map.values()].map(finalizeMergedRow).sort((a, b) => b.sumVat - a.sumVat);
}

/** Склеенные строки для клиентского UI / Excel / PDF */
export function mergedItemsForClient(project, items) {
  const pool = items ?? clientPurchaseItems(project);
  return mergedPurchaseRows(pool);
}

export function mergedPurchaseList(project) {
  return mergedItemsForClient(project);
}
