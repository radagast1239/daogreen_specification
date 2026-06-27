import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useStore } from "../../store/StoreContext.jsx";
import { uid } from "../../store/helpers.js";
import {
  getStandalonePlan, saveStandalonePlan, downloadPlanFile,
  readPlanFile, renameStandalonePlan, deleteStandalonePlan,
} from "../../planner/standalonePlans.js";
import {
  LAYERS, LINE_STYLE, PDF_SHEETS, catalogByKind, catalogForLayer, layerById,
  clamp, snap, fmt, DEFAULT_PLAN, DEFAULT_DISPLAY, migrateLayerId, polyLength,
} from "../../planner/catalog.js";
import { exportLayeredPDF } from "../../planner/exportPdf.js";
import { createPlannerSpecItems, defaultObjectSpecSettings, plannerSpecSummary } from "../../planner/specSync.js";
import { collectPlannerWarnings, wallsForLayer, boundsForActiveLayer } from "../../planner/geometry.js";
import { resolveDraftPoint, angleBetweenDeg } from "../../planner/draftSnap.js";
import { computeItemPlacement, placementZoneLabel } from "../../planner/placementPreview.js";
import { PlacementGhost } from "../../planner/objectOverlays.jsx";
import { normalizeDisplay, roundMm, fmtCoord, fmtCoordMm, coordUnitLabel } from "../../planner/gridSettings.js";
import { isStrictWallItem, isDoorKind } from "../../planner/doorTypes.js";
import {
  snapWallPoint, placeOnWall, pointInPolygon, pointInZone, breakWallAt,
  syncZonesFromWalls, applyWallNodeMove, refreshWallMountedItems,
  tryMergeWall, straightenWall, setWallSegmentLength, setWallSegmentLengthAt,
  wallSegmentLengthAt, wallSegmentIndexForNode, alignWallToNeighbor, weldWallNodes,
} from "../../planner/wallGeometry.js";
import { validateOpeningPlacement, nextDoorNumber, nextOpeningNumber } from "../../planner/doorGeometry.js";
import { attachItemZoneFields } from "../../planner/roomZones.js";
import {
  defaultLineFields, attachLineEndpoints, snapLinePoint,
  insertPointOnLine, removeLineNode, reverseLine, hitTestLine,
} from "../../planner/lineProperties.js";
import {
  isRackKind, defaultRackFields, nextRackNumber, nextRowLabel,
  autoNumberRacks, buildRackGrid,
} from "../../planner/rackProperties.js";
import { isOpeningKind, defaultOpeningFields } from "../../planner/openingTypes.js";
import { isDoorItem } from "../../planner/doorTypes.js";
import { defaultWallFields, WALL_KINDS, THICKNESS_SIDES } from "../../planner/wallTypes.js";
import { wallFieldsFromTool } from "../../planner/wallToolPresets.js";
import { usePlanHistory } from "../../planner/usePlanHistory.js";
import {
  PlanGridScreen, PlanAxesScreen, SheetBackdrop, RoomDims, WallEl, WallsTopOverlay, ItemEl, ZoneEl, LabelEl, LineEl,
  DraftLine, SelectionDims, WallSelectionDims, MeasureEl, TypedLengthHint, LinkEl,
  SelectionMarquee, MultiSelectBounds, PlanLayerGroup, RoomFloorEl,
} from "../../planner/canvasPrimitives.jsx";
import { layerDisplayState } from "../../planner/canvasLayers.js";
import { snapLineDraftPoint, snapRackNeighbor } from "../../planner/plannerSnap.js";
import { snapObjectPosition, constrainAxisDelta, constrainAxisPoint, snapDistanceMm } from "../../planner/objectSnap.js";
import {
  itemsInMarquee, boundsOfItems, groupMemberIds,
} from "../../planner/selectionHelpers.js";
import { warningIdsFromList } from "../../planner/selectionVisuals.js";
import {
  buildItemLabelLines, defaultFreeLabelFields, autoItemLabelPlacement,
  resolveFreeLabelPosition,
} from "../../planner/labelProperties.js";
import {
  linkTypeForLayer, canCreateLink, linkLengthMm, linksVisibleOnLayer,
  buildLinkPayload, findRackLinkTarget, RACK_LINK_ACTIONS,
} from "../../planner/linkGeometry.js";
import { PlannerLayout } from "../../planner/ui/PlannerLayout.jsx";
import {
  sheetById, sheetByLayerId, defaultToolForSheet, buildVisibilityFromSheet, sheetDisplayPatch,
} from "../../planner/plannerSheets.js";
import { categoryById } from "../../planner/plannerCategories.js";
import { PlannerToolMenu } from "../../planner/ui/PlannerToolMenu.jsx";
import { ObjectPalette } from "../../planner/ui/ObjectPalette.jsx";
import { toolStateFromDef, isItemVisibleOnSheet, isLineVisibleOnSheet } from "../../planner/plannerSheetUtils.js";
import { resolveTool } from "../../planner/plannerTools.js";
import { sheetAllowedInViewMode, viewModeForSheet } from "../../planner/plannerViewModes.js";
import { PropertiesPanel } from "../../planner/ui/PropertiesPanel.jsx";
import { ContextMenu, buildObjectMenu } from "../../planner/ui/ContextMenu.jsx";
import { AttachPlanModal } from "../../planner/ui/AttachPlanModal.jsx";
import "../../planner/planner.css";
import { Empty } from "../../components/ui.jsx";

const LINE_LAYER_IDS = ["drain", "irrigation", "supply", "power", "vent", "climate", "ac", "light", "staff"];
const ITEM_LAYER_IDS = LAYERS.map((l) => l.id).filter(
  (id) => !["room", "zones", "partitions", "client", "install", "spec"].includes(id)
);

function draftPt(from, to, opts) {
  const { point, angleSnap } = resolveDraftPoint(from, to, opts);
  return { point, angleSnap };
}

function dragShiftOn(shiftHeld, altHeld) {
  return shiftHeld && !altHeld;
}

