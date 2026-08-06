import { nanoid } from "nanoid";
import crypto from "crypto";
import { materialIncludedInSelection } from "../../../shared/stellageComposition.js";
import { materialInModule } from "../../../shared/materialModules.js";
import { lineContributesToSum, lineVisibleToClient, resolveItemType } from "../../../shared/itemTypes.js";
import {
  calculatePurchaseSummary,
  computeItemsMoney,
} from "../../../shared/moneyCalc.js";

export const uid = (prefix = "id") => `${prefix}_${nanoid(10)}`;

/** ≥128 бит энтропии для клиентской ссылки (OWASP session ID) */
export function clientToken() {
  return crypto.randomBytes(24).toString("base64url");
}

const RESP = {
  "Полив и сантехника": "plumber",
  "Электрика и свет": "electrician",
  "Каркас и крепёж": "installer",
  "Климат и вентиляция": "climate",
  Расходники: "consumables",
};

function defaultResponsible(category, mat) {
  if (mat?.isConsumable || category === "Расходники") return "consumables";
  return RESP[category] || "general";
}

function itemFromMaterial(mat, mod, qty, order) {
  const baseQty = Number(mat.defaultQty) || 0;
  const isZero = baseQty === 0 || qty === 0;
  const img = mat.imageUrl || mat.photoUrl || "";
  return {
    id: uid("it"),
    materialId: mat.id,
    module: mod.name,
    section: mod.section || mod.name,
    name: mat.name,
    unit: mat.unit,
    category: mat.category,
    purchaseKey: mat.purchaseKey || "",
    clientSection: mat.clientSection || "",
    clientSubsection: mat.clientSubsection || "",
    supplier: mat.supplier || "",
    link: mat.link || "",
    linkAlt: mat.linkAlt || "",
    imageUrl: img,
    photoUrl: img,
    clientNote: mat.clientNote || "",
    techNote: mat.techNote || "",
    comment: mat.clientNote || mat.techNote || "",
    qty,
    price: Number(mat.basePrice) || 0,
    vatRate: [0, 5, 20].includes(Number(mat.vatRate)) ? Number(mat.vatRate) : 0,
    subcategory: mat.subcategory || "",
    itemType: resolveItemType({ itemType: mat.itemType }),
    includedInProject: !isZero,
    visibleToClient: !isZero && mat.clientVisibleDefault !== false,
    visible: isZero ? false : mat.clientVisibleDefault !== false,
    approved: !isZero && mat.clientVisibleDefault !== false,
    enabled: !isZero,
    needsApproval: !!mat.needsApproval,
    isConsumable: !!mat.isConsumable,
    responsible: mat.responsible || defaultResponsible(mat.category, mat),
    status: "not_bought",
    actualPrice: null,
    clientComment: "",
    sortOrder: order,
  };
}

export function buildItemsFromModules(materials, modules, selected) {
  const items = [];
  let order = 0;
  for (const sel of selected) {
    const mod = modules.find((m) => m.id === sel.moduleId);
    if (!mod) continue;
    const count = mod.type === "stellage" ? Math.max(1, Number(sel.count) || 1) : 1;
    const mats = materials.filter((m) => materialInModule(m, mod.name) && m.status === "active");
    for (const mat of mats) {
      if (!materialIncludedInSelection(mat, sel)) continue;
      const baseQty = Number(mat.defaultQty) || 0;
      const qty = mod.type === "stellage" ? Math.round(baseQty * count * 100) / 100 : baseQty;
      items.push(itemFromMaterial(mat, mod, qty, order++));
    }
  }
  return items;
}

export function lineNet(it) {
  return (Number(it.qty) || 0) * (Number(it.price) || 0);
}

export function lineVat(it) {
  return lineNet(it) * ((Number(it.vatRate) || 0) / 100);
}

export function lineGross(it) {
  return lineNet(it) + lineVat(it);
}

/**
 * Admin/API project totals — same purchase contract as frontend helpers.projectTotals.
 * Accepts an items array (legacy) or a project-like `{ items }`.
 */
export function projectTotals(itemsOrProject) {
  const items = Array.isArray(itemsOrProject)
    ? itemsOrProject
    : itemsOrProject?.items || [];
  const budgetAgg = computeItemsMoney(
    items.filter((i) => lineContributesToSum(i)),
    { priceMode: "planned", contributeCheck: false },
  );
  const purchase = calculatePurchaseSummary(items);
  return {
    budgetNet: budgetAgg.netTotal,
    vatAmount: budgetAgg.vatTotal,
    budget: budgetAgg.grossTotal,
    spent: purchase.spentGross,
    remaining: purchase.remainingGross,
    progress: purchase.progressPercent,
    total: purchase.purchasePoolCount,
    doneCount: purchase.completedCount,
  };
}

export function compareVersions(oldItems, newItems) {
  const oldMap = new Map(oldItems.map((i) => [i.id, i]));
  const newMap = new Map(newItems.map((i) => [i.id, i]));
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const [id, it] of newMap) {
    if (!oldMap.has(id)) added++;
    else {
      const o = oldMap.get(id);
      if (o.qty !== it.qty || o.price !== it.price || o.name !== it.name) changed++;
    }
  }
  for (const id of oldMap.keys()) {
    if (!newMap.has(id)) removed++;
  }
  const sumBefore = projectTotals(oldItems).budget;
  const sumAfter = projectTotals(newItems).budget;
  return { added, removed, changed, sumBefore, sumAfter, delta: sumAfter - sumBefore };
}
