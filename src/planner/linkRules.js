/** Блок 11 — правила инженерных связей между объектами. */

export const LINK_RULES = {
  irrigation: {
    label: "Полив",
    color: "#1f6f8b",
    layers: ["irrigation", "racks", "water"],
    from: new Set(["rack", "seed_rack", "pump"]),
    to: new Set(["tank", "pump", "osmosis", "water_prep"]),
  },
  power: {
    label: "Электрика",
    color: "#a5371f",
    layers: ["power", "sockets", "racks", "climate", "vent"],
    from: new Set([
      "socket", "rack", "seed_rack", "pump", "vent_unit", "blade_fan",
      "ac_indoor", "ac_outdoor", "ac_floor", "ac_duct", "fridge", "freezer", "recirc",
    ]),
    to: new Set(["panel"]),
  },
  light: {
    label: "Освещение",
    color: "#d4a017",
    layers: ["light", "power", "racks"],
    from: new Set(["light_panel", "rack", "seed_rack"]),
    to: new Set(["socket", "panel"]),
  },
  drain: {
    label: "Дренаж",
    color: "#7a5c3e",
    layers: ["drain", "sanitary", "water"],
    from: new Set([
      "trap", "sink_susp", "sink_table", "sink_double", "shower_pan", "shower_sys",
      "osmosis", "bidet", "toilet",
    ]),
    to: new Set(["trap"]),
  },
  water_supply: {
    label: "Водоснабжение",
    color: "#2f6f8f",
    layers: ["water", "sanitary"],
    from: new Set(["sink_susp", "sink_table", "sink_double", "shower_sys", "toilet", "bidet"]),
    to: new Set(["osmosis", "water_prep", "tank"]),
  },
  climate: {
    label: "Кондиционирование",
    color: "#5b7c9d",
    layers: ["climate", "vent"],
    from: new Set(["ac_indoor", "ac_floor", "ac_duct"]),
    to: new Set(["ac_outdoor"]),
  },
};

/** Основной тип связи для инструмента «Связь» на листе. */
export const LAYER_LINK_TYPE = {
  irrigation: "irrigation",
  racks: "irrigation",
  drain: "drain",
  power: "power",
  sockets: "power",
  light: "light",
  water: "water_supply",
  sanitary: "drain",
  climate: "climate",
  vent: "power",
};

export const LINK_TYPE_OPTIONS = Object.entries(LINK_RULES).map(([id, r]) => ({
  id,
  label: r.label,
}));

export function linkTypeForLayer(layerId) {
  if (LAYER_LINK_TYPE[layerId]) return LAYER_LINK_TYPE[layerId];
  const found = Object.entries(LINK_RULES).find(([, r]) => r.layers?.includes(layerId));
  return found ? found[0] : null;
}

export function linkTypesForLayer(layerId) {
  return Object.entries(LINK_RULES)
    .filter(([, r]) => r.layers?.includes(layerId))
    .map(([id]) => id);
}

export function canCreateLink(type, fromItem, toItem) {
  const rule = LINK_RULES[type];
  if (!rule || !fromItem || !toItem) return false;
  if (fromItem.id === toItem.id) return false;
  if (rule.from.has(fromItem.kind) && rule.to.has(toItem.kind)) return true;
  return rule.from.has(toItem.kind) && rule.to.has(fromItem.kind);
}

export function normalizeLinkEnds(type, fromItem, toItem) {
  const rule = LINK_RULES[type];
  if (!rule) return { from: fromItem, to: toItem };
  if (rule.from.has(fromItem.kind) && rule.to.has(toItem.kind)) return { from: fromItem, to: toItem };
  if (rule.from.has(toItem.kind) && rule.to.has(fromItem.kind)) return { from: toItem, to: fromItem };
  return { from: fromItem, to: toItem };
}

export function resolveLinkColor(link) {
  return link.color || LINK_RULES[link.type]?.color || "#5a5f5c";
}

export function linksVisibleOnLayer(links, activeLayer, display = {}) {
  if (display.showLinks === false) return [];
  if (activeLayer === "client") return [];
  const all = (links || []).filter((l) => l.visible !== false);
  if (activeLayer === "install") return all;
  return all.filter((l) => LINK_RULES[l.type]?.layers?.includes(activeLayer));
}

export function itemCenter(it) {
  return { x: it.x + it.w / 2, y: it.y + it.h / 2 };
}

