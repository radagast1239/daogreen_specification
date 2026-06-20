import { FARM_SECTIONS } from "../data/farmSections.js";

export function parseFarmSectionNames(namesJson) {
  try {
    return namesJson ? JSON.parse(namesJson) : {};
  } catch {
    return {};
  }
}

export function orderedFarmSections(orderJson, namesJson) {
  const names = parseFarmSectionNames(namesJson);
  let ids = [];
  try {
    if (orderJson) ids = JSON.parse(orderJson);
  } catch {
    ids = [];
  }
  const map = new Map(
    FARM_SECTIONS.map((s) => [
      s.id,
      {
        ...s,
        name: names[s.id] || s.name,
        module: names[s.id] || s.module,
      },
    ])
  );
  const out = [];
  for (const id of ids) {
    if (map.has(id)) out.push(map.get(id));
  }
  for (const s of FARM_SECTIONS) {
    if (!ids.includes(s.id)) out.push(map.get(s.id));
  }
  return out;
}

export function moveSectionOrder(orderJson, id, dir) {
  const sections = orderedFarmSections(orderJson);
  const ids = sections.map((s) => s.id);
  const i = ids.indexOf(id);
  if (i < 0) return JSON.stringify(ids);
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= ids.length) return JSON.stringify(ids);
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return JSON.stringify(ids);
}

export function patchFarmSectionName(namesJson, sectionId, newName) {
  const names = parseFarmSectionNames(namesJson);
  if (newName?.trim()) names[sectionId] = newName.trim();
  else delete names[sectionId];
  return JSON.stringify(names);
}
