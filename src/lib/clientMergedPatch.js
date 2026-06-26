/** Патч одной или нескольких строк merge (bulk на бэкенде). */
export function patchMergedRow(patch, patchBulk, row, payload) {
  const sources = row?.sourceItems || [];
  if (!sources.length) return Promise.resolve();
  const ids = sources.map((it) => it.id);
  if (ids.length === 1) return patch(ids[0], payload);
  if (patchBulk) return patchBulk(ids, payload);
  return Promise.all(ids.map((id) => patch(id, payload)));
}
