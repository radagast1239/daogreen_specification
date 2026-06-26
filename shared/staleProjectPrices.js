/** Позиции проекта, у которых цена в базе материалов изменилась */

export function findStaleProjectPrices(items, materials) {
  const matMap = new Map((materials || []).map((m) => [m.id, m]));
  const stale = [];
  for (const it of items || []) {
    if (!it?.materialId) continue;
    const mat = matMap.get(it.materialId);
    if (!mat) continue;
    const projectPrice = Number(it.price) || 0;
    const materialPrice = Number(mat.basePrice) || 0;
    if (projectPrice !== materialPrice) {
      stale.push({
        itemId: it.id,
        itemName: it.name,
        materialId: it.materialId,
        projectPrice,
        materialPrice,
        delta: materialPrice - projectPrice,
      });
    }
  }
  return stale;
}
