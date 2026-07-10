/** Similar-material warnings before creating a new catalog entry. */

function normName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normUnit(unit) {
  return String(unit || "").trim().toLowerCase();
}

/**
 * @param {object} draft — { name, unit, supplier, link, sku, article }
 * @param {object[]} materials
 * @param {object} [options]
 * @param {number} [options.limit]
 */
export function findSimilarMaterials(draft, materials = [], options = {}) {
  const limit = options.limit ?? 8;
  const name = normName(draft?.name);
  const unit = normUnit(draft?.unit);
  const supplier = String(draft?.supplier || "").trim().toLowerCase();
  const link = String(draft?.link || "").trim().toLowerCase();
  const sku = String(draft?.sku || draft?.article || "").trim().toLowerCase();

  if (!name && !sku) return [];

  const scored = [];
  for (const mat of materials) {
    const matName = normName(mat.name);
    let score = 0;
    const reasons = [];

    if (sku) {
      const matSku = String(mat.sku || mat.article || "").trim().toLowerCase();
      if (matSku && matSku === sku) {
        score += 100;
        reasons.push("артикул");
      }
    }

    if (name && matName) {
      if (matName === name) {
        score += 80;
        reasons.push("название");
      } else if (matName.includes(name) || name.includes(matName)) {
        score += 40;
        reasons.push("похожее название");
      }
    }

    if (unit && normUnit(mat.unit) === unit) {
      score += 10;
      reasons.push("единица");
    }
    if (supplier && String(mat.supplier || "").trim().toLowerCase() === supplier) {
      score += 8;
      reasons.push("поставщик");
    }
    if (link && String(mat.link || "").trim().toLowerCase() === link) {
      score += 8;
      reasons.push("ссылка");
    }

    if (score >= 40) {
      scored.push({ material: mat, score, reasons });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ material, score, reasons }) => ({
      id: material.id,
      name: material.name,
      unit: material.unit,
      supplier: material.supplier || "",
      link: material.link || "",
      score,
      reasons,
    }));
}

/**
 * @param {object} draft
 * @param {object[]} materials
 */
export function buildDuplicateMaterialWarning(draft, materials = []) {
  const similar = findSimilarMaterials(draft, materials);
  if (!similar.length) return null;
  return {
    similar,
    message: `Найдено ${similar.length} похожих материалов в базе. Проверьте перед созданием нового.`,
  };
}
