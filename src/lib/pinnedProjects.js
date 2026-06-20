const KEY = "daogreen-pinned-projects";

export function getPinnedIds() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function isPinned(id) {
  return getPinnedIds().includes(id);
}

export function togglePinned(id) {
  const cur = getPinnedIds();
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [id, ...cur];
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function sortWithPinned(projects, pinned = getPinnedIds()) {
  const pinSet = new Set(pinned);
  return [...projects].sort((a, b) => {
    const ap = pinSet.has(a.id) ? 0 : 1;
    const bp = pinSet.has(b.id) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return (b.updatedAt || "").localeCompare(a.updatedAt || "");
  });
}
