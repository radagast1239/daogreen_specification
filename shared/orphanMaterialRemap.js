/**
 * Перепривязка устаревших materialId (старая нумерация Excel) к текущей базе.
 * Только чтение materials — таблицу материалов не меняет.
 */

/** Проверенные вручную соответствия oldId → newId */
export const LEGACY_MATERIAL_ID_MAP = {
  m001: "m036",
  m021: "m141",
  m035: "m104",
  m037: "m071",
  m038: "m072",
  m039: "m073",
  m040: "m074",
  m041: "m075",
  m042: "m076",
  m043: "m077",
  m049: "m128",
  m050: "m144",
  m051: "m129",
  m052: "m110",
  m053: "m117",
  m054: "m118",
  m059: "m164",
  m064: "m033",
  m068: "m032",
  m069: "m030",
  m085: "m144",
  m105: "m066",
  m106: "m067",
  "m_-wgzPpZL3j": "m063",
  m165: "m164",
  m167: "m168",
  m177: "m121",
};

export function normMaterialName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/×/g, "x")
    .replace(/[х*]/g, "x")
    .replace(/-/g, " ")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function findMaterialByName(name, materials) {
  const n = normMaterialName(name);
  if (!n) return null;
  const exact = materials.find((m) => normMaterialName(m.name) === n);
  if (exact) return exact;
  const tokens = n.split(" ").filter((t) => t.length > 2);
  let best = null;
  let bestScore = 0;
  for (const m of materials) {
    const mn = normMaterialName(m.name);
    if (!mn) continue;
    if (mn.includes(n) || n.includes(mn)) {
      const score = Math.min(mn.length, n.length);
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
      continue;
    }
    const hit = tokens.filter((t) => mn.includes(t)).length;
    const score = hit / tokens.length;
    if (score >= 0.65 && score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}

/** @returns {string|null} новый id или null если не найден */
export function resolveOrphanMaterialId(oldId, name, materials, materialIds) {
  if (!oldId) return null;
  if (materialIds.has(oldId)) return oldId;
  if (LEGACY_MATERIAL_ID_MAP[oldId] && materialIds.has(LEGACY_MATERIAL_ID_MAP[oldId])) {
    return LEGACY_MATERIAL_ID_MAP[oldId];
  }
  const hit = findMaterialByName(name, materials);
  return hit?.id && materialIds.has(hit.id) ? hit.id : null;
}

export function hydrateLineFromMaterial(ln, mat) {
  if (!mat) return ln;
  const img = mat.imageUrl || mat.photoUrl || "";
  return {
    ...ln,
    materialId: mat.id,
    name: mat.name,
    unit: mat.unit || ln.unit,
    category: mat.category || ln.category,
    supplier: mat.supplier || ln.supplier || "",
    link: mat.link || ln.link || "",
    linkAlt: mat.linkAlt || ln.linkAlt || "",
    imageUrl: img || ln.imageUrl || "",
    photoUrl: img || ln.photoUrl || "",
    price: Number(mat.basePrice) || Number(ln.price) || 0,
    vatRate: [0, 5, 20].includes(Number(mat.vatRate)) ? Number(mat.vatRate) : Number(ln.vatRate) || 0,
    techNote: mat.techNote ?? ln.techNote ?? "",
    clientNote: mat.clientNote ?? ln.clientNote ?? "",
    clientSection: mat.clientSection || ln.clientSection || "",
    clientSubsection: mat.clientSubsection || ln.clientSubsection || "",
  };
}

export function projectItemPatchFromMaterial(mat) {
  const img = mat.imageUrl || mat.photoUrl || "";
  const clientNote = mat.clientNote || "";
  return {
    material_id: mat.id,
    name: mat.name,
    unit: mat.unit,
    category: mat.category,
    supplier: mat.supplier || "",
    link: mat.link || "",
    link_alt: mat.linkAlt || "",
    photo_url: img,
    client_note: clientNote,
    tech_note: mat.techNote || "",
    price: Number(mat.basePrice) || 0,
    vat_rate: [0, 5, 20].includes(Number(mat.vatRate)) ? Number(mat.vatRate) : 0,
    client_section: mat.clientSection || "",
    client_subsection: mat.clientSubsection || "",
  };
}
