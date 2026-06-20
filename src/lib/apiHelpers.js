import { uid } from "../store/helpers.js";
import { defaultResponsible } from "./itemHelpers.js";

export { uid };

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
    clientNote: mat.clientNote || mat.comment || "",
    techNote: mat.techNote || "",
    comment: mat.clientNote || mat.techNote || mat.comment || "",
    qty,
    price: Number(mat.basePrice) || 0,
    vatRate: [0, 5, 20].includes(Number(mat.vatRate)) ? Number(mat.vatRate) : 0,
    responsible: mat.responsible || defaultResponsible(mat.category, mat),
    visible: isZero ? false : mat.clientVisibleDefault !== false,
    approved: false,
    enabled: !isZero,
    needsApproval: !!mat.needsApproval,
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
      const baseQty = Number(mat.defaultQty) || 0;
      const qty = mod.type === "stellage" ? Math.round(baseQty * count * 100) / 100 : baseQty;
      items.push(itemFromMaterial(mat, mod, qty, order++));
    }
  }
  return items;
}
