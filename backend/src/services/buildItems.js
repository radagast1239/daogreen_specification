import { nanoid } from "nanoid";
import crypto from "crypto";
import { materialIncludedInSelection } from "../../../shared/stellageComposition.js";

export const uid = (prefix = "id") => `${prefix}_${nanoid(10)}`;

/** ≥128 бит энтропии для клиентской ссылки (OWASP session ID) */
export function clientToken() {
  return crypto.randomBytes(24).toString("base64url");
}

const RESP = {
  "Полив и сантехника": "plumber",
  "Электрика и свет": "electrician",
  "Каркас и крепёж": "installer",
  "Климат и вентиляция": "installer",
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
    visible: isZero ? false : mat.clientVisibleDefault !== false,
    approved: false,
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
    const mats = materials.filter((m) => m.module === mod.name && m.status === "active");
    for (const mat of mats) {
      if (!materialIncludedInSelection(mat, sel)) continue;
      const baseQty = Number(mat.defaultQty) || 0;
      const qty = mod.type === "stellage" ? Math.round(baseQty * count * 100) / 100 : baseQty;
      items.push(itemFromMaterial(mat, mod, qty, order++));
    }
  }
  return items;
}

const DONE = ["bought", "delivered", "have"];

export function lineNet(it) {
  return (Number(it.qty) || 0) * (Number(it.price) || 0);
}

export function lineVat(it) {
  return lineNet(it) * ((Number(it.vatRate) || 0) / 100);
}

export function lineGross(it) {
  return lineNet(it) + lineVat(it);
}

const factSum = (it) =>
  (Number(it.qty) || 0) * (it.actualPrice != null ? Number(it.actualPrice) : Number(it.price) || 0);

export function projectTotals(items) {
  const visible = items.filter((i) => i.approved && i.visible && i.enabled);
  const budgetNet = visible.reduce((s, i) => s + lineNet(i), 0);
  const vatAmount = visible.reduce((s, i) => s + lineVat(i), 0);
  const budget = budgetNet + vatAmount;
  const spent = visible
    .filter((i) => DONE.includes(i.status))
    .reduce((s, i) => s + factSum(i), 0);
  const doneCount = visible.filter((i) => DONE.includes(i.status)).length;
  const total = visible.length;
  const progress = total ? Math.round((doneCount / total) * 100) : 0;
  return { budgetNet, vatAmount, budget, spent, remaining: Math.max(budget - spent, 0), progress, total, doneCount };
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
