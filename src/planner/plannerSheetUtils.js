import { isRackKind } from "./rackProperties.js";

const RACK_FILTER = {
  all: () => true,
  nft: (it) => it.kind === "rack",
  flood: (it) => it.kind === "rack" && (it.h <= 650 || it.label?.toLowerCase().includes("подтоп")),
  seed: (it) => it.kind === "seed_rack",
  strawberry: (it) => it.kind === "rack" && it.label?.toLowerCase().includes("клубник"),
  aero: (it) => it.label?.toLowerCase().includes("аэропон"),
  storage: (it) => it.kind === "shelf_cons" || it.kind === "shelf_inv",
  pick: () => true,
};

const LINE_TAG_FILTER = (tag) => (line) => {
  if (!tag || tag === "all") return true;
  if (line.lineTag === tag) return true;
  if (tag === "power" && line.layer === "power" && !line.lineTag) return true;
  if (tag === "light" && line.layer === "light") return true;
  if (tag === "low" && line.lineTag === "low") return true;
  if (tag === "sensor" && line.lineTag === "sensor") return true;
  if (tag === "ground" && line.lineTag === "ground") return true;
  if (tag === "main" && line.lineTag === "main") return true;
  if (tag === "emergency" && line.lineTag === "emergency") return true;
  if (tag === "supply" && (line.lineTag === "supply" || line.traffic === "staff")) return line.lineTag === "supply";
  if (tag === "exhaust" && line.lineTag === "exhaust") return true;
  if (tag === "recirc" && line.lineTag === "recirc") return true;
  if (tag === "staff" && (line.traffic === "staff" || line.lineTag === "staff")) return true;
  if (tag === "raw" && line.traffic === "raw") return true;
  if (tag === "product" && line.traffic === "product") return true;
  if (tag === "waste" && (line.traffic === "waste" || line.lineTag === "waste")) return true;
  if (tag === "clean" && line.traffic === "clean") return true;
  if (tag === "dirty" && line.traffic === "dirty") return true;
  if (tag === "condensate" && line.lineTag === "condensate") return true;
  if (tag === "fans" && line.lineTag === "fan") return true;
  if (tag === "grilles" && line.lineTag === "grille") return true;
  if (tag === "solution" && line.layer === "irrigation") return true;
  if (tag === "clean" && line.layer === "irrigation" && line.lineTag === "clean") return true;
  return false;
};

const WATER_ITEM_FILTER = {
  all: () => true,
  clean: (it) => it.kind === "tank" && !it.label?.toLowerCase().includes("отход"),
  solution: (it) => it.kind === "tank" || it.kind === "pump",
  acid: (it) => it.label?.toLowerCase().includes("кислот"),
  fert_a: (it) => it.label?.toLowerCase().includes("удобр") && it.label?.includes("А"),
  fert_b: (it) => it.label?.toLowerCase().includes("удобр") && it.label?.includes("Б"),
  return: (it) => it.kind === "osmosis" || it.kind === "water_prep",
  pick: () => true,
};

export function getSheetFilters(sheet) {
  return sheet?.filters || [];
}

export function filterPlanItems(items, sheetId, filterId) {
  if (!filterId || filterId === "all" || filterId === "pick") return items;
  if (sheetId === "racks") {
    const fn = RACK_FILTER[filterId];
    return fn ? items.filter((it) => isRackKind(it.kind) || it.kind === "shelf_cons" || it.kind === "shelf_inv" ? fn(it) : true) : items;
  }
  if (sheetId === "water") {
    const fn = WATER_ITEM_FILTER[filterId];
    return fn ? items.filter((it) => ["tank", "pump", "osmosis", "water_prep"].includes(it.kind) ? fn(it) : true) : items;
  }
  return items;
}

export function filterPlanLines(lines, sheetId, filterId) {
  if (!filterId || filterId === "all" || filterId === "pick") return lines;
  const fn = LINE_TAG_FILTER(filterId);
  return lines.filter(fn);
}

export function toolStateFromDef(tool) {
  if (!tool) return { tool: "select", pending: null, pendingSize: null, lineLayer: null, lineTag: null, zoneFlow: null };
  if (tool.mode === "placeholder") return { tool: "select", pending: null, placeholder: tool };
  if (tool.mode === "add") {
    return {
      tool: "add",
      pending: tool.kind,
      pendingSize: tool.size || null,
      lineLayer: null,
      lineTag: tool.lineTag || null,
      zoneFlow: tool.zoneFlow || null,
    };
  }
  if (tool.mode === "line") {
    return {
      tool: "line",
      pending: null,
      lineLayer: tool.lineLayer || null,
      lineTag: tool.lineTag || null,
      zoneFlow: null,
    };
  }
  if (tool.mode === "zone") {
    return { tool: "zone", pending: null, zoneFlow: tool.zoneFlow || null };
  }
  return {
    tool: tool.mode || "select",
    pending: tool.kind || null,
    pendingSize: null,
    lineLayer: tool.lineLayer || null,
    lineTag: tool.lineTag || null,
    zoneFlow: tool.zoneFlow || null,
  };
}

export function isItemVisibleOnSheet(item, sheetId, filterId, activeLayer) {
  if (!filterId || filterId === "all") return true;
  if (sheetId === "racks" && (isRackKind(item.kind) || item.kind === "shelf_cons" || item.kind === "shelf_inv")) {
    const fn = RACK_FILTER[filterId];
    return fn ? fn(item) : true;
  }
  if (sheetId === "water" && ["tank", "pump", "osmosis", "water_prep"].includes(item.kind)) {
    const fn = WATER_ITEM_FILTER[filterId];
    return fn ? fn(item) : true;
  }
  return item.layer === activeLayer || filterId === "pick";
}

export function isLineVisibleOnSheet(line, sheetId, filterId) {
  if (!filterId || filterId === "all" || filterId === "pick") return true;
  return LINE_TAG_FILTER(filterId)(line);
}
