import { isRackKind } from "./rackProperties.js";
import { resolveToolPendingSize } from "./plannerMaterialPresets.js";
import { objectVisibleOnSheet, resolveSheetId } from "./plannerSheets.js";

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
  if (tag === "duct" && (line.type === "duct" || line.layer === "vent" || line.lineTag === "duct")) return true;
  if (tag === "airflow" && (line.lineTag === "airflow" || line.lineTag === "airflow_arrow" || line.lineType === "airflow_arrow")) return true;
  if (tag === "staff" && (line.traffic === "staff" || line.lineTag === "staff")) return true;
  if (tag === "raw" && line.traffic === "raw") return true;
  if (tag === "product" && line.traffic === "product") return true;
  if (tag === "waste" && (line.traffic === "waste" || line.lineTag === "waste")) return true;
  if (tag === "clean" && line.traffic === "clean") return true;
  if (tag === "dirty" && line.traffic === "dirty") return true;
  if (tag === "condensate" && line.lineTag === "condensate") return true;
  if (tag === "fans") return false;
  if (tag === "grilles") return false;
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

const CLIMATE_ITEM_FILTER = {
  all: () => true,
  ac: (it) => ["ac_indoor", "ac_outdoor", "ac_floor", "ac_duct"].includes(it.kind),
  climate: (it) => ["recirc", "fridge", "freezer"].includes(it.kind),
  cold: (it) => ["fridge", "freezer"].includes(it.kind),
  pick: () => true,
};

const VENT_ITEM_FILTER = {
  all: () => true,
  supply: () => false,
  exhaust: () => false,
  recirc: () => false,
  fans: (it) => ["blade_fan", "vent_unit", "recirc", "supply", "exhaust"].includes(it.kind),
  pick: () => true,
};

export function getSheetFilters(sheet) {
  return sheet?.filters || [];
}

export function filterPlanItems(items, sheetId, filterId) {
  const sid = resolveSheetId(sheetId);
  if (!filterId || filterId === "all" || filterId === "pick") return items;
  if (sid === "racks") {
    const fn = RACK_FILTER[filterId];
    return fn ? items.filter((it) => isRackKind(it.kind) || it.kind === "shelf_cons" || it.kind === "shelf_inv" ? fn(it) : true) : items;
  }
  if (sid === "irrigation" || sid === "water_treatment") {
    const fn = WATER_ITEM_FILTER[filterId];
    return fn ? items.filter((it) => ["tank", "pump", "osmosis", "water_prep"].includes(it.kind) ? fn(it) : true) : items;
  }
  return items;
}

export function filterPlanLines(lines, sheetId, filterId) {
  const sid = resolveSheetId(sheetId);
  if (!filterId || filterId === "all" || filterId === "pick") return lines;
  const fn = LINE_TAG_FILTER(filterId);
  if (sid === "drainage") return lines.filter((l) => l.layer === "drain").filter(fn);
  if (sid === "irrigation" || sid === "water_treatment") return lines.filter((l) => l.layer === "irrigation").filter(fn);
  return lines.filter(fn);
}

export function toolStateFromDef(tool) {
  if (!tool) return {
    tool: "select",
    pending: null,
    pendingSize: null,
    lineLayer: null,
    lineTag: null,
    linePipe: null,
    lineMeta: null,
    zoneFlow: null,
  };
  if (tool.mode === "placeholder") return { tool: "select", pending: null, linePipe: null, lineMeta: null, placeholder: tool };
  if (tool.mode === "add") {
    const resolved = resolveToolPendingSize(tool);
    const pendingSize = resolved || (tool.icon || tool.defaultLabel
      ? {
        ...(tool.size || {}),
        ...(tool.icon ? { icon: tool.icon } : {}),
        ...(tool.defaultLabel ? { label: tool.defaultLabel } : {}),
      }
      : null);
    return {
      tool: "add",
      pending: tool.kind,
      pendingSize: resolved || pendingSize,
      lineLayer: null,
      lineTag: tool.lineTag || null,
      linePipe: null,
      lineMeta: null,
      zoneFlow: tool.zoneFlow || null,
    };
  }
  if (tool.mode === "line") {
    return {
      tool: "line",
      pending: null,
      lineLayer: tool.lineLayer || null,
      lineTag: tool.lineTag || null,
      linePipe: {
        pipeSystem: tool.pipeSystem || null,
        pipeRole: tool.pipeRole || null,
        diameterMm: tool.diameterMm ?? null,
        material: tool.material || null,
      },
      lineMeta: {
        lineType: tool.lineType || null,
        ductType: tool.ductType || null,
        diameterMm: tool.diameterMm ?? null,
        airflowM3h: tool.airflowM3h ?? null,
        flowDirection: tool.flowDirection || "forward",
      },
      zoneFlow: null,
    };
  }
  if (tool.mode === "zone") {
    return { tool: "label", pending: null, linePipe: null, lineMeta: null, zoneFlow: tool.zoneFlow || null };
  }
  if (tool.mode === "structural") {
    return {
      tool: "structural",
      pending: tool.kind || "beam",
      pendingSize: null,
      lineLayer: null,
      lineTag: null,
      linePipe: null,
      lineMeta: null,
      zoneFlow: null,
    };
  }
  return {
    tool: tool.mode || "select",
    pending: tool.kind || null,
    pendingSize: null,
    lineLayer: tool.lineLayer || null,
    lineTag: tool.lineTag || null,
    linePipe: null,
    lineMeta: null,
    zoneFlow: tool.zoneFlow || null,
  };
}

export function isItemVisibleOnSheet(item, sheetId, filterId, activeLayer) {
  const sid = resolveSheetId(sheetId);
  if (!objectVisibleOnSheet(item, sid)) return false;
  if (!filterId || filterId === "all") return true;
  if (sid === "racks" && (isRackKind(item.kind) || item.kind === "shelf_cons" || item.kind === "shelf_inv")) {
    const fn = RACK_FILTER[filterId];
    return fn ? fn(item) : true;
  }
  if ((sid === "irrigation" || sid === "water_treatment") && ["tank", "pump", "osmosis", "water_prep"].includes(item.kind)) {
    const fn = WATER_ITEM_FILTER[filterId];
    return fn ? fn(item) : true;
  }
  if (sid === "climate" && item.layer === "climate") {
    const fn = CLIMATE_ITEM_FILTER[filterId];
    return fn ? fn(item) : true;
  }
  if (sid === "ventilation" && item.layer === "vent") {
    const fn = VENT_ITEM_FILTER[filterId];
    return fn ? fn(item) : true;
  }
  return item.layer === activeLayer || filterId === "pick";
}

export function isLineVisibleOnSheet(line, sheetId, filterId) {
  const sid = resolveSheetId(sheetId);
  if (!filterId || filterId === "all" || filterId === "pick") return true;
  if (sid === "climate") {
    if (filterId === "ac") return line.layer === "climate";
    return false;
  }
  if (sid === "ventilation" && filterId === "fans") return false;
  if (sid === "drainage" && line.layer !== "drain") return false;
  if ((sid === "irrigation" || sid === "water_treatment") && line.layer !== "irrigation") return false;
  return LINE_TAG_FILTER(filterId)(line);
}
