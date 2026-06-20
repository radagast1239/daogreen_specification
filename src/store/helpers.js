import { DONE_STATUSES } from "../data/modules.js";
import { lineNet, lineVat, lineGross, clientVisibleItems } from "../lib/itemHelpers.js";

export const uid = (p = "id") =>
  p + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

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
  const visible = clientVisibleItems(project);
  const budgetNet = visible.reduce((s, i) => s + lineNet(i), 0);
  const vatAmount = visible.reduce((s, i) => s + lineVat(i), 0);
  const budget = budgetNet + vatAmount;
  const done = visible.filter((i) => DONE_STATUSES.includes(i.status));
  const spent = done.reduce((s, i) => s + factGross(i), 0);
  const doneCount = done.length;
  const total = visible.length;
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
    approved: items.filter((i) => i.approved).length,
    hidden: items.filter((i) => !i.visible).length,
    disabled: items.filter((i) => !i.enabled || (Number(i.qty) || 0) === 0).length,
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

export function mergedPurchaseList(project) {
  const map = new Map();
  for (const it of clientVisibleItems(project)) {
    const key = (it.name || "").trim().toLowerCase() + "|" + (it.unit || "").toLowerCase();
    if (!map.has(key)) {
      map.set(key, {
        name: it.name,
        unit: it.unit,
        category: it.category,
        supplier: it.supplier,
        link: it.link,
        imageUrl: it.imageUrl || it.photoUrl,
        price: it.price,
        vatRate: it.vatRate,
        qty: 0,
        sum: 0,
        sumVat: 0,
        sources: [],
      });
    }
    const row = map.get(key);
    row.qty += Number(it.qty) || 0;
    row.sum += lineNet(it);
    row.sumVat += lineGross(it);
    row.sources.push({ module: it.module, qty: Number(it.qty) || 0 });
  }
  return [...map.values()].sort((a, b) => b.sumVat - a.sumVat);
}