export default function PlanPage() {
  const { id, draftId } = useParams();
  const navigate = useNavigate();
  const standalone = !!draftId;
  const { state, actions } = useStore();
  const project = standalone ? null : state.projects.find((p) => p.id === id);
  const [draftMeta, setDraftMeta] = useState(() => (standalone ? getStandalonePlan(draftId) : null));

  const initialPlan = () => {
    if (standalone) return withDefaults(draftMeta?.plan || getStandalonePlan(draftId)?.plan);
    return withDefaults(project?.plan);
  };

  const { plan, setPlan, undo, redo, resetHistory } = usePlanHistory(initialPlan);
  const [active, setActive] = useState("room");
  const [tool, setTool] = useState("select");
  const [pending, setPending] = useState(null);
  const [pendingSize, setPendingSize] = useState(null);
  const [lineDraftMeta, setLineDraftMeta] = useState({ layer: null, tag: null });
  const [activeToolId, setActiveToolId] = useState("select");
  const [sheetFilters, setSheetFilters] = useState({});
  const [toolSearch, setToolSearch] = useState("");
  const [selection, setSelection] = useState(null);
  const [marquee, setMarquee] = useState(null);
  const setSel = (v) => setSelection(v ? { coll: v.coll, ids: [v.id] } : null);
  const clearSelection = () => setSelection(null);
  const [view, setView] = useState({ panX: 0, panY: 0, zoom: 0.08 });
  const [display, setDisplay] = useState(() => normalizeDisplay(DEFAULT_DISPLAY()));
  const [unit] = useState("mm");
  const [vis, setVis] = useState(Object.fromEntries(LAYERS.map((l) => [l.id, true])));
  const [draft, setDraft] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [measure, setMeasure] = useState([]);
  const [guides, setGuides] = useState([]);
  const [wallThk, setWallThk] = useState(100);
  const [hoverWallNode, setHoverWallNode] = useState(null);
  const [hoverHit, setHoverHit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(true);
  const [spacePan, setSpacePan] = useState(false);
  const [altSnapOff, setAltSnapOff] = useState(false);
  const [linkFrom, setLinkFrom] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null);
  const ctxMenuRef = useRef(null);
  ctxMenuRef.current = ctxMenu;
  const [typedLength, setTypedLength] = useState("");
  const [draftSnap, setDraftSnap] = useState(null);
  const [draftAngleSnap, setDraftAngleSnap] = useState(null);
  const wallChainStartRef = useRef(null);
  const wallPrevAngleRef = useRef(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [activeSheetId, setActiveSheetId] = useState("source");
  const [activeCategoryId, setActiveCategoryId] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [planLevel, setPlanLevel] = useState("Этаж 1");
  const [planVariant, setPlanVariant] = useState("Планировка 1");
  const [pinnedProperties, setPinnedProperties] = useState(false);
  const [propsTab, setPropsTab] = useState("props");
  const [warningsPanelOpen, setWarningsPanelOpen] = useState(false);
  const [viewMode, setViewMode] = useState("2d");

  const criticalWarnIdsRef = useRef(new Set());

  const openWarningsPanel = useCallback(() => {
    setPropsTab("errors");
    setWarningsPanelOpen(true);
  }, []);
  const svgRef = useRef(null);
  const [svgSize, setSvgSize] = useState({ w: 1200, h: 800 });
  const dragRef = useRef(null);
  const clipboardRef = useRef(null);
  const shiftRef = useRef(false);
  const altSnapRef = useRef(false);
  altSnapRef.current = altSnapOff;
  const typedLengthRef = useRef("");
  typedLengthRef.current = typedLength;

  useEffect(() => {
    actions.ensureMaterials().catch(() => {});
    actions.ensureModules().catch(() => {});
    if (standalone) actions.refreshProjects?.().catch(() => {});
  }, [actions, standalone]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const sync = () => setSvgSize({ w: el.clientWidth || 1200, h: el.clientHeight || 800 });
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const t = requestAnimationFrame(() => {
      if (svgRef.current) fitView();
    });
    return () => cancelAnimationFrame(t);
  }, [standalone ? draftId : project?.id]);

  useEffect(() => {
    if (standalone) {
      const d = getStandalonePlan(draftId);
      if (d) {
        setDraftMeta(d);
        resetHistory(withDefaults(d.plan));
      }
      return;
    }
    let cancelled = false;
    actions.loadProject(id).then((p) => {
      if (!cancelled && p?.plan && Object.keys(p.plan).length) resetHistory(withDefaults(p.plan));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [id, draftId, standalone, actions, resetHistory]);

  useEffect(() => {
    if (standalone) {
      if (!draftMeta?.id) return;
      setSaved(false);
      const t = window.setTimeout(() => {
        const saved = saveStandalonePlan({ ...draftMeta, plan });
        setDraftMeta(saved);
        setSaved(true);
      }, 700);
      return () => window.clearTimeout(t);
    }
    if (!project?.id) return;
    setSaved(false);
    const t = window.setTimeout(() => {
      actions.projectUpdate(project.id, { plan })
        .then(() => setSaved(true))
        .catch((e) => console.error("Planner autosave failed", e));
    }, 700);
    return () => window.clearTimeout(t);
  }, [plan, standalone, draftMeta?.id, draftMeta?.name, project?.id, actions]);

  const snapOn = display.snapOn && !altSnapOff;
  const snapStep = display.snapStep ?? display.gridStep ?? 50;
  const fmtU = (mm) => fmt(mm, unit);
  const fmtCoordU = (mm) => fmtCoord(mm, display.coordUnit || "mm");
  const toMM = (cx, cy) => {
    const r = svgRef.current.getBoundingClientRect();
    return { x: (cx - r.left - view.panX) / view.zoom, y: (cy - r.top - view.panY) / view.zoom };
  };
  const sn = (v) => roundMm(snap(v, snapStep, snapOn && display.snapGrid), display.snapRoundMm || 1);

  const innerL = plan.room.wallThk / 2;
  const innerT = plan.room.wallThk / 2;
  const innerR = plan.room.w - plan.room.wallThk / 2;
  const innerB = plan.room.h - plan.room.wallThk / 2;

  const snapObj = useCallback((coll, obj, x, y) => {
    const gridSnap = (v) => roundMm(snap(v, snapStep, snapOn && display.snapGrid !== false), display.snapRoundMm || 1);
    if (!snapOn || altSnapRef.current) {
      return { x: gridSnap(x), y: gridSnap(y), guides: [] };
    }
    const innerBounds = { l: innerL, t: innerT, r: innerR, b: innerB };
    const base = snapObjectPosition({
      obj,
      x,
      y,
      items: plan.items,
      walls: plan.walls,
      room: plan.room,
      zoom: view.zoom,
      snapOn: true,
      snapGrid: display.snapGrid !== false,
      snapObjects: display.snapObjects !== false,
      snapWalls: display.snapWalls !== false,
      snapGuides: display.snapGuides !== false,
      snapDistancePx: display.snapDistancePx ?? 10,
      innerBounds,
      gridSnap,
    });
    let nx = base.x;
    let ny = base.y;
    const g = [...base.guides];
    if (coll === "items" && isRackKind(obj.kind) && display.snapObjects) {
      const rackSnap = snapRackNeighbor(obj, nx, ny, plan.items, snapDistanceMm(view.zoom, display.snapDistancePx ?? 10));
      nx = rackSnap.x;
      ny = rackSnap.y;
      g.push(...rackSnap.guides);
    }
    return { x: nx, y: ny, guides: g };
  }, [snapOn, snapStep, view.zoom, plan.walls, plan.items, plan.room, display.snapObjects, display.snapGrid, display.snapWalls, display.snapGuides, display.snapDistancePx, display.snapRoundMm, innerL, innerR, innerT, innerB]);

  const attachWall = (obj, x, y) => {
    const maxDist = isStrictWallItem(obj.kind) ? 220 : 350;
    const placed = placeOnWall(obj, { x, y }, plan.walls, plan.room, maxDist);
    if (!placed) return null;
    const check = validateOpeningPlacement(
      obj,
      { x: placed.x, y: placed.y, wallSeg: placed.wallSeg, wallId: placed.wallId },
      plan.walls,
    );
    if (!check.ok && isStrictWallItem(obj.kind)) {
      return { error: check.message };
    }
    return {
      x: placed.x,
      y: placed.y,
      angle: placed.angle,
      wallId: placed.wallId,
      wallSeg: placed.wallSeg,
    };
  };

  const draftSnapOpts = useCallback(() => ({
    shiftHard: shiftRef.current,
    snapOn: snapOn && !altSnapRef.current,
    angleSnapOn: display.snapAngles !== false,
    toleranceDeg: display.angleTolerance ?? 5,
    snapStep,
    gridSnap: display.snapGrid !== false,
    walls: plan.walls,
    prevSegAngleDeg: wallPrevAngleRef.current,
  }), [snapOn, snapStep, display.snapAngles, display.angleTolerance, display.snapGrid, plan.walls]);

  const clearWallChain = () => {
    wallChainStartRef.current = null;
    wallPrevAngleRef.current = null;
    setDraft([]);
    setDraftSnap(null);
    setDraftAngleSnap(null);
    setTypedLength("");
  };

  const computeDraftPt = (raw, from) => {
    const { point: draftPoint, angleSnap } = from
      ? draftPt(from, raw, draftSnapOpts())
      : { point: { x: sn(raw.x), y: sn(raw.y) }, angleSnap: null };
    let pt = draftPoint;
    let snap = null;
    if (tool === "wall" && snapOn && display.snapWalls !== false) {
      const chainStart = wallChainStartRef.current;
      if (chainStart && from) {
        const thr = (display.snapDistancePx ?? 10) / Math.max(view.zoom, 0.05);
        const away = Math.hypot(from.x - chainStart.x, from.y - chainStart.y);
        if (away > 200 && Math.hypot(pt.x - chainStart.x, pt.y - chainStart.y) <= thr) {
          return { pt: { x: chainStart.x, y: chainStart.y }, snap: { snapped: true, kind: "close" }, angleSnap };
        }
      }
      const s = snapWallPoint(pt, plan.walls, plan.room, view.zoom, true, snapStep);
      if (s.snapped) {
        pt = { x: s.x, y: s.y };
        snap = s;
      }
    }
    if (tool === "line" && snapOn) {
      const s = snapLineDraftPoint(pt, {
        items: plan.items,
        walls: plan.walls,
        room: plan.room,
        lines: plan.lines,
        zoom: view.zoom,
        snapOn: true,
        snapGrid: display.snapGrid !== false,
        snapWalls: display.snapWalls !== false,
        snapObjects: display.snapObjects !== false,
        snapStep,
      });
      if (s.snapped || s.kind === "grid") {
        pt = { x: s.x, y: s.y };
        if (s.snapped) snap = s;
      }
    }
    return { pt, snap, angleSnap };
  };

  const syncAutoZones = (p) => {
    try {
      const { manual, auto } = syncZonesFromWalls(p);
      return {
        ...p,
        zones: [
          ...manual,
          ...auto.map((z) => {
            const { prevId, ...rest } = z;
            return { ...rest, id: prevId || uid("zn") };
          }),
        ],
      };
    } catch (e) {
      console.error("syncAutoZones failed", e);
      return p;
    }
  };

  const applyTypedLength = () => {
    const len = parseInt(typedLengthRef.current, 10);
    if (!len || draft.length < 1 || !cursor) return false;
    const from = draft[draft.length - 1];
    const { pt, angleSnap } = computeDraftPt(cursor, from);
    const ang = angleSnap?.snappedAngle ?? angleBetweenDeg(from, pt);
    const end = { x: from.x + Math.cos((ang * Math.PI) / 180) * len, y: from.y + Math.sin((ang * Math.PI) / 180) * len };
    if (tool === "wall") {
      commitWallSegment(from, end);
      setDraft([end]);
      wallPrevAngleRef.current = ang;
    } else {
      setDraft((d) => [...d, end]);
    }
    setTypedLength("");
    return true;
  };

  const updateObj = (coll, oid, patch) => {
    setPlan((p) => {
      let next = {
        ...p,
        [coll]: p[coll].map((o) => (o.id === oid ? { ...o, ...patch } : o)),
      };
      if (coll === "walls") {
        next = {
          ...next,
          items: refreshWallMountedItems(next.items, next.walls, next.room, oid),
        };
        next = syncAutoZones(next);
      }
      return next;
    });
  };
  const delSel = () => {
    if (!selection?.ids?.length) return;
    setPlan((p) => {
      const next = { ...p };
      if (selection.coll === "items") {
        const ids = new Set(selection.ids);
        next.items = p.items.filter((o) => !ids.has(o.id));
        next.links = (p.links || []).filter((l) => !ids.has(l.fromId) && !ids.has(l.toId));
      } else {
        const id = selection.ids[0];
        if (selection.coll === "links") {
          next.links = (p.links || []).filter((l) => l.id !== id);
        } else {
          next[selection.coll] = p[selection.coll].filter((o) => o.id !== id);
        }
      }
      return next;
    });
    clearSelection();
  };

  const createLink = (fromId, toId, type) => {
    const fromItem = plan.items.find((i) => i.id === fromId);
    const toItem = plan.items.find((i) => i.id === toId);
    const payload = buildLinkPayload(type, fromItem, toItem, uid("lk"));
    if (!payload) return false;
    const dup = (plan.links || []).some(
      (l) => l.type === type && l.fromId === payload.fromId && l.toId === payload.toId,
    );
    if (dup) return false;
    setPlan((p) => ({ ...p, links: [...(p.links || []), payload] }));
    setSel({ coll: "links", id: payload.id });
    return true;
  };

  const addItemAt = (mm) => {
    const preview = computeItemPlacement({
      mm,
      kind: pending,
      size: pendingSize,
      plan,
      display,
      snapObj,
      attachWall,
      innerL,
      innerR,
      innerT,
      innerB,
    });
    if (!preview.valid) {
      if (preview.blocking && preview.warning) {
        const c = catalogByKind(pending);
        window.alert(
          isStrictWallItem(c?.kind)
            ? "Дверь или окно можно ставить только на стену. Сначала нарисуйте перегородки на листе «Перегородки»."
            : preview.warning,
        );
      }
      return;
    }
    const base = preview.item;
    const c = catalogByKind(pending);
    const item = {
      ...base,
      id: uid("eq"),
      doorSwing: "left",
      doorOpenIn: true,
      doorNum: isDoorKind(c.kind) ? nextDoorNumber(plan.items) : null,
      doorHeightMm: isDoorKind(c.kind) ? 2100 : null,
      openingNum: isOpeningKind(c.kind) ? nextOpeningNumber(plan.items) : null,
      ...(isOpeningKind(c.kind) ? defaultOpeningFields(c.kind) : {}),
      ...(isRackKind(c.kind) ? defaultRackFields(c.kind, plan.items) : {}),
      params: c.params ? { ...c.params } : null,
      ...defaultObjectSpecSettings(c.kind),
    };
    setPlan((p) => ({ ...p, items: [...p.items, item] }));
    setSel({ coll: "items", id: item.id });
    setTool("select");
    setGuides([]);
  };

  const addZoneAt = (mm) => {
    const zw = 2000;
    const zh = 1500;
    const z = { id: uid("zn"), x: sn(mm.x - zw / 2), y: sn(mm.y - zh / 2), w: zw, h: zh, name: "Зона", height: plan.room.height || 3000, flow: "neutral" };
    setPlan((p) => ({ ...p, zones: [...p.zones, z] }));
    setSel({ coll: "zones", id: z.id });
    setTool("select");
  };

  const addLabelAt = (mm, targetId) => {
    const tgt = targetId ? plan.items.find((i) => i.id === targetId) : null;
    const place = tgt
      ? autoItemLabelPlacement(tgt, plan.room)
      : { x: sn(mm.x + 300), y: sn(mm.y - 300), anchor: { x: mm.x, y: mm.y } };
    const text = tgt
      ? buildItemLabelLines(tgt, plan, "full").join("\n")
      : "Подпись";
    const l = {
      id: uid("lb"),
      ...defaultFreeLabelFields(tgt, { x: sn(place.x), y: sn(place.y) }, text),
    };
    setPlan((p) => ({ ...p, labels: [...p.labels, l] }));
    setSel({ coll: "labels", id: l.id });
    setTool("select");
  };

  const commitWallDraft = (pts) => {
    if (!pts || pts.length < 2) return;
    let clean = pts.map((pt) => ({ x: pt.x, y: pt.y }));
    if (clean.length >= 2) {
      const f = clean[0];
      const l = clean[clean.length - 1];
      if (Math.hypot(f.x - l.x, f.y - l.y) < 5) clean = clean.slice(0, -1);
    }
    if (clean.length < 2) return;
    const role = active === "room" ? "outer" : "partition";
    const wallId = uid("wl");
    setPlan((p) => {
      const toolFields = wallFieldsFromTool(activeToolId, role, p.room, wallThk);
      let walls = weldWallNodes([
        ...p.walls,
        {
          id: wallId,
          pts: clean,
          ...defaultWallFields(toolFields.role || role, p.room),
          ...toolFields,
          thk: toolFields.thk ?? (role === "outer" ? (p.room.wallThk || wallThk) : wallThk),
        },
      ]);
      const merged = tryMergeWall(walls, wallId);
      if (merged) walls = weldWallNodes(merged.walls);
      return syncAutoZones({ ...p, walls });
    });
  };

  const commitWallSegment = (from, to) => {
    if (!from || !to) return;
    if (Math.hypot(to.x - from.x, to.y - from.y) < 50) return;
    commitWallDraft([from, to]);
    wallPrevAngleRef.current = angleBetweenDeg(from, to);
  };

  const finishDraft = (ptsOverride = null) => {
    const pts = ptsOverride || draft;
    if (tool === "wall") {
      clearWallChain();
      return;
    }
    if (pts.length >= 2) {
      const layer = lineDraftMeta.layer || migrateLayerId(active, null);
      const line = attachLineEndpoints(
        {
          id: uid("ln"),
          layer,
          pts,
          ...defaultLineFields(layer),
          ...(lineDraftMeta.tag ? { lineTag: lineDraftMeta.tag } : {}),
        },
        plan.items,
      );
      setPlan((p) => ({ ...p, lines: [...p.lines, line] }));
    }
    setDraft([]);
    setDraftSnap(null);
    setTypedLength("");
  };

  const rotateItem = (it, delta) => {
    const next = ((it.angle || 0) + delta) % 360;
    updateObj("items", it.id, { angle: next < 0 ? next + 360 : next });
  };

  const applySheet = (sheet, categoryId) => {
    const layerId = sheet.activeLayer || sheet.layerId;
    setActive(layerId);
    setActiveSheetId(sheet.id);
    if (categoryId) setActiveCategoryId(categoryId);
    setVis(buildVisibilityFromSheet(sheet));
    setDisplay((d) => normalizeDisplay({ ...d, ...sheetDisplayPatch(sheet) }));
    const def = defaultToolForSheet(sheet);
    const st = toolStateFromDef(def);
    setTool(st.tool);
    setPending(st.pending);
    setPendingSize(st.pendingSize);
    setLineDraftMeta({ layer: st.lineLayer, tag: st.lineTag });
    setActiveToolId(def?.id || "select");
    setSelection((sel) => (layerId !== "zones" && sel?.coll === "zones" ? null : sel));
    clearWallChain();
    setSel(null);
    setGuides([]);
    setSheetFilters((prev) => (
      prev[sheet.id] ? prev : { ...prev, [sheet.id]: sheet.filters?.[0]?.id || "all" }
    ));
  };

  const pickLayer = (lid, sheetId) => {
    const sheet = sheetId ? sheetById(sheetId) : sheetByLayerId(lid);
    applySheet(sheet);
  };

  const handleSheetPick = (sheet) => {
    applySheet(sheet);
    setDrawerOpen(false);
    setViewMode(viewModeForSheet(sheet.id));
  };

  const handleViewModePick = (mode) => {
    if (mode.disabled) return;
    setViewMode(mode.id);
    if (sheetAllowedInViewMode(activeSheetId, mode.id)) return;
    const sheet = sheetById(mode.defaultSheetId || "source");
    if (sheet) applySheet(sheet);
  };

  const handleCategoryPick = (cat) => {
    if (cat.id === "search") {
      const q = prompt("Поиск инструмента или объекта:", toolSearch);
      if (q != null) setToolSearch(q);
    }
    const sheet = sheetById(cat.sheetId);
    applySheet(sheet, cat.id);
    setDrawerOpen(true);
  };

  const handleFilterPick = (filterId) => {
    setSheetFilters((prev) => ({ ...prev, [activeSheetId]: filterId }));
  };

  const handleToolPick = (toolDef) => {
    if (!toolDef) return;
    setActiveToolId(toolDef.id);
    if (toolDef.mode === "placeholder") {
      window.alert(toolDef.hint || "Инструмент будет доступен на следующем этапе.");
      return;
    }
    if (toolDef.mode === "view-toggle") {
      toggleDisplay(toolDef.displayKey);
      return;
    }
    if (toolDef.mode === "action") {
      if (toolDef.action === "sync_spec") syncSpec();
      else if (toolDef.action === "rack_number") setPlan((p) => ({ ...p, items: autoNumberRacks(p.items) }));
      else if (toolDef.action === "rack_grid" || toolDef.action === "rack_row") {
        const obj = selObj && isRackKind(selObj.kind) ? selObj : plan.items.find((i) => isRackKind(i.kind));
        if (!obj) { window.alert("Выберите стеллаж на плане"); return; }
        const cols = toolDef.action === "rack_row" ? 1 : +(prompt("Колонок:", "3") || 0);
        const rows = toolDef.action === "rack_row" ? +(prompt("Стеллажей в ряду:", "5") || 0) : +(prompt("Рядов:", "2") || 0);
        const gap = +(prompt("Зазор, мм:", "800") || 800);
        if (cols > 0 && rows > 0) {
          setPlan((p) => placeRackCopies(p, obj, buildRackGrid(obj, { cols, rows, gapMm: gap })));
        }
      }
      return;
    }
    const st = toolStateFromDef(toolDef);
    setTool(st.tool);
    setPending(st.pending);
    setPendingSize(st.pendingSize);
    setLineDraftMeta({ layer: st.lineLayer, tag: st.lineTag });
    setLinkFrom(null);
    if (st.tool === "wall" || st.tool === "line") clearWallChain();
  };

  useEffect(() => {
    applySheet(sheetById(activeSheetId));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial sheet visibility
  }, []);

  const panView = (dir) => {
    const step = 80;
    setView((v) => {
      if (dir === "left") return { ...v, panX: v.panX + step };
      if (dir === "right") return { ...v, panX: v.panX - step };
      if (dir === "up") return { ...v, panY: v.panY + step };
      if (dir === "down") return { ...v, panY: v.panY - step };
      return v;
    });
  };

  const handleTool = (t) => {
    setTool(t);
    setLinkFrom(null);
    if (t === "wall" || t === "line") clearWallChain();
    if (t === "add" && !pending && catalogForLayer(active).length) setPending(catalogForLayer(active)[0].kind);
  };

  const handlePending = (kind) => { setPending(kind); setTool("add"); };

  const toggleDisplay = (key) => setDisplay((d) => normalizeDisplay({ ...d, [key]: !d[key] }));
  const patchDisplay = (patch) => setDisplay((d) => normalizeDisplay({ ...d, ...patch }));

  const fitView = () => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const m = 160;
    const z = clamp(Math.min((r.width - m) / plan.room.w, (r.height - m) / plan.room.h), 0.015, 3);
    setView({ zoom: z, panX: (r.width - plan.room.w * z) / 2, panY: (r.height - plan.room.h * z) / 2 });
  };

  const fitActiveLayer = () => {
    const b = boundsForActiveLayer(plan, active);
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    if (!b) {
      fitView();
      return;
    }
    const m = 120;
    const z = clamp(Math.min((r.width - m) / b.w, (r.height - m) / b.h), 0.015, 3);
    setView({
      zoom: z,
      panX: (r.width - b.w * z) / 2 - b.x * z,
      panY: (r.height - b.h * z) / 2 - b.y * z,
    });
  };

  const centerView = () => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    setView((v) => ({
      ...v,
      panX: (r.width - plan.room.w * v.zoom) / 2,
      panY: (r.height - plan.room.h * v.zoom) / 2,
    }));
  };

  const setZoomTo = (nz) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const cx = r.width / 2;
    const cy = r.height / 2;
    const mmx = (cx - view.panX) / view.zoom;
    const mmy = (cy - view.panY) / view.zoom;
    const z = clamp(nz, 0.015, 3);
    setView({ zoom: z, panX: cx - mmx * z, panY: cy - mmy * z });
  };

  const clearSheet = () => {
    const name = layerById(active).name;
    if (!window.confirm(`Очистить объекты листа «${name}»?`)) return;
    setPlan((p) => {
      const next = { ...p };
      if (active === "zones") next.zones = [];
      else if (active === "partitions") next.walls = p.walls.filter((w) => w.role === "outer");
      else if (active === "room") next.items = p.items.filter((i) => i.layer !== "room");
      else if (LINE_LAYER_IDS.includes(active)) next.lines = p.lines.filter((l) => l.layer !== active && migrateLayerId(l.layer) !== active);
      else if (ITEM_LAYER_IDS.includes(active)) next.items = p.items.filter((i) => i.layer !== active);
      return next;
    });
    setSel(null);
  };

  const copySel = () => {
    if (!selection || selection.coll !== "items") return;
    const items = plan.items.filter((o) => selection.ids.includes(o.id));
    if (items.length) clipboardRef.current = items.map((it) => ({ ...it }));
  };

  const pasteSel = () => {
    const src = clipboardRef.current;
    if (!src) return;
    const list = Array.isArray(src) ? src : [src];
    const newItems = list.map((it) => ({
      ...it,
      id: uid("eq"),
      x: it.x + 200,
      y: it.y + 200,
      groupId: null,
    }));
    const gid = newItems.length > 1 ? uid("grp") : null;
    if (gid) newItems.forEach((it) => { it.groupId = gid; });
    setPlan((p) => ({ ...p, items: [...p.items, ...newItems] }));
    setSelection({ coll: "items", ids: newItems.map((it) => it.id) });
  };

  const moveSelByKeys = (e) => {
    if (!selection?.ids?.length) return;
    const baseStep = display.arrowStepMm ?? 10;
    const step = e.shiftKey ? (display.arrowStepShiftMm ?? 100) : e.altKey ? (display.arrowStepAltMm ?? 1) : baseStep;
    const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
    const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
    if (!dx && !dy) return;
    e.preventDefault();

    if (selection.coll === "walls" && selection.ids.length === 1) {
      const wid = selection.ids[0];
      const nidx = selection.nodeIdx;
      setPlan((p) => {
        let walls = p.walls.map((w) => {
          if (w.id !== wid) return w;
          if (nidx != null) {
            return {
              ...w,
              pts: w.pts.map((pt, i) => (i === nidx ? { x: sn(pt.x + dx), y: sn(pt.y + dy) } : pt)),
            };
          }
          return { ...w, pts: w.pts.map((pt) => ({ x: sn(pt.x + dx), y: sn(pt.y + dy) })) };
        });
        if (nidx != null) {
          const w = walls.find((x) => x.id === wid);
          const moved = w?.pts[nidx];
          if (moved) walls = applyWallNodeMove(walls, wid, nidx, moved);
        }
        walls = weldWallNodes(walls);
        return syncAutoZones({
          ...p,
          walls,
          items: refreshWallMountedItems(p.items, walls, p.room, wid),
        });
      });
      return;
    }

    if (selection.coll === "lines" && selection.ids.length === 1) {
      const lid = selection.ids[0];
      const nidx = selection.nodeIdx;
      setPlan((p) => ({
        ...p,
        lines: p.lines.map((l) => {
          if (l.id !== lid) return l;
          if (nidx != null) {
            return {
              ...l,
              pts: l.pts.map((pt, i) => (i === nidx ? { x: sn(pt.x + dx), y: sn(pt.y + dy) } : pt)),
            };
          }
          return { ...l, pts: l.pts.map((pt) => ({ x: sn(pt.x + dx), y: sn(pt.y + dy) })) };
        }),
      }));
      return;
    }

    if (selection.coll === "items") {
      const ids = new Set(selection.ids);
      setPlan((p) => ({
        ...p,
        items: p.items.map((it) => (
          ids.has(it.id) ? { ...it, x: it.x + dx, y: it.y + dy } : it
        )),
        labels: p.labels.map((lb) => {
          if (lb.pinned || !lb.targetId || !ids.has(lb.targetId)) return lb;
          return { ...lb, x: (lb.x || 0) + dx, y: (lb.y || 0) + dy };
        }),
      }));
      return;
    }

    if (selection.coll === "labels" && selection.ids.length) {
      const ids = new Set(selection.ids);
      setPlan((p) => ({
        ...p,
        labels: p.labels.map((lb) => (
          ids.has(lb.id) ? { ...lb, x: (lb.x || 0) + dx, y: (lb.y || 0) + dy, pinned: true } : lb
        )),
      }));
      return;
    }

    if (selection.ids.length !== 1) return;
    const obj = plan[selection.coll].find((o) => o.id === selection.ids[0]);
    if (!obj) return;
    updateObj(selection.coll, obj.id, { x: (obj.x || 0) + dx, y: (obj.y || 0) + dy });
  };

  const groupSelection = () => {
    if (!selection || selection.coll !== "items" || selection.ids.length < 2) return;
    const gid = uid("grp");
    const ids = new Set(selection.ids);
    setPlan((p) => ({
      ...p,
      items: p.items.map((it) => (ids.has(it.id) ? { ...it, groupId: gid } : it)),
    }));
  };

  const ungroupSelection = () => {
    if (!selection || selection.coll !== "items") return;
    const ids = new Set(selection.ids);
    setPlan((p) => ({
      ...p,
      items: p.items.map((it) => (ids.has(it.id) ? { ...it, groupId: null } : it)),
    }));
  };

  const mirrorItem = (it, axis) => {
    if (axis === "h") updateObj("items", it.id, { mirrorH: !it.mirrorH });
    else updateObj("items", it.id, { mirrorV: !it.mirrorV });
  };

  const duplicateItem = (it) => {
    const copy = { ...it, id: uid("eq"), x: it.x + 200, y: it.y + 200, groupId: null };
    if (isDoorKind(it.kind)) copy.doorNum = nextDoorNumber(plan.items);
    if (isOpeningKind(it.kind)) copy.openingNum = nextOpeningNumber(plan.items);
    if (isRackKind(it.kind)) copy.rackNum = nextRackNumber(plan.items);
    setPlan((p) => ({ ...p, items: [...p.items, attachItemZoneFields(p, copy)] }));
    setSel({ coll: "items", id: copy.id });
  };

  const duplicateItems = () => {
    if (!selection || selection.coll !== "items") return;
    const copies = [];
    const newIds = [];
    selection.ids.forEach((id) => {
      const it = plan.items.find((i) => i.id === id);
      if (!it) return;
      const copy = { ...it, id: uid("eq"), x: it.x + 200, y: it.y + 200, groupId: null };
      copies.push(copy);
      newIds.push(copy.id);
    });
    if (!copies.length) return;
    const gid = copies.length > 1 ? uid("grp") : null;
    if (gid) copies.forEach((c) => { c.groupId = gid; });
    setPlan((p) => ({ ...p, items: [...p.items, ...copies] }));
    setSelection({ coll: "items", ids: newIds });
  };

  const placeRackCopies = (planState, source, grid) => {
    const row = source.rowNum || nextRowLabel(planState.items);
    const base = {
      ...source,
      rowNum: grid[0]?.rowNum || row,
      rackNum: source.rackNum || nextRackNumber(planState.items, source.id, grid[0]?.rowNum || row),
    };
    let items = planState.items.map((it) => (it.id === source.id ? base : it));
    const placed = [];
    grid.forEach((pos, idx) => {
      if (idx === 0) {
        const updated = { ...base, ...pos };
        delete updated._gridIdx;
        items = items.map((it) => (it.id === source.id
          ? attachItemZoneFields({ ...planState, items }, updated)
          : it));
        return;
      }
      const copy = {
        ...base,
        ...pos,
        id: uid("eq"),
        rackNum: nextRackNumber([...items, ...placed], null, pos.rowNum),
        groupId: null,
      };
      delete copy._gridIdx;
      placed.push(attachItemZoneFields({ ...planState, items: [...items, ...placed] }, copy));
    });
    return { ...planState, items: [...items, ...placed] };
  };

  const handleCtxAction = (actionId) => {
    if (actionId === "group") { groupSelection(); return; }
    if (actionId === "ungroup") { ungroupSelection(); return; }

    if (selection?.coll === "items" && selection.ids.length > 1) {
      if (actionId === "delete") delSel();
      else if (actionId === "rotate90") {
        selection.ids.forEach((id) => {
          const it = plan.items.find((i) => i.id === id);
          if (it) rotateItem(it, 90);
        });
      } else if (actionId === "duplicate") duplicateItems();
      return;
    }

    if (!sel) return;
    const obj = plan[sel.coll]?.find((o) => o.id === sel.id);
    if (!obj) return;
    if (actionId === "delete") delSel();
    else if (actionId === "rotate90" && sel.coll === "items") rotateItem(obj, 90);
    else if (actionId === "mirror-h" && sel.coll === "items") mirrorItem(obj, "h");
    else if (actionId === "mirror-v" && sel.coll === "items") mirrorItem(obj, "v");
    else if (actionId === "duplicate" && sel.coll === "items") duplicateItem(obj);
    else if (actionId === "door-swing" && sel.coll === "items") {
      updateObj("items", obj.id, { doorSwing: obj.doorSwing === "right" ? "left" : "right" });
    }
    else if (actionId === "door-open-in" && sel.coll === "items") {
      updateObj("items", obj.id, { doorOpenIn: obj.doorOpenIn === false });
    }
    else if (actionId === "door-num" && sel.coll === "items") {
      const num = prompt("Номер двери:", obj.doorNum || nextDoorNumber(plan.items));
      if (num != null) updateObj("items", obj.id, { doorNum: num.trim() });
    }
    else if (actionId === "opening-shape" && sel.coll === "items") {
      updateObj("items", obj.id, { openingShape: obj.openingShape === "arch" ? "rect" : "arch" });
    }
    else if (actionId === "opening-num" && sel.coll === "items") {
      const num = prompt("Номер проёма:", obj.openingNum || nextOpeningNumber(plan.items));
      if (num != null) updateObj("items", obj.id, { openingNum: num.trim() });
    }
    else if (actionId === "hide-client" && sel.coll === "items") {
      updateObj("items", obj.id, { visibleToClient: obj.visibleToClient === false });
    }
    else if (actionId === "spec" && sel.coll === "items") syncSpec();
    else if (actionId === "add-label" && sel.coll === "items") {
      addLabelAt({ x: obj.x + obj.w / 2, y: obj.y + obj.h / 2 }, obj.id);
    }
    else if (actionId === "item-lock" && sel.coll === "items") {
      updateObj("items", obj.id, { locked: !obj.locked });
    }
    else if (actionId === "rack-num" && sel.coll === "items" && isRackKind(obj.kind)) {
      const num = prompt("Номер стеллажа:", obj.rackNum || nextRackNumber(plan.items, obj.id));
      if (num != null) updateObj("items", obj.id, { rackNum: num.trim() });
    }
    else if (actionId === "rack-auto-num" && sel.coll === "items") {
      setPlan((p) => ({ ...p, items: autoNumberRacks(p.items) }));
    }
    else if (actionId === "rack-row" && sel.coll === "items" && isRackKind(obj.kind)) {
      const count = parseInt(prompt("Сколько стеллажей в ряду?", "4"), 10);
      if (!count || count < 2) return;
      const gap = parseInt(prompt("Зазор между стеллажами, мм:", "800"), 10) || 800;
      setPlan((p) => placeRackCopies(p, obj, buildRackGrid(obj, { cols: count, rows: 1, gapMm: gap })));
    }
    else if (actionId === "rack-link-tank" && sel.coll === "items" && isRackKind(obj.kind)) {
      const target = findRackLinkTarget(plan.items, obj, RACK_LINK_ACTIONS[0]);
      if (!target) { window.alert("Не найден бак или водоподготовка рядом."); return; }
      if (!createLink(obj.id, target.id, "irrigation")) window.alert("Не удалось создать связь полива.");
    }
    else if (actionId === "rack-link-pump" && sel.coll === "items" && isRackKind(obj.kind)) {
      const target = findRackLinkTarget(plan.items, obj, RACK_LINK_ACTIONS[1]);
      if (!target) { window.alert("Не найден насос рядом."); return; }
      if (!createLink(obj.id, target.id, "irrigation")) window.alert("Не удалось создать связь.");
    }
    else if (actionId === "rack-link-socket" && sel.coll === "items" && isRackKind(obj.kind)) {
      const target = findRackLinkTarget(plan.items, obj, RACK_LINK_ACTIONS[2]);
      if (!target) { window.alert("Не найдена розетка или щит рядом."); return; }
      if (!createLink(obj.id, target.id, "power")) window.alert("Не удалось создать связь.");
    }
    else if (actionId === "rack-link-light" && sel.coll === "items" && isRackKind(obj.kind)) {
      const target = findRackLinkTarget(plan.items, obj, RACK_LINK_ACTIONS[3]);
      if (!target) { window.alert("Не найдено освещение или розетка рядом."); return; }
      if (!createLink(obj.id, target.id, "light")) window.alert("Не удалось создать связь.");
    }
    else if (actionId === "rack-grid" && sel.coll === "items" && isRackKind(obj.kind)) {
      const cols = parseInt(prompt("Стеллажей в ряду (по горизонтали)?", "4"), 10);
      const rows = parseInt(prompt("Количество рядов?", "2"), 10);
      if (!cols || !rows || cols < 1 || rows < 1) return;
      const gap = parseInt(prompt("Зазор между стеллажами, мм:", "800"), 10) || 800;
      const rowGap = parseInt(prompt("Проход между рядами, мм:", "1200"), 10) || 1200;
      const dir = prompt("Направление рядов (h — горизонтально, v — вертикально):", "h");
      setPlan((p) => placeRackCopies(p, obj, buildRackGrid(obj, {
        cols, rows, gapMm: gap, rowGapMm: rowGap, direction: dir === "v" ? "v" : "h",
      })));
    }
    else if (actionId === "wall-kind" && sel.coll === "walls") {
      const pick = prompt(
        "Тип стены (existing, new, demolish, technical, sandwich, brick, drywall, cold_panel):",
        obj.kind || "new",
      );
      if (pick && WALL_KINDS[pick]) updateObj("walls", obj.id, { kind: pick });
    }
    else if (actionId === "wall-thk" && sel.coll === "walls") {
      const thk = prompt("Толщина стены, мм:", String(obj.thk || 100));
      if (thk) updateObj("walls", obj.id, { thk: Math.max(40, +thk || 100) });
    }
    else if (actionId === "wall-height" && sel.coll === "walls") {
      const h = prompt("Высота стены, мм:", String(obj.height || 2700));
      if (h) updateObj("walls", obj.id, { height: Math.max(500, +h || 2700) });
    }
    else if (actionId === "wall-side" && sel.coll === "walls") {
      const pick = prompt("Сторона толщины (center, in, out):", obj.thicknessSide || "center");
      if (pick && THICKNESS_SIDES.some((s) => s.id === pick)) updateObj("walls", obj.id, { thicknessSide: pick });
    }
    else if (actionId === "wall-length" && sel.coll === "walls") {
      const segIdx = wallSegmentIndexForNode(obj, selection?.nodeIdx);
      const segLen = wallSegmentLengthAt(obj, selection?.nodeIdx)
        || (obj.pts?.length >= 2
          ? Math.hypot(obj.pts[obj.pts.length - 1].x - obj.pts[obj.pts.length - 2].x, obj.pts[obj.pts.length - 1].y - obj.pts[obj.pts.length - 2].y)
          : 0);
      const len = prompt(`Длина сегмента ${segIdx + 1}, мм:`, String(Math.round(segLen)));
      if (len) {
        const nw = setWallSegmentLengthAt(obj, segIdx, Math.max(100, +len || 0));
        updateObj("walls", obj.id, { pts: nw.pts });
      }
    }
    else if (actionId === "wall-length-total" && sel.coll === "walls") {
      const pts = obj.pts || [];
      let sumOther = 0;
      for (let i = 0; i < pts.length - 2; i++) {
        sumOther += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
      }
      const total = polyLength(pts);
      const len = prompt(
        `Суммарная длина стены, мм (сейчас ${Math.round(total)}). Будет изменён последний сегмент:`,
        String(Math.round(total)),
      );
      if (len) {
        const lastLen = Math.max(100, (+len || 0) - sumOther);
        const nw = setWallSegmentLength(obj, lastLen);
        updateObj("walls", obj.id, { pts: nw.pts });
      }
    }
    else if (actionId === "wall-role-outer" && sel.coll === "walls") {
      updateObj("walls", obj.id, { role: "outer", kind: obj.kind || "existing" });
    }
    else if (actionId === "wall-role-partition" && sel.coll === "walls") {
      updateObj("walls", obj.id, { role: "partition", kind: obj.kind || "new" });
    }
    else if (actionId === "wall-straight-h" && sel.coll === "walls") {
      const nw = straightenWall(obj, "h");
      updateObj("walls", obj.id, { pts: nw.pts });
    }
    else if (actionId === "wall-straight-v" && sel.coll === "walls") {
      const nw = straightenWall(obj, "v");
      updateObj("walls", obj.id, { pts: nw.pts });
    }
    else if (actionId === "wall-align" && sel.coll === "walls") {
      setPlan((p) => {
        const walls = alignWallToNeighbor(p.walls, obj.id);
        if (!walls) {
          window.alert("Нет соседней стены с общим узлом для выравнивания.");
          return p;
        }
        return syncAutoZones({
          ...p,
          walls,
          items: refreshWallMountedItems(p.items, walls, p.room, obj.id),
        });
      });
    }
    else if (actionId === "wall-merge" && sel.coll === "walls") {
      const res = tryMergeWall(plan.walls, obj.id);
      if (!res) {
        window.alert("Не найдена соседняя стена с общим узлом для объединения.");
        return;
      }
      setPlan((p) => syncAutoZones({
        ...p,
        walls: res.walls,
        items: refreshWallMountedItems(p.items, res.walls, p.room),
      }));
      setSel({ coll: "walls", id: res.mergedId });
    }
    else if (actionId === "wall-break" && sel.coll === "walls") {
      const mm = ctxMenuRef.current?.mm;
      if (!mm) return;
      const parts = breakWallAt(obj, mm);
      if (!parts) {
        window.alert("Не удалось разорвать стену — кликните ближе к сегменту.");
        return;
      }
      const [w1, w2] = parts;
      w2.id = uid("wl");
      setPlan((p) => syncAutoZones({
        ...p,
        walls: p.walls.flatMap((w) => (w.id === obj.id ? [w1, w2] : [w])),
      }));
      setSel({ coll: "walls", id: w2.id });
    }
    else if (actionId === "rename" && sel.coll === "zones") {
      const name = prompt("Название помещения:", obj.name || "Помещение");
      if (name) updateObj("zones", obj.id, { name });
    }
    else if (sel.coll === "lines") {
      const mm = ctxMenuRef.current?.mm;
      if (actionId === "line-insert-node" && mm) {
        updateObj("lines", obj.id, insertPointOnLine(obj, mm));
      } else if (actionId === "line-delete-node" && selection?.nodeIdx != null) {
        updateObj("lines", obj.id, removeLineNode(obj, selection.nodeIdx));
      } else if (actionId === "line-reverse") {
        updateObj("lines", obj.id, reverseLine(obj));
      } else if (actionId === "line-attach") {
        updateObj("lines", obj.id, attachLineEndpoints(obj, plan.items));
      } else if (actionId === "line-toggle-arrows") {
        updateObj("lines", obj.id, { showArrows: obj.showArrows === false });
      } else if (actionId === "line-ortho") {
        updateObj("lines", obj.id, { orthoRoute: obj.orthoRoute === false });
      }
    }
    else if (sel.coll === "links") {
      if (actionId === "link-toggle-visible") {
        updateObj("links", obj.id, { visible: obj.visible === false });
      } else if (actionId === "link-ortho") {
        updateObj("links", obj.id, { ortho: obj.ortho === false });
      }
    }
  };

  const onContextMenu = (e) => {
    if (active === "spec") return;
    const mm = toMM(e.clientX, e.clientY);
    let hit = null;
    for (const it of [...plan.items].reverse()) {
      if (mm.x >= it.x && mm.x <= it.x + it.w && mm.y >= it.y && mm.y <= it.y + it.h) {
        hit = { coll: "items", id: it.id };
        break;
      }
    }
    if (!hit) {
      for (const w of plan.walls) {
        for (let i = 1; i < w.pts.length; i++) {
          const a = w.pts[i - 1];
          const b = w.pts[i];
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          if (Math.hypot(mm.x - mid.x, mm.y - mid.y) < w.thk) {
            hit = { coll: "walls", id: w.id };
            break;
          }
        }
        if (hit) break;
      }
    }
    if (!hit) {
      for (const ln of plan.lines) {
        if (hitTestLine(mm, ln, 140 / Math.max(view.zoom, 0.2))) {
          hit = { coll: "lines", id: ln.id };
          break;
        }
      }
    }
    if (!hit) {
      for (const link of linksVisibleOnLayer(plan.links, active, display)) {
        const { pts } = linkLengthMm(link, plan.items, plan.room);
        if (pts.length >= 2 && hitTestLine(mm, { pts }, 120 / Math.max(view.zoom, 0.2))) {
          hit = { coll: "links", id: link.id };
          break;
        }
      }
    }
    if (!hit && (active === "zones" || activeSheetId === "zones")) {
      for (const z of plan.zones) {
        if (pointInZone(mm, z)) {
          hit = { coll: "zones", id: z.id };
          break;
        }
      }
    }
    if (!hit && selection?.ids?.length === 1) {
      hit = { coll: selection.coll, id: selection.ids[0] };
    }
    if (!hit) return;
    e.preventDefault();
    if (selection?.coll === "items" && selection.ids.length > 1 && hit.coll === "items" && selection.ids.includes(hit.id)) {
      setCtxMenu({
        x: e.clientX,
        y: e.clientY,
        mm,
        items: buildObjectMenu({}, "items", { multiCount: selection.ids.length }),
      });
      return;
    }
    setSel(hit);
    const obj = plan[hit.coll]?.find((o) => o.id === hit.id);
    setCtxMenu({ x: e.clientX, y: e.clientY, mm, items: buildObjectMenu(obj || {}, hit.coll, { nodeIdx: selection?.nodeIdx }) });
  };

  const orthoTools = tool === "line" || tool === "wall" || tool === "measure";

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "Shift") shiftRef.current = true;
      if (e.key === "Alt") { altSnapRef.current = true; setAltSnapOff(true); }
      if (e.key === " " && document.activeElement === document.body) { e.preventDefault(); setSpacePan(true); }
      if (e.key === "Escape") {
        clearWallChain(); setMeasure([]); clearSelection(); setGuides([]);
        setTool("select"); setPending(null); setTypedLength(""); setDraftSnap(null);
        setMarquee(null);
      }
      if (e.key === "Enter") {
        if (typedLengthRef.current && (tool === "wall" || tool === "line") && draft.length >= 1) {
          e.preventDefault();
          applyTypedLength();
          return;
        }
        if (draft.length >= 2) finishDraft();
        else if (tool === "wall" && draft.length >= 1) finishDraft();
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selection?.ids?.length && document.activeElement === document.body && !typedLengthRef.current) delSel();
      if (/^\d$/.test(e.key) && (tool === "wall" || tool === "line") && draft.length >= 1) {
        e.preventDefault();
        setTypedLength((s) => s + e.key);
      }
      if (e.key === "Backspace" && typedLengthRef.current && (tool === "wall" || tool === "line")) {
        e.preventDefault();
        setTypedLength((s) => s.slice(0, -1));
      }
      if (e.key === "f" || e.key === "F") fitView();
      if (e.ctrlKey && e.key === "z") { e.preventDefault(); undo(); }
      if (e.ctrlKey && (e.key === "y" || (e.shiftKey && e.key === "z"))) { e.preventDefault(); redo(); }
      if (e.ctrlKey && e.key === "c") { e.preventDefault(); copySel(); }
      if (e.ctrlKey && e.key === "v") { e.preventDefault(); pasteSel(); }
      if (e.ctrlKey && !e.shiftKey && (e.key === "g" || e.key === "G")) { e.preventDefault(); groupSelection(); }
      if (e.ctrlKey && e.shiftKey && (e.key === "g" || e.key === "G")) { e.preventDefault(); ungroupSelection(); }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && document.activeElement === document.body) moveSelByKeys(e);
      if ((e.key === "[" || e.key === "]") && selection?.coll === "items" && selection.ids.length) {
        e.preventDefault();
        const step = e.shiftKey ? 90 : e.altKey ? 1 : 15;
        const sign = e.key === "]" ? 1 : -1;
        selection.ids.forEach((id) => {
          const it = plan.items.find((i) => i.id === id);
          if (it && !isDoorKind(it.kind)) rotateItem(it, sign * step);
        });
      }
    };
    const onKeyUp = (e) => {
      if (e.key === "Shift") shiftRef.current = false;
      if (e.key === "Alt") { altSnapRef.current = false; setAltSnapOff(false); }
      if (e.key === " ") setSpacePan(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
  });

  if (standalone && !draftMeta) {
    return (
      <div className="content">
        <Empty title="Черновик не найден">
          <Link className="btn btn-primary" to="/planner">К планировщику</Link>
        </Empty>
      </div>
    );
  }

  if (!standalone && !project) {
    return (
      <div className="content">
        <Empty title="Проект не найден">
          <Link className="btn btn-primary" to="/planner">К планировщику</Link>
        </Empty>
      </div>
    );
  }

  const planTitle = standalone ? draftMeta.name : project.name;
  const planMetaId = standalone ? draftMeta.id : project.id.replace(/\D/g, "").slice(0, 7);

  const handleRenameDraft = (name) => {
    const next = renameStandalonePlan(draftId, name);
    if (next) setDraftMeta(next);
  };

  const handleExportJson = () => {
    downloadPlanFile({ ...draftMeta, plan });
  };

  const handleImportJson = async (file) => {
    try {
      const { plan: imported } = await readPlanFile(file);
      resetHistory(withDefaults(imported));
      setSaved(false);
    } catch (e) {
      alert("Не удалось импортировать: " + (e?.message || e));
    }
  };

  const handleAttachToProject = async (targetProject) => {
    const itemCount = targetProject.plan?.items?.length ?? 0;
    const wallCount = targetProject.plan?.walls?.length ?? 0;
    if ((itemCount > 0 || wallCount > 0) && !window.confirm(
      `У проекта «${targetProject.name}» уже есть план (${itemCount} объектов). Заменить черновиком?`,
    )) return;
    setBusy(true);
    try {
      const snapshot = withDefaults(plan);
      await actions.projectUpdate(targetProject.id, {
        plan: snapshot,
        plannerAttachedAt: new Date().toISOString(),
        plannerAttachedFrom: draftId,
      });
      setAttachOpen(false);
      const del = window.confirm(
        `План привязан к «${targetProject.name}». Удалить черновик из браузера?`,
      );
      if (del) deleteStandalonePlan(draftId);
      navigate(`/project/${targetProject.id}/plan`);
    } catch (e) {
      window.alert("Не удалось привязать: " + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const specSummary = plannerSpecSummary(plan);

  const onDown = (e) => {
    svgRef.current.setPointerCapture(e.pointerId);
    const mm = toMM(e.clientX, e.clientY);
    const panTool = tool === "pan" || spacePan || e.button === 1;
    const bgClick = e.target === svgRef.current || e.target.getAttribute("data-canvas-bg") === "1";

    if (panTool) {
      dragRef.current = { mode: "pan", sx: e.clientX, sy: e.clientY, px: view.panX, py: view.panY };
      return;
    }
    if (active === "spec") return;
    if (tool === "add" && pending) return addItemAt(mm);
    if (tool === "zone") return addZoneAt(mm);
    if (tool === "label") return addLabelAt(mm, null);
    if (tool === "line" || tool === "wall") {
      const last = draft[draft.length - 1];
      const { pt, snap, angleSnap } = computeDraftPt(mm, last);
      setDraftAngleSnap(angleSnap);
      if (tool === "wall") {
        if (!last) {
          wallChainStartRef.current = pt;
          setDraft([pt]);
          setDraftSnap(snap);
          return;
        }
        if (snap?.kind === "close" && wallChainStartRef.current) {
          commitWallSegment(last, wallChainStartRef.current);
          clearWallChain();
          return;
        }
        commitWallSegment(last, pt);
        setDraft([pt]);
        setDraftSnap(snap);
        return;
      }
      setDraftSnap(snap);
      setDraft((d) => [...d, pt]);
      return;
    }
    if (tool === "measure") {
      const pt = measure.length === 1
        ? draftPt(measure[0], mm, { ...draftSnapOpts(), snapOn: snapOn && !altSnapRef.current }).point
        : { x: sn(mm.x), y: sn(mm.y) };
      setMeasure((m) => (m.length >= 2 ? [pt] : [...m, pt]));
      return;
    }
    if (tool === "select" && bgClick && e.button === 0) {
      if (e.shiftKey) {
        dragRef.current = {
          mode: "marquee",
          x1: mm.x,
          y1: mm.y,
          additive: e.ctrlKey || e.metaKey,
        };
        if (!e.ctrlKey && !e.metaKey) clearSelection();
        return;
      }
      dragRef.current = { mode: "pan", sx: e.clientX, sy: e.clientY, px: view.panX, py: view.panY };
      return;
    }
    if (bgClick) clearSelection();
  };

  const onMove = (e) => {
    const raw = toMM(e.clientX, e.clientY);
    let mm = raw;
    if (orthoTools && draft.length > 0) {
      const { pt, snap, angleSnap } = computeDraftPt(raw, draft[draft.length - 1]);
      setDraftSnap(snap);
      setDraftAngleSnap(angleSnap);
      mm = pt;
    } else {
      setDraftSnap(null);
      setDraftAngleSnap(null);
    }
    setCursor(mm);
    const d = dragRef.current;
    if (!d) return;
    if (d.mode === "pan") setView((v) => ({ ...v, panX: d.px + (e.clientX - d.sx), panY: d.py + (e.clientY - d.sy) }));
    else if (d.mode === "rotate") {
      const ang = (Math.atan2(mm.y - d.cy, mm.x - d.cx) * 180) / Math.PI;
      let next = Math.round(d.baseAngle + (ang - d.startAngle));
      next = ((next % 360) + 360) % 360;
      updateObj("items", d.id, { angle: next });
    } else if (d.mode === "move") {
      const obj = plan[d.coll].find((o) => o.id === d.id);
      if (!obj || obj.locked) return;
      let dx = mm.x - d.dx;
      let dy = mm.y - d.dy;
      if (dragShiftOn(shiftRef.current, altSnapRef.current)) {
        ({ dx, dy } = constrainAxisDelta(dx, dy, true));
      }
      let x = d.ox + dx;
      let y = d.oy + dy;
      if (d.coll === "items" && obj.wall) {
        const placed = attachWall({ ...obj, kind: obj.kind }, x, y);
        if (!placed || placed.error) return;
        x = placed.x;
        y = placed.y;
        updateObj(d.coll, d.id, attachItemZoneFields(plan, {
          ...obj, x, y,
          angle: placed.angle || obj.angle || 0,
          wallId: placed.wallId,
          wallSeg: placed.wallSeg,
        }));
        setGuides([]);
      } else {
        const s = snapObj(d.coll, obj, x, y);
        x = s.x; y = s.y;
        setGuides(s.guides);
        if (d.coll === "items") {
          const ldx = x - obj.x;
          const ldy = y - obj.y;
          setPlan((p) => ({
            ...p,
            items: p.items.map((it) => (
              it.id === d.id ? attachItemZoneFields(p, { ...it, x, y }) : it
            )),
            labels: p.labels.map((lb) => {
              if (lb.pinned || lb.targetId !== d.id) return lb;
              return { ...lb, x: (lb.x || 0) + ldx, y: (lb.y || 0) + ldy };
            }),
          }));
        } else {
          updateObj(d.coll, d.id, { x, y });
        }
      }
    } else if (d.mode === "move-items" || d.mode === "move-pending") {
      const anchorX = d.mode === "move-pending" ? d.mm.x : d.dx;
      const anchorY = d.mode === "move-pending" ? d.mm.y : d.dy;
      if (d.mode === "move-pending" && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) <= 5) return;
      let dx = mm.x - anchorX;
      let dy = mm.y - anchorY;
      if (dragShiftOn(shiftRef.current, altSnapRef.current)) {
        ({ dx, dy } = constrainAxisDelta(dx, dy, true));
      }
      let origins = d.origins;
      let ids = d.ids;
      if (d.mode === "move-pending") {
        ids = selection?.coll === "items" && selection.ids.includes(d.triggerId)
          ? [...selection.ids]
          : [d.triggerId];
        origins = {};
        const labelOrigins = {};
        ids.forEach((id) => {
          const o = plan.items.find((i) => i.id === id);
          if (o) origins[id] = { x: o.x, y: o.y };
        });
        plan.labels.forEach((lb) => {
          if (!lb.pinned && lb.targetId && ids.includes(lb.targetId)) {
            labelOrigins[lb.id] = { x: lb.x || 0, y: lb.y || 0 };
          }
        });
        dragRef.current = { mode: "move-items", ids, origins, labelOrigins, dx: d.mm.x, dy: d.mm.y };
      }
      setPlan((p) => {
        const lead = ids.map((id) => p.items.find((i) => i.id === id)).find(Boolean);
        let snapDx = 0;
        let snapDy = 0;
        let snapGuides = [];
        if (lead && !lead.wall) {
          const s = snapObj("items", lead, lead.x + dx, lead.y + dy);
          snapDx = s.x - (lead.x + dx);
          snapDy = s.y - (lead.y + dy);
          snapGuides = s.guides;
        }
        setGuides(snapGuides);
        const labelOrigins = d.labelOrigins || {};
        return {
          ...p,
          labels: p.labels.map((lb) => {
            const lo = labelOrigins[lb.id];
            if (!lo) return lb;
            return { ...lb, x: lo.x + dx + snapDx, y: lo.y + dy + snapDy };
          }),
          items: p.items.map((it) => {
            const o = origins[it.id];
            if (!o) return it;
            let x = o.x + dx + snapDx;
            let y = o.y + dy + snapDy;
          if (display.onlyInsideRooms && p.zones.length > 0) {
            const inside = p.zones.some((z) => {
              const poly = z.polygon?.length >= 3 ? z.polygon : [
                { x: z.x, y: z.y }, { x: z.x + z.w, y: z.y },
                { x: z.x + z.w, y: z.y + z.h }, { x: z.x, y: z.y + z.h },
              ];
              return pointInPolygon({ x: x + it.w / 2, y: y + it.h / 2 }, poly);
            });
            if (!inside) return it;
          }
          if (it.wall) {
            const placed = attachWall({ ...it, kind: it.kind }, x, y);
            if (!placed || placed.error) return it;
            return { ...it, x: placed.x, y: placed.y, angle: placed.angle || it.angle || 0, wallId: placed.wallId };
          }
          if (snapDx || snapDy) {
            return attachItemZoneFields(p, { ...it, x, y });
          }
          const s = snapObj("items", it, x, y);
          return attachItemZoneFields(p, { ...it, x: s.x, y: s.y });
        }),
        };
      });
    } else if (d.mode === "marquee") {
      setMarquee({ x1: d.x1, y1: d.y1, x2: mm.x, y2: mm.y });
    } else if (d.mode === "wall-move") {
      let dx = mm.x - d.dx;
      let dy = mm.y - d.dy;
      if (dragShiftOn(shiftRef.current, altSnapRef.current)) {
        ({ dx, dy } = constrainAxisDelta(dx, dy, true));
      }
      setPlan((p) => {
        const walls = p.walls.map((w) => (w.id !== d.id ? w : {
          ...w,
          pts: d.origPts.map((pt) => ({ x: sn(pt.x + dx), y: sn(pt.y + dy) })),
        }));
        return syncAutoZones({
          ...p,
          walls,
          items: refreshWallMountedItems(p.items, walls, p.room, d.id),
        });
      });
    } else if (d.mode === "resize") {
      const obj = plan[d.coll].find((o) => o.id === d.id);
      if (!obj) return;
      if (d.coll === "zones" && (obj.locked || obj.auto)) return;
      if (obj.locked) return;
      const axis = d.axis || "corner";
      if (axis === "w") {
        updateObj(d.coll, d.id, { w: Math.max(50, sn(mm.x - obj.x)) });
      } else if (axis === "h") {
        updateObj(d.coll, d.id, { h: Math.max(50, sn(mm.y - obj.y)) });
      } else {
        updateObj(d.coll, d.id, { w: Math.max(50, sn(mm.x - obj.x)), h: Math.max(50, sn(mm.y - obj.y)) });
      }
    } else if (d.mode === "node") {
      if (d.coll === "walls") {
        const wall = plan.walls.find((w) => w.id === d.id);
        let pt = { x: mm.x, y: mm.y };
        if (wall?.pts?.length >= 2) {
          const anchorIdx = d.idx > 0 ? d.idx - 1 : 1;
          const anchor = wall.pts[anchorIdx];
          pt = constrainAxisPoint(anchor, pt, dragShiftOn(shiftRef.current, altSnapRef.current));
        }
        const snapped = snapWallPoint(pt, plan.walls, plan.room, view.zoom, snapOn && display.snapWalls !== false && !altSnapRef.current, snapStep);
        setPlan((p) => {
          let walls = weldWallNodes(applyWallNodeMove(p.walls, d.id, d.idx, { x: snapped.x, y: snapped.y }));
          return syncAutoZones({
            ...p,
            walls,
            items: refreshWallMountedItems(p.items, walls, p.room),
          });
        });
      } else {
        const snapped = snapLinePoint(
          { x: mm.x, y: mm.y },
          plan.items,
          snapOn && display.snapObjects !== false,
        );
        setPlan((p) => {
          const lines = p.lines.map((l) => {
            if (l.id !== d.id || l.locked) return l;
            const pts = l.pts.map((pt, i) => (i === d.idx ? { x: snapped.x, y: snapped.y } : pt));
            const patch = { pts };
            if (d.idx === 0 && snapped.itemId) {
              patch.fromItemId = snapped.itemId;
              patch.fromPortIndex = snapped.portIndex ?? null;
            }
            if (d.idx === l.pts.length - 1 && snapped.itemId) {
              patch.toItemId = snapped.itemId;
              patch.toPortIndex = snapped.portIndex ?? null;
            }
            return { ...l, ...patch };
          });
          return { ...p, lines };
        });
      }
    }
  };

  const onUp = (e) => {
    const d = dragRef.current;
    if (d?.mode === "marquee") {
      const mm = toMM(e.clientX, e.clientY);
      const ids = itemsInMarquee(plan.items, d.x1, d.y1, mm.x, mm.y);
      if (d.additive && selection?.coll === "items") {
        const merged = new Set([...selection.ids, ...ids]);
        setSelection(merged.size ? { coll: "items", ids: [...merged] } : null);
      } else {
        setSelection(ids.length ? { coll: "items", ids } : null);
      }
    } else if (d?.mode === "move" && d.coll === "labels") {
      const obj = plan.labels.find((o) => o.id === d.id);
      if (obj && !obj.pinned) updateObj("labels", obj.id, { pinned: true });
    }
    dragRef.current = null;
    setMarquee(null);
    setGuides([]);
    setHoverWallNode(null);
    try { svgRef.current.releasePointerCapture(e.pointerId); } catch (_) {}
  };

  const onWheel = (e) => {
    e.preventDefault();
    const r = svgRef.current.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const mmx = (mx - view.panX) / view.zoom;
    const mmy = (my - view.panY) / view.zoom;
    const nz = clamp(view.zoom * (e.deltaY < 0 ? 1.12 : 0.89), 0.015, 3);
    setView({ zoom: nz, panX: mx - mmx * nz, panY: my - mmy * nz });
  };

  const z = view.zoom;
  const k = 1 / z;
  const sel = selection?.ids?.length === 1 ? { coll: selection.coll, id: selection.ids[0] } : null;
  const selObj = sel ? plan[sel.coll]?.find((o) => o.id === sel.id) : null;
  const multiBounds = selection?.coll === "items" && selection.ids.length > 1
    ? boundsOfItems(plan.items, selection.ids)
    : null;

  const startMoveItems = (ids, mm) => {
    const movable = ids.filter((id) => !plan.items.find((i) => i.id === id)?.locked);
    if (!movable.length) return;
    const origins = {};
    const labelOrigins = {};
    movable.forEach((id) => {
      const o = plan.items.find((i) => i.id === id);
      if (o) origins[id] = { x: o.x, y: o.y };
    });
    plan.labels.forEach((lb) => {
      if (!lb.pinned && lb.targetId && movable.includes(lb.targetId)) {
        labelOrigins[lb.id] = { x: lb.x || 0, y: lb.y || 0 };
      }
    });
    dragRef.current = { mode: "move-items", ids: movable, origins, labelOrigins, dx: mm.x, dy: mm.y };
  };

  const startMove = (e, coll, obj) => {
    if (coll === "zones" && obj.locked) return;
    if (coll === "items" && obj.locked) return;
    e.stopPropagation();
    svgRef.current.setPointerCapture(e.pointerId);
    const mm = toMM(e.clientX, e.clientY);
    let ox = obj.x;
    let oy = obj.y;
    if (coll === "labels" && obj.targetId && !obj.pinned) {
      const tgt = plan.items.find((i) => i.id === obj.targetId);
      if (tgt) {
        const pos = resolveFreeLabelPosition(obj, tgt);
        ox = pos.x;
        oy = pos.y;
        updateObj("labels", obj.id, { x: ox, y: oy, pinned: true });
      }
    }
    setSel({ coll, id: obj.id });
    dragRef.current = { mode: "move", coll, id: obj.id, ox, oy, dx: mm.x, dy: mm.y };
  };
  const startRotate = (e, it) => {
    e.stopPropagation();
    svgRef.current.setPointerCapture(e.pointerId);
    setSel({ coll: "items", id: it.id });
    const mm = toMM(e.clientX, e.clientY);
    const cx = it.x + it.w / 2;
    const cy = it.y + it.h / 2;
    dragRef.current = {
      mode: "rotate", id: it.id, cx, cy,
      startAngle: (Math.atan2(mm.y - cy, mm.x - cx) * 180) / Math.PI,
      baseAngle: it.angle || 0,
    };
  };
  const startResize = (e, coll, obj, axis = "corner") => {
    if (coll === "zones" && (obj.locked || obj.auto)) return;
    if (coll === "items" && obj.locked) return;
    e.stopPropagation();
    svgRef.current.setPointerCapture(e.pointerId);
    setSel({ coll, id: obj.id });
    dragRef.current = { mode: "resize", coll, id: obj.id, axis };
  };
  const startNode = (e, coll, oid, idx) => {
    e.stopPropagation();
    svgRef.current.setPointerCapture(e.pointerId);
    setSelection({ coll, ids: [oid], nodeIdx: idx });
    dragRef.current = { mode: "node", coll, id: oid, idx };
    if (coll === "walls") setHoverWallNode({ wallId: oid, idx });
  };
  const startWallMove = (e, wall) => {
    e.stopPropagation();
    svgRef.current.setPointerCapture(e.pointerId);
    const mm = toMM(e.clientX, e.clientY);
    setSel({ coll: "walls", id: wall.id });
    dragRef.current = { mode: "wall-move", id: wall.id, dx: mm.x, dy: mm.y, origPts: wall.pts.map((p) => ({ ...p })) };
  };

  const onItemDown = (e, it) => {
    if (it.locked) {
      e.stopPropagation();
      setSel({ coll: "items", id: it.id });
      return;
    }
    if (tool === "link") {
      e.stopPropagation();
      const type = linkTypeForLayer(active);
      if (!type) return;
      if (!linkFrom) {
        setLinkFrom(it.id);
        setSel({ coll: "items", id: it.id });
        return;
      }
      if (linkFrom === it.id) {
        setLinkFrom(null);
        return;
      }
      const fromItem = plan.items.find((i) => i.id === linkFrom);
      if (!canCreateLink(type, fromItem, it)) {
        window.alert("Нельзя связать эти объекты. Проверьте типы (напр. стеллаж→бак, розетка→щит).");
        return;
      }
      createLink(linkFrom, it.id, type);
      setLinkFrom(null);
      return;
    }
    if (tool === "label") { e.stopPropagation(); addLabelAt({ x: it.x + it.w / 2, y: it.y + it.h / 2 }, it.id); return; }

    e.stopPropagation();
    svgRef.current.setPointerCapture(e.pointerId);
    const mm = toMM(e.clientX, e.clientY);
    const add = (e.ctrlKey || e.metaKey) && tool === "select";

    if (add) {
      setSelection((prev) => {
        const ids = prev?.coll === "items" ? [...prev.ids] : [];
        const idx = ids.indexOf(it.id);
        if (idx >= 0) ids.splice(idx, 1);
        else ids.push(it.id);
        return ids.length ? { coll: "items", ids } : null;
      });
      dragRef.current = {
        mode: "move-pending",
        triggerId: it.id,
        sx: e.clientX,
        sy: e.clientY,
        mm,
      };
      return;
    }

    let moveIds;
    if (selection?.coll === "items" && selection.ids.includes(it.id)) {
      moveIds = selection.ids;
    } else {
      moveIds = groupMemberIds(plan.items, it);
      setSelection({ coll: "items", ids: moveIds });
    }
    startMoveItems(moveIds, mm);
  };

  const exportPDF = async (mode = "full") => {
    setBusy(true);
    try {
      await exportLayeredPDF(
        svgRef.current,
        plan.room,
        PDF_SHEETS.map((l) => ({ id: l.id, sheet: l.sheet })),
        { projectName: planTitle, projectId: planMetaId, version: "1" },
        mode,
        { pdfGridInstall: display.pdfGridInstall, pdfGridTechnical: display.pdfGridTechnical, pdfGridMajorOnly: display.pdfGridMajorOnly },
      );
    } catch (e) { alert("Не удалось собрать PDF: " + e.message); }
    setBusy(false);
  };

  const syncSpec = async () => {
    if (standalone) return;
    setBusy(true);
    try {
      const materials = state.materialsLoaded ? state.materials : await actions.ensureMaterials();
      const modules = state.modulesLoaded ? state.modules : await actions.ensureModules();
      const res = createPlannerSpecItems({ plan, materials, modules, existingItems: project.items || [] });
      await actions.projectUpdate(project.id, { items: res.items, plan, plannerSyncAt: new Date().toISOString() });
      alert(`Спецификация обновлена из плана.\nПозиции: ${res.generatedCount}\nКомплекты: ${res.kitCount || 0}\nОбъекты: ${res.objectCount}\nТрассы: ${res.lineCount}\nСвязи: ${res.linkCount || 0}`);
    } catch (e) {
      alert("Не удалось обновить спецификацию: " + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const activeSheet = sheetById(activeSheetId);
  const activeFilterId = sheetFilters[activeSheetId] || activeSheet.filters?.[0]?.id || "all";
  const canvasDisplay = useMemo(() => ({ ...display, sheet: activeSheet }), [display, activeSheet]);
  const layerState = useCallback(
    (lid) => layerDisplayState(lid, active, vis, canvasDisplay, activeSheet),
    [active, vis, canvasDisplay, activeSheet],
  );

  const itemsByLayer = (lid) => {
    let items;
    if (lid === "sockets") items = plan.items.filter((it) => it.layer === "sockets" || (it.kind === "socket" && it.layer === "power"));
    else items = plan.items.filter((it) => it.layer === lid);
    if (activeSheet.filters?.length && lid === active) {
      items = items.filter((it) => isItemVisibleOnSheet(it, activeSheetId, activeFilterId, active));
    }
    return items;
  };
  const linesByLayer = (lid) => {
    let lines = plan.lines.filter((l) => l.layer === lid || migrateLayerId(l.layer) === lid);
    if (activeSheet.filters?.length && LINE_LAYER_IDS.includes(lid)) {
      lines = lines.filter((l) => isLineVisibleOnSheet(l, activeSheetId, activeFilterId));
    }
    return lines;
  };

  const visibleLinks = () => linksVisibleOnLayer(plan.links, active, display);

  const warnList = collectPlannerWarnings(plan, sel, display);
  const { critical: criticalWarnIds, warning: warningWarnIds } = useMemo(
    () => warningIdsFromList(warnList),
    [warnList],
  );
  const warnIds = useMemo(() => {
    const s = new Set([...criticalWarnIds, ...warningWarnIds]);
    return s;
  }, [criticalWarnIds, warningWarnIds]);
  const warnWallIds = useMemo(() => {
    const s = new Set();
    warnList.forEach((w) => (w.wallIds || []).forEach((id) => s.add(id)));
    return s;
  }, [warnList]);

  useEffect(() => {
    const critical = warnList.filter((w) => w.severity === "critical");
    const hasNew = critical.some((w) => !criticalWarnIdsRef.current.has(w.id));
    if (hasNew) openWarningsPanel();
    criticalWarnIdsRef.current = new Set(critical.map((w) => w.id));
  }, [warnList, openWarningsPanel]);

  const clientItems = plan.items.filter((it) => it.visibleToClient !== false);
  const partitionWalls = wallsForLayer(plan.walls, "partitions");
  const roomWalls = wallsForLayer(plan.walls, "room");

  const draftCursor = orthoTools && draft.length > 0 ? cursor : null;

  const itemPlacementPreview = useMemo(() => {
    if (tool !== "add" || !pending || !cursor) return null;
    return computeItemPlacement({
      mm: cursor,
      kind: pending,
      size: pendingSize,
      plan,
      display,
      snapObj,
      attachWall,
      innerL,
      innerR,
      innerT,
      innerB,
    });
  }, [tool, pending, cursor, pendingSize, plan, display, snapObj, attachWall, innerL, innerR, innerT, innerB]);

  useEffect(() => {
    if (tool === "add" && pending && itemPlacementPreview) {
      setGuides(itemPlacementPreview.guides || []);
    }
  }, [tool, pending, itemPlacementPreview]);

  const showLabelFor = (lid) => layerState(lid).showLabels;
  const showDimsFor = (lid) => layerState(lid).showDims;
  const selectZone = (e, zn) => {
    e.stopPropagation();
    setSel({ coll: "zones", id: zn.id });
    if (!zn.auto && !zn.locked) startMove(e, "zones", zn);
  };

  const itemProps = (it, lid, extra = {}) => (
    <ItemEl
      key={extra.key || it.id}
      it={it}
      k={k}
      selected={selection?.coll === "items" && selection.ids.includes(it.id)}
      hovered={hoverHit?.coll === "items" && hoverHit.id === it.id}
      showDims={showDimsFor(lid)}
      showLabel={showLabelFor(lid)}
      activeLayer={active}
      vis={vis}
      display={canvasDisplay}
      hasError={criticalWarnIds.has(it.id)}
      hasWarning={warningWarnIds.has(it.id)}
      plan={plan}
      zoom={view.zoom}
      onHover={(id) => setHoverHit(id ? { coll: "items", id } : null)}
      onDown={(e) => onItemDown(e, it)}
      onResize={(e) => startResize(e, "items", it, "corner")}
      onResizeW={(e) => startResize(e, "items", it, "w")}
      onResizeH={(e) => startResize(e, "items", it, "h")}
      onRotateStart={(e) => startRotate(e, it)}
    />
  );

  const handlePickPlanItem = (itemId) => {
    const it = plan.items.find((i) => i.id === itemId);
    if (!it) return;
    const lid = it.layer;
    if (lid && lid !== active && lid !== "client") {
      setActive(lid);
      setTool("select");
      setPending(null);
      clearWallChain();
    }
    setSelection({ coll: "items", ids: [itemId] });
  };

  const centerOnMm = (cx, cy, minZoom = 0.2) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const targetZoom = Math.max(view.zoom, minZoom);
    setView({
      zoom: targetZoom,
      panX: r.width / 2 - cx * targetZoom,
      panY: r.height / 2 - cy * targetZoom,
    });
  };

  const focusPlanWarning = (w) => {
    if (!w) return;
    if (w.objectIds?.[0]) {
      const id = w.objectIds[0];
      const it = plan.items.find((i) => i.id === id);
      if (!it) return;
      handlePickPlanItem(id);
      centerOnMm(it.x + it.w / 2, it.y + it.h / 2);
      return;
    }
    if (w.wallIds?.[0]) {
      const wall = plan.walls.find((x) => x.id === w.wallIds[0]);
      if (!wall?.pts?.length) return;
      const cx = wall.pts.reduce((s, p) => s + p.x, 0) / wall.pts.length;
      const cy = wall.pts.reduce((s, p) => s + p.y, 0) / wall.pts.length;
      setSel({ coll: "walls", id: wall.id });
      centerOnMm(cx, cy);
    }
  };

  const handleSelectLink = (linkId, itemId) => {
    if (itemId) handlePickPlanItem(itemId);
    else setSel({ coll: "links", id: linkId });
    const link = plan.links?.find((l) => l.id === linkId);
    if (link) {
      const from = plan.items.find((i) => i.id === link.fromId);
      const to = plan.items.find((i) => i.id === link.toId);
      const cx = from && to ? (from.x + from.w / 2 + to.x + to.w / 2) / 2 : null;
      const cy = from && to ? (from.y + from.h / 2 + to.y + to.h / 2) / 2 : null;
      if (cx != null) centerOnMm(cx, cy, 0.15);
    }
  };

  const closePropertiesPanel = () => {
    if (!pinnedProperties) {
      clearSelection();
      setWarningsPanelOpen(false);
    }
  };

  const cursorStyle = spacePan || tool === "pan" ? "grab" : tool === "add" || tool === "zone" || tool === "label" ? "copy" : tool === "link" ? "crosshair" : "default";
  const drawerTitle = activeCategoryId
    ? (categoryById(activeCategoryId)?.label || layerById(active).name)
    : layerById(active).name;
  const zonesEditMode = active === "zones" || activeSheetId === "zones";
  const hasSelection = !!(selection?.ids?.length);
  const showProperties = (
    (hasSelection && (selection?.coll !== "zones" || zonesEditMode))
    || pinnedProperties
    || warningsPanelOpen
  );

  const statusBar = (
    <div className="planner-coords no-print">
      {cursor ? (
        <span>
          <b>X:</b> {fmtCoordU(cursor.x)}
          <span style={{ margin: "0 12px" }} />
          <b>Y:</b> {fmtCoordU(cursor.y)}
          <span className="planner-coords__unit"> · {coordUnitLabel(display.coordUnit)}</span>
        </span>
      ) : "—"}
      {warnList.length > 0 && (
        <button
          type="button"
          className="planner-coords__warn"
          title="Открыть список предупреждений"
          onClick={openWarningsPanel}
        >
          · ⚠ {warnList.length}
        </button>
      )}
      {selObj && selection?.ids?.length === 1 && (
        <span className="planner-coords__sel">
          · {sel.coll === "items" ? (
            <>
              <b>X</b> {fmtCoordU(selObj.x)} · <b>Y</b> {fmtCoordU(selObj.y)}
              · W {fmtCoordMm(selObj.w)} · D {fmtCoordMm(selObj.h)}
              {selObj.height ? ` · H ${fmtCoordMm(selObj.height)}` : ""}
              {!isDoorKind(selObj.kind) ? ` · ∠ ${selObj.angle || 0}°` : ""}
              {placementZoneLabel(plan, selObj) ? ` · ${placementZoneLabel(plan, selObj)}` : ""}
            </>
          ) : sel.coll === "walls" ? (
            <>длина {fmtU(polyLength(selObj.pts || []))}</>
          ) : sel.coll === "zones" ? (
            <>{selObj.name || "Помещение"} · {fmtCoordU(selObj.x)}, {fmtCoordU(selObj.y)}</>
          ) : sel.coll === "labels" ? (
            <><b>X</b> {fmtCoordU(selObj.x)} · <b>Y</b> {fmtCoordU(selObj.y)}</>
          ) : null}
        </span>
      )}
      {tool === "add" && pending && itemPlacementPreview?.item && (
        <span className="planner-coords__sel" style={{ color: itemPlacementPreview.valid ? "#116355" : "#c45c4a" }}>
          · {itemPlacementPreview.valid ? "Можно поставить" : (itemPlacementPreview.warning || "Нельзя поставить")}
        </span>
      )}
      {selection?.coll === "items" && selection.ids.length > 1 && (
        <span style={{ marginLeft: 10, color: "#116355" }}>
          Выбрано: {selection.ids.length} · Shift+рамка · Ctrl+G
        </span>
      )}
      {tool === "select" && zonesEditMode && (
        <span className="muted" style={{ marginLeft: 10, fontSize: 12 }}>
          ЛКМ — панорама · Shift+ЛКМ — рамка · Shift+drag — по оси
        </span>
      )}
      {tool === "select" && !zonesEditMode && (
        <span className="muted" style={{ marginLeft: 10, fontSize: 12 }}>
          Свободная расстановка · помещения — лист «Помещения»
        </span>
      )}
      {tool === "add" && pending && (
        <span className="muted" style={{ marginLeft: 10, fontSize: 12 }}>
          Клик по полу — поставить объект
        </span>
      )}
      {linkFrom && (
        <span style={{ marginLeft: 10, color: "#1f6f8b" }}>Связь: выберите второй объект</span>
      )}
      {measure.length === 2 && (
        <span style={{ marginLeft: 10, color: "#116355" }}>
          Δ {fmtU(Math.hypot(measure[1].x - measure[0].x, measure[1].y - measure[0].y))}
        </span>
      )}
    </div>
  );

  return (
    <>
      <PlannerLayout
        topBarProps={{
          mode: standalone ? "standalone" : "project",
          title: planTitle,
          saved,
          busy,
          onPdf: exportPDF,
          onSync: syncSpec,
          onExportJson: handleExportJson,
          onImportJson: handleImportJson,
          onRename: handleRenameDraft,
          onAttach: standalone ? () => setAttachOpen(true) : undefined,
          projectId: project?.id,
        }}
        activeSheetId={activeSheetId}
        onSheetPick={handleSheetPick}
        viewMode={viewMode}
        onViewModePick={handleViewModePick}
        planLevel={planLevel}
        planVariant={planVariant}
        onPlanLevel={setPlanLevel}
        onPlanVariant={setPlanVariant}
        activeCategoryId={activeCategoryId}
        onCategoryPick={handleCategoryPick}
        drawerOpen={drawerOpen}
        drawerTitle={drawerTitle}
        onDrawerClose={() => setDrawerOpen(false)}
        sheetFilters={activeSheet.filters}
        activeFilterId={activeFilterId}
        onFilterPick={handleFilterPick}
        toolDrawerContent={(
          <>
            <ObjectPalette
              embedded
              active={active}
              tool={tool}
              pending={pending}
              wallThk={wallThk}
              plan={plan}
              onTool={handleTool}
              onPending={handlePending}
              onWallThk={setWallThk}
              onRoomPatch={(patch) => setPlan((p) => ({ ...p, room: { ...p.room, ...patch } }))}
              specSummary={specSummary}
              onSync={standalone ? undefined : syncSpec}
              onSyncZones={() => setPlan((p) => syncAutoZones(p))}
              onSelectPlanItem={handlePickPlanItem}
              projectId={project?.id}
            />
            <div className="planner-drawer-advanced">
              <PlannerToolMenu
                embedded
                sheetId={activeSheetId}
                categoryId={activeCategoryId}
                activeToolId={activeToolId}
                tool={tool}
                pending={pending}
                wallThk={wallThk}
                plan={plan}
                specSummary={specSummary}
                searchQuery={toolSearch}
                onPick={handleToolPick}
                onWallThk={setWallThk}
                onRoomPatch={(patch) => setPlan((p) => ({ ...p, room: { ...p.room, ...patch } }))}
                onSync={standalone ? undefined : syncSpec}
                onSyncZones={() => setPlan((p) => syncAutoZones(p))}
                onSelectPlanItem={handlePickPlanItem}
                projectId={project?.id}
              />
            </div>
          </>
        )}
        bottomBarProps={{
          zoom: z,
          display,
          unit,
          onZoomPreset: setZoomTo,
          onToggle: toggleDisplay,
          onSetDisplay: patchDisplay,
          onFit: fitView,
          onFitLayer: fitActiveLayer,
          onCenter: centerView,
          onClearSheet: clearSheet,
          activeLayerName: activeSheet.name,
          onUndo: undo,
          onRedo: redo,
          onDelete: delSel,
          onCopy: copySel,
          onGroup: groupSelection,
          onMeasure: () => handleToolPick(resolveTool("measure")),
          onLabel: () => handleToolPick(resolveTool("label")),
          onComment: () => handleToolPick(resolveTool("comment")),
          onExportPdf: () => exportPDF("full"),
        }}
        zoomProps={{
          zoom: z,
          onZoomIn: () => setZoomTo(z * 1.15),
          onZoomOut: () => setZoomTo(z / 1.15),
          onZoomSlider: setZoomTo,
          onFit: fitView,
          onCenter: centerView,
          onPan: panView,
        }}
        statusBar={statusBar}
        footerLeft={(
          <>
            <button type="button" className="planner-bottom-btn" onClick={() => window.open("https://daogreen.ru", "_blank")}>Помощь</button>
            <button type="button" className="planner-bottom-btn" disabled title="Скоро">По картинке</button>
          </>
        )}
        showProperties={showProperties}
        pinnedProperties={pinnedProperties}
        onTogglePinProperties={() => setPinnedProperties((p) => !p)}
        propertiesPanel={(
          <PropertiesPanel
            tab={propsTab}
            onTabChange={setPropsTab}
            sel={sel}
            selObj={selObj}
            selection={selection}
            plan={plan}
            project={standalone ? { name: planTitle, items: [] } : project}
            active={active}
            materials={state.materials}
            modules={state.modules}
            updateObj={updateObj}
            rotateItem={rotateItem}
            delSel={delSel}
            onGroup={groupSelection}
            onUngroup={ungroupSelection}
            fmtU={fmtU}
            onSync={standalone ? undefined : syncSpec}
            specSummary={specSummary}
            allWarnings={warnList}
            onFocusWarning={focusPlanWarning}
            onClose={closePropertiesPanel}
            onSelectLink={handleSelectLink}
          />
        )}
        canvas={(
          <svg
            ref={svgRef}
            className="plan-svg"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onWheel={onWheel}
            onDoubleClick={() => (draft.length >= 2 ? finishDraft() : null)}
            onContextMenu={onContextMenu}
            style={{ cursor: cursorStyle }}
          >
            <rect width="100%" height="100%" fill="#f7f8f6" data-canvas-bg="1" />
            <PlanGridScreen view={view} width={svgSize.w} height={svgSize.h} display={canvasDisplay} />
            <PlanAxesScreen view={view} width={svgSize.w} height={svgSize.h} display={canvasDisplay} />
            <g data-main transform={`translate(${view.panX},${view.panY}) scale(${z})`}>
              <SheetBackdrop room={plan.room} k={k} showBoundary={plan.room.showBoundary} />
              {display.roomWhiteFill !== false && (
                <g data-room-floors pointerEvents="none">
                  {plan.zones.map((zn) => (
                    <RoomFloorEl key={`fl-${zn.id}`} zn={zn} k={k} enabled={display.roomWhiteFill !== false} />
                  ))}
                </g>
              )}
              <PlanLayerGroup layerId="room" activeLayer={active} vis={vis} display={canvasDisplay}>
                {itemsByLayer("room").map((it) => itemProps(it, "room"))}
                {roomWalls.map((w) => (
                  <WallEl
                    key={w.id}
                    wall={w}
                    k={k}
                    editable={active === "room" && (tool === "select" || tool === "wall")}
                    selected={selection?.coll === "walls" && selection.ids[0] === w.id}
                    hovered={hoverHit?.coll === "walls" && hoverHit.id === w.id}
                    hasError={warnWallIds.has(w.id)}
                    hoverNodeIdx={hoverWallNode?.wallId === w.id ? hoverWallNode.idx : null}
                    fmtU={fmtU}
                    showDims={showDimsFor("room")}
                    onSel={() => setSel({ coll: "walls", id: w.id })}
                    onHover={(id) => setHoverHit(id ? { coll: "walls", id } : null)}
                    onNodeHover={(idx) => setHoverWallNode(idx == null ? null : { wallId: w.id, idx })}
                    onNode={startNode}
                    onDel={delSel}
                    onWallMove={startWallMove}
                    openings={plan.items}
                    room={plan.room}
                  />
                ))}
                {showDimsFor("room") && plan.room.showBoundary && <RoomDims room={plan.room} k={k} fmtU={fmtU} />}
              </PlanLayerGroup>
              <PlanLayerGroup layerId="partitions" activeLayer={active} vis={vis} display={canvasDisplay}>
                {partitionWalls.map((w) => (
                  <WallEl
                    key={`pt-${w.id}`}
                    wall={w}
                    k={k}
                    editable={active === "partitions" && (tool === "select" || tool === "wall")}
                    selected={selection?.coll === "walls" && selection.ids[0] === w.id}
                    hovered={hoverHit?.coll === "walls" && hoverHit.id === w.id}
                    hasError={warnWallIds.has(w.id)}
                    hoverNodeIdx={hoverWallNode?.wallId === w.id ? hoverWallNode.idx : null}
                    fmtU={fmtU}
                    showDims={showDimsFor("partitions")}
                    onSel={() => setSel({ coll: "walls", id: w.id })}
                    onHover={(id) => setHoverHit(id ? { coll: "walls", id } : null)}
                    onNodeHover={(idx) => setHoverWallNode(idx == null ? null : { wallId: w.id, idx })}
                    onNode={startNode}
                    onDel={delSel}
                    onWallMove={startWallMove}
                    openings={plan.items}
                    room={plan.room}
                  />
                ))}
              </PlanLayerGroup>
              <PlanLayerGroup layerId="zones" activeLayer={active} vis={vis} display={canvasDisplay}>
                {plan.zones.map((zn) => (
                  <ZoneEl
                    key={zn.id}
                    zn={zn}
                    k={k}
                    room={plan.room}
                    selected={zonesEditMode && selection?.coll === "zones" && selection.ids[0] === zn.id}
                    activeLayer={active}
                    vis={vis}
                    display={canvasDisplay}
                    interactive={zonesEditMode}
                    showRoomLabels={display.showZoneNames !== false}
                    showDetail={layerState("zones").showZoneDetail && display.showZoneNames}
                    showFlow={display.showZoneFlow}
                    showZoneAreas={display.showZoneAreas}
                    showZoneFill={display.showZoneFill}
                    zoneContoursOnly={display.zoneContoursOnly}
                    onDown={(e) => selectZone(e, zn)}
                    onResize={(e) => startResize(e, "zones", zn)}
                    fmtU={fmtU}
                  />
                ))}
              </PlanLayerGroup>
              {LINE_LAYER_IDS.map((lid) => (
                <PlanLayerGroup key={lid} layerId={lid} activeLayer={active} vis={vis} display={canvasDisplay}>
                  {linesByLayer(lid).map((l) => (
                    <LineEl
                      key={l.id}
                      line={l}
                      k={k}
                      showDims={showDimsFor(lid)}
                      editable={tool === "select" && active === lid}
                      selected={selection?.coll === "lines" && selection.ids[0] === l.id}
                      hovered={hoverHit?.coll === "lines" && hoverHit.id === l.id}
                      activeLayer={active}
                      vis={vis}
                      display={canvasDisplay}
                      onSel={() => setSel({ coll: "lines", id: l.id })}
                      onHover={(id) => setHoverHit(id ? { coll: "lines", id } : null)}
                      onNode={startNode}
                      onDel={delSel}
                      fmtU={fmtU}
                    />
                  ))}
                </PlanLayerGroup>
              ))}
              <PlanLayerGroup layerId="links" activeLayer={active} vis={vis} display={canvasDisplay}>
                {visibleLinks().map((link) => (
                  <LinkEl
                    key={link.id}
                    link={link}
                    items={plan.items}
                    room={plan.room}
                    k={k}
                    selected={selection?.coll === "links" && selection.ids[0] === link.id}
                    hovered={hoverHit?.coll === "links" && hoverHit.id === link.id}
                    showLabel={display.showDims || display.showHints}
                    onHover={(id) => setHoverHit(id ? { coll: "links", id } : null)}
                    onDown={(e) => {
                      e.stopPropagation();
                      if (tool === "select" || tool === "link") setSel({ coll: "links", id: link.id });
                    }}
                    onDel={() => { setSel({ coll: "links", id: link.id }); delSel(); }}
                  />
                ))}
              </PlanLayerGroup>
              {ITEM_LAYER_IDS.map((lid) => (
                <PlanLayerGroup key={lid} layerId={lid} activeLayer={active} vis={vis} display={canvasDisplay}>
                  {itemsByLayer(lid).map((it) => itemProps(it, lid))}
                </PlanLayerGroup>
              ))}
              {active === "client" && (
                <PlanLayerGroup layerId="client" activeLayer={active} vis={vis} display={canvasDisplay}>
                  {clientItems.map((it) => itemProps(it, "client", { key: `cl-${it.id}` }))}
                </PlanLayerGroup>
              )}
              <PlanLayerGroup layerId="labels" activeLayer={active} vis={vis} display={canvasDisplay}>
                {plan.labels.map((lb) => (
                  <LabelEl
                    key={lb.id}
                    lb={lb}
                    items={plan.items}
                    k={k}
                    zoom={view.zoom}
                    display={canvasDisplay}
                    selected={selection?.coll === "labels" && selection.ids[0] === lb.id}
                    activeLayer={active}
                    onDown={(e) => startMove(e, "labels", lb)}
                  />
                ))}
              </PlanLayerGroup>
              <WallsTopOverlay walls={plan.walls} k={k} warnWallIds={warnWallIds} openings={plan.items} room={plan.room} />
              <g data-ui="dims-top" pointerEvents="none">
                {selObj && sel.coll === "items" && display.showDims && selection?.ids?.length === 1 && (
                  <SelectionDims it={selObj} plan={plan} k={k} fmtU={fmtU} display={display} />
                )}
                {selection?.coll === "walls" && selection?.ids?.length === 1 && display.showDims && (() => {
                  const w = plan.walls.find((wl) => wl.id === selection.ids[0]);
                  return w ? <WallSelectionDims wall={w} room={plan.room} k={k} fmtU={fmtU} /> : null;
                })()}
              </g>
              <g data-ui="overlay">
                {guides.map((g, i) => (g.type === "V" ? (
                  <line key={i} x1={g.at} y1={g.y0 ?? 0} x2={g.at} y2={g.y1 ?? plan.room.h} stroke="#116355" strokeWidth={1 * k} strokeDasharray={`${5 * k} ${4 * k}`} opacity={0.45} />
                ) : (
                  <line key={i} x1={g.x0 ?? 0} y1={g.at} x2={g.x1 ?? plan.room.w} y2={g.at} stroke="#116355" strokeWidth={1 * k} strokeDasharray={`${5 * k} ${4 * k}`} opacity={0.45} />
                )))}
                {draft.length > 0 && (
                  <DraftLine
                    pts={draft}
                    cursor={draftCursor}
                    k={k}
                    wall={tool === "wall"}
                    thk={wallThk}
                    color={tool === "wall" ? "#116355" : (LINE_STYLE[active] || LINE_STYLE.irrigation)?.color || "#1f6f8b"}
                    fmtU={fmtU}
                    snapPt={draftSnap}
                    angleSnap={draftAngleSnap}
                    room={plan.room}
                  />
                )}
                {marquee && <SelectionMarquee rect={marquee} k={k} />}
                {multiBounds && <MultiSelectBounds bounds={multiBounds} k={k} />}
                {measure.length > 0 && (
                  <MeasureEl pts={measure} cursor={measure.length === 1 && cursor ? draftPt(measure[0], cursor, draftSnapOpts()).point : cursor} k={k} fmtU={fmtU} />
                )}
                {itemPlacementPreview?.item && (
                  <PlacementGhost
                    item={itemPlacementPreview.item}
                    k={k}
                    valid={itemPlacementPreview.valid}
                    warning={itemPlacementPreview.warning}
                  />
                )}
              </g>
            </g>
            <g data-ui="screen-hud" transform={`translate(${view.panX},${view.panY})`}>
              <TypedLengthHint value={typedLength} k={k} />
            </g>
          </svg>
        )}
      />
      <ContextMenu menu={ctxMenu} onClose={() => setCtxMenu(null)} onAction={handleCtxAction} />
      {standalone && (
        <AttachPlanModal
          open={attachOpen}
          projects={state.projects}
          draftName={planTitle}
          busy={busy}
          onClose={() => setAttachOpen(false)}
          onAttach={handleAttachToProject}
        />
      )}
    </>
  );
}

function withDefaults(plan) {
  const d = DEFAULT_PLAN();
  if (!plan) return d;
  return {
    ...d,
    ...plan,
    room: { ...d.room, height: 3000, showBoundary: false, ...plan.room },
    zones: plan.zones || [],
    labels: plan.labels || [],
    walls: (plan.walls || []).map((w) => ({
      role: "partition",
      kind: "new",
      thicknessSide: "center",
      height: plan.room?.height || 3000,
      material: "",
      ...w,
    })),
    lines: (plan.lines || []).map((l) => ({
      ...l,
      layer: migrateLayerId(l.layer, null),
    })),
    links: (plan.links || []).map((l) => ({ ortho: true, riseMm: null, ...l })),
    items: (plan.items || []).map((i) => {
      const base = { angle: 0, ...defaultObjectSpecSettings(i.kind), ...i };
      const layer = migrateLayerId(base.layer, base.kind);
      if (base.kind === "socket" && layer === "power") return { ...base, layer: "sockets" };
      return { ...base, layer };
    }),
  };
}
