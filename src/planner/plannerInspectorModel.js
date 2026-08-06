/**
 * Map PlanPage selection → PlannerInspector selection/entity props.
 * Pure helpers — no plan mutation.
 */
import { resolvePlanWalls } from "./wallNetwork.js";
import { resolveLogicalWallChain } from "./core/walls/logicalWallChain.js";
import { resolveLengthEditAnchor } from "./core/walls/liveWallMeasurements.js";
import { WALL_KINDS } from "./wallTypes.js";
import { isDoorKind } from "./doorTypes.js";
import { isOpeningKind } from "./openingTypes.js";

function wallLength(wall, nodes = {}) {
  if (wall?.pts?.length >= 2) {
    let len = 0;
    for (let i = 1; i < wall.pts.length; i++) {
      const a = wall.pts[i - 1];
      const b = wall.pts[i];
      len += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return Math.round(len);
  }
  const a = nodes[wall?.a];
  const b = nodes[wall?.b];
  if (a && b) return Math.round(Math.hypot(b.x - a.x, b.y - a.y));
  return null;
}

function wallAngle(wall, nodes = {}) {
  const a = wall?.pts?.[0] || nodes[wall?.a];
  const b = wall?.pts?.[1] || nodes[wall?.b];
  if (!a || !b) return null;
  return Math.round((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
}

export function buildInspectorModel(selection, plan, selObj) {
  if (!selection?.ids?.length) {
    return { selection: null, entity: null, warnings: [] };
  }
  const id = selection.ids[0];
  const coll = selection.coll;

  if (coll === "walls") {
    const walls = resolvePlanWalls(plan);
    const wall = walls.find((w) => w.id === id) || selObj;
    if (!wall) return { selection: { type: "wall", id }, entity: null, warnings: [] };
    const kindOpts = Object.entries(WALL_KINDS || {}).map(([value, k]) => ({
      value,
      label: k.label || value,
    }));
    // PHASE 2F1 — the inspector targets the LOGICAL wall. A host split by a T
    // is one wall to the user, so its reported length is the total of the whole
    // chain, not of whichever half happened to be clicked.
    const chain = resolveLogicalWallChain(plan, id);
    const length = chain.segmentCount > 1
      ? Math.round(chain.totalLengthMm)
      : wallLength(wall, plan.nodes);
    // Exact length edits apply to the selected topology segment. Dual-attached
    // walls (and multi-segment logical totals) are disabled with a reason.
    const anchor = resolveLengthEditAnchor(plan, id, {
      selectedEndpoint: selection?.nodeIdx === 0 ? 0 : selection?.nodeIdx === 1 ? 1 : null,
    });
    const lengthEditable = !!anchor.ok && chain.segmentCount <= 1;
    const lengthDisabledReason = !anchor.ok
      ? (anchor.message || "Длина недоступна для этой стены.")
      : (chain.segmentCount > 1
        ? "Логическая стена из нескольких сегментов — измените длину свободного конца сегмента."
        : null);
    return {
      selection: { type: "wall", id },
      entity: {
        id,
        length,
        lengthEditable,
        lengthDisabledReason,
        lengthUnit: "мм",
        logicalWallId: chain.logicalId || id,
        segmentCount: chain.segmentCount,
        chainWallIds: chain.wallIds,
        thickness: wall.thk ?? wall.thickness ?? 100,
        angle: wallAngle(wall, plan.nodes),
        wallType: wall.kind || "new",
        wallTypeOptions: kindOpts,
      },
      warnings: [],
    };
  }

  if (coll === "nodes" || (coll === "walls" && selection.nodeIdx != null)) {
    const nodeId = selection.nodeId || id;
    const node = plan.nodes?.[nodeId];
    if (!node) return { selection: { type: "node", id: nodeId }, entity: null, warnings: [] };
    const connected = (plan.walls || []).filter((w) => w.a === nodeId || w.b === nodeId).length;
    return {
      selection: { type: "node", id: nodeId },
      entity: {
        id: nodeId,
        x: Math.round(node.x),
        y: Math.round(node.y),
        connectedWallCount: connected,
        canMerge: connected >= 2,
      },
      warnings: [],
    };
  }

  if (coll === "items") {
    const item = (plan.items || []).find((it) => it.id === id) || selObj;
    if (!item) return { selection: { type: "object", id }, entity: null, warnings: [] };
    const kind = item.kind || "";
    if (isDoorKind(kind) || kind.startsWith("door")) {
      return {
        selection: { type: "door", id },
        entity: {
          id,
          type: "door",
          width: item.w,
          height: item.openingHeightMm || item.h || 2100,
          position: item.x,
          orientation: item.doorSwing || item.orientation || "left",
          orientationOptions: [
            { value: "left", label: "Слева" },
            { value: "right", label: "Справа" },
          ],
        },
        warnings: [],
      };
    }
    if (isOpeningKind(kind) || kind.startsWith("window") || kind === "opening") {
      return {
        selection: { type: "window", id },
        entity: {
          id,
          type: "window",
          width: item.w,
          height: item.openingHeightMm || item.h || 1400,
          position: item.x,
          orientation: item.orientation || "left",
        },
        warnings: [],
      };
    }
    return {
      selection: { type: "object", id },
      entity: {
        id,
        name: item.label || item.name || kind,
        x: Math.round(item.x),
        y: Math.round(item.y),
        rotation: item.angle || 0,
        width: item.w,
        depth: item.h,
        properties: [],
      },
      warnings: [],
    };
  }

  if (coll === "dimensions") {
    const dim = (plan.dimensions || []).find((d) => d.id === id) || selObj;
    if (!dim) return { selection: { type: "dimension", id }, entity: null, warnings: [] };
    const invalid = dim.invalid || dim.warning || dim.status === "error";
    return {
      selection: { type: "dimension", id },
      entity: {
        id,
        dimensionType: dim.mode || dim.kind || "linear",
        label: dim.labelOverride || dim.label || "",
        offset: dim.offset ?? 0,
        style: dim.style || "default",
        visible: dim.visible !== false,
        invalid: !!invalid,
      },
      warnings: invalid ? [{ id: `${id}-invalid`, message: "Некорректный или устаревший размер", level: "warning" }] : [],
    };
  }

  if (coll === "zones" || coll === "rooms") {
    const room = (plan.rooms || []).find((r) => r.id === id)
      || (plan.zones || []).find((z) => z.id === id)
      || selObj;
    if (!room) return { selection: { type: "room", id }, entity: null, warnings: [] };
    return {
      selection: { type: "room", id },
      entity: {
        id,
        name: room.name || "Помещение",
        category: room.category || "other",
        area: room.areaM2 || room.area,
        height: room.heightMm || room.height,
      },
      warnings: [],
    };
  }

  return { selection: { type: "object", id }, entity: selObj ? { id, name: selObj.kind || id } : null, warnings: [] };
}

/** Map inspector onChange payload → updateObj(coll, id, patch). */
export function inspectorChangeToPatch(payload) {
  if (!payload?.id || !payload?.type) return null;
  const { type, field, value, id } = payload;
  if (type === "wall") {
    if (field === "thickness") return { coll: "walls", id, patch: { thk: value } };
    if (field === "wallType") return { coll: "walls", id, patch: { kind: value } };
    return null; // length/angle need geometry commands — deferred
  }
  if (type === "door" || type === "window") {
    if (field === "width") return { coll: "items", id, patch: { w: value } };
    if (field === "height") return { coll: "items", id, patch: { openingHeightMm: value, h: value } };
    if (field === "position") return { coll: "items", id, patch: { x: value } };
    if (field === "orientation") {
      return { coll: "items", id, patch: type === "door" ? { doorSwing: value } : { orientation: value } };
    }
  }
  if (type === "dimension") {
    if (field === "label") return { coll: "dimensions", id, patch: { labelOverride: value } };
    if (field === "offset") return { coll: "dimensions", id, patch: { offset: value } };
    if (field === "visible") return { coll: "dimensions", id, patch: { visible: value } };
    if (field === "style") return { coll: "dimensions", id, patch: { style: value } };
    if (field === "dimensionType") return { coll: "dimensions", id, patch: { mode: value } };
  }
  if (type === "object") {
    if (field === "name") return { coll: "items", id, patch: { label: value } };
    if (field === "x") return { coll: "items", id, patch: { x: value } };
    if (field === "y") return { coll: "items", id, patch: { y: value } };
    if (field === "rotation") return { coll: "items", id, patch: { angle: value } };
    if (field === "width") return { coll: "items", id, patch: { w: value } };
    if (field === "depth") return { coll: "items", id, patch: { h: value } };
  }
  if (type === "node") {
    if (field === "x" || field === "y") return { coll: "nodes", id, patch: { [field]: value } };
  }
  if (type === "room") {
    if (field === "name") return { coll: "zones", id, patch: { name: value } };
  }
  return null;
}