/** Ближайший объект-цель для связи заданного типа. */
export function findNearestLinkTarget(items, fromItem, type, maxDist = 8000) {
  const rule = LINK_RULES[type];
  if (!rule || !fromItem) return null;
  const c = itemCenter(fromItem);
  let best = null;
  let bestD = maxDist;
  (items || []).forEach((it) => {
    if (it.id === fromItem.id) return;
    const target = rule.to.has(it.kind) || rule.from.has(it.kind);
    if (!target) return;
    const d = Math.hypot(itemCenter(it).x - c.x, itemCenter(it).y - c.y);
    if (d < bestD) {
      bestD = d;
      best = it;
    }
  });
  return best;
}

export function defaultLinkFields(type) {
  const rule = LINK_RULES[type];
  return {
    type,
    ortho: true,
    riseMm: null,
    visible: true,
    color: rule?.color || null,
    comment: "",
  };
}

export function buildLinkPayload(type, fromItem, toItem, id) {
  const ends = normalizeLinkEnds(type, fromItem, toItem);
  if (!canCreateLink(type, ends.from, ends.to)) return null;
  return {
    id,
    ...defaultLinkFields(type),
    fromId: ends.from.id,
    toId: ends.to.id,
  };
}

const SINK_KINDS = new Set(["sink_susp", "sink_table", "sink_double", "shower_pan", "shower_sys"]);
const AC_INDOOR = new Set(["ac_indoor", "ac_floor", "ac_duct"]);

export function collectLinkWarnings(plan) {
  const warnings = [];
  const items = plan.items || [];
  const links = plan.links || [];

  const hasLink = (itemId, type) => links.some((l) => (
    l.type === type && (l.fromId === itemId || l.toId === itemId)
  ));

  items.forEach((it) => {
    if (SINK_KINDS.has(it.kind)) {
      if (!hasLink(it.id, "drain")) {
        warnings.push({
          id: `link-drain-${it.id}`,
          severity: "warning",
          objectIds: [it.id],
          text: `${it.label}: нет связи дренажа`,
        });
      }
      if (!hasLink(it.id, "water_supply")) {
        warnings.push({
          id: `link-water-${it.id}`,
          severity: "warning",
          objectIds: [it.id],
          text: `${it.label}: не подключена к водоснабжению`,
        });
      }
    }
    if (it.kind === "osmosis" || it.kind === "water_prep") {
      if (!hasLink(it.id, "drain")) {
        warnings.push({
          id: `link-osmosis-drain-${it.id}`,
          severity: "warning",
          objectIds: [it.id],
          text: `${it.label}: нет дренажной связи`,
        });
      }
    }
    if (AC_INDOOR.has(it.kind) && !hasLink(it.id, "climate")) {
      warnings.push({
        id: `link-ac-${it.id}`,
        severity: "warning",
        objectIds: [it.id],
        text: `${it.label}: не связан с внешним блоком кондиционера`,
      });
    }
    if (it.kind === "light_panel" && !hasLink(it.id, "light") && !hasLink(it.id, "power")) {
      warnings.push({
        id: `link-light-${it.id}`,
        severity: "warning",
        objectIds: [it.id],
        text: `${it.label}: не подключён к розетке/щиту`,
      });
    }
    if ((it.kind === "vent_unit" || it.kind === "blade_fan") && !hasLink(it.id, "power")) {
      warnings.push({
        id: `link-vent-pwr-${it.id}`,
        severity: "warning",
        objectIds: [it.id],
        text: `${it.label}: нет электрической связи с щитом`,
      });
    }
  });

  return warnings;
}

/** Подсказки целей для ПКМ «назначить связь». */
export const RACK_LINK_ACTIONS = [
  { id: "rack-link-tank", type: "irrigation", label: "Привязать к баку", targetKinds: ["tank", "osmosis", "water_prep"] },
  { id: "rack-link-pump", type: "irrigation", label: "Привязать к насосу", targetKinds: ["pump"] },
  { id: "rack-link-socket", type: "power", label: "Привязать к розетке/щиту", targetKinds: ["socket", "panel"] },
  { id: "rack-link-light", type: "light", label: "Привязать к освещению", targetKinds: ["light_panel", "socket"] },
];

export function findRackLinkTarget(items, rack, action) {
  const rule = LINK_RULES[action.type];
  if (!rule) return null;
  const kinds = new Set(action.targetKinds);
  const c = itemCenter(rack);
  let best = null;
  let bestD = Infinity;
  items.forEach((it) => {
    if (it.id === rack.id || !kinds.has(it.kind)) return;
    const d = Math.hypot(itemCenter(it).x - c.x, itemCenter(it).y - c.y);
    if (d < bestD) {
      bestD = d;
      best = it;
    }
  });
  return best;
}
