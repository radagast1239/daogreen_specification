import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useStore } from "../../store/StoreContext.jsx";
import { uid } from "../../store/helpers.js";
import {
  getStandalonePlan, saveStandalonePlan, downloadPlanFile,
  readPlanFile, renameStandalonePlan, deleteStandalonePlan,
} from "../../planner/standalonePlans.js";
import {
  LAYERS, LINE_STYLE, catalogByKind, catalogForLayer, layerById,
  clamp, snap, DEFAULT_PLAN, DEFAULT_DISPLAY, migrateLayerId, polyLength,
} from "../../planner/catalog.js";
import { exportLayeredPDF } from "../../planner/exportPdf.js";
import { createPlannerSpecItems, defaultObjectSpecSettings, plannerSpecSummary } from "../../planner/specSync.js";
import { collectPlannerWarnings, wallsForLayer, boundsForActiveLayer } from "../../planner/geometry.js";
import { resolveDraftPoint, angleBetweenDeg } from "../../planner/core/snap/index.js";
import { runSnapEngine } from "../../planner/core/snap/snapEngine.js";
import {
  formatDimensionValue,
  resolvePlanDimensions,
  dimensionOffsetFromPoint,
  DEFAULT_DIMENSION_DISPLAY_MODE,
} from "../../planner/core/dimensions/index.js";
import {
  createWallDraftState, wallDraftStart, wallDraftContinueFrom,
  wallDraftAddSegment, wallDraftBackspace, wallDraftFinishPts, wallDraftFinishMeta,
} from "../../planner/core/walls/wallDraft.js";
import { computeItemPlacement, placementZoneLabel } from "../../planner/placementPreview.js";
import { PlacementGhost } from "../../planner/objectOverlays.jsx";
import { itemOverlapsAnyWall } from "../../planner/wallCollision.js";
import { itemOverlapsBlocked } from "../../planner/itemOverlap.js";
import { StructuralEl, StructuralDraft } from "../../planner/structuralRender.jsx";
import { defaultStructuralFields, STRUCTURAL_KINDS } from "../../planner/structuralTypes.js";
import { hitTestStructural, nearestStructural, itemHitsAnyStructural } from "../../planner/structuralGeometry.js";
import { normalizeDisplay, roundMm, fmtCoord, fmtCoordMm, coordUnitLabel } from "../../planner/gridSettings.js";
import { DEFAULT_VISUAL, loadVisualPrefs, saveVisualPrefs, VISUAL_PREF_KEYS } from "../../planner/plannerVisualSettings.js";
import { PlannerVisualSettingsModal } from "../../planner/ui/PlannerVisualSettingsModal.jsx";
import { PlannerMaterialPresetsModal } from "../../planner/ui/PlannerMaterialPresetsModal.jsx";
import { PlannerLabelModal } from "../../planner/ui/PlannerLabelModal.jsx";
import { resolveCatalogKind, getStructuralDefaultWidth } from "../../planner/plannerMaterialPresets.js";
import { isStrictWallItem, isDoorKind } from "../../planner/doorTypes.js";
import {
  snapWallPoint, placeOnWall, pointInPolygon, pointInZone, breakWallAt,
  applyWallNodeMove, refreshWallMountedItems,
  tryMergeWall, straightenWall, setWallSegmentLength, setWallSegmentLengthAt,
  wallSegmentLengthAt, wallSegmentIndexForNode, alignWallToNeighbor, weldWallNodes,
  refineWallDraftSnap, ensureWallNodesAtPoints, snapPointsToWallNodes,
  hitTestWallBody, pickWallBodyHit,
  planWorkingBounds, planHasDrawnWalls,
  alignmentGuides, angleAt, draftChainArea,
} from "../../planner/core/walls/index.js";
import { syncRoomsSafe } from "../../planner/core/rooms/index.js";
import { validateRooms } from "../../planner/core/rooms/validateRooms.js";
import {
  resolvePlanWalls, commitWallEdge, movePlanNode,
  wallNodeIdAt, ensureWallNetwork,
  applyNetworkNodeAtWall, applyNetworkWallSegMove,
} from "../../planner/wallNetwork.js";
import { createGeometryCommandDispatcher } from "../../planner/ui/geometryCommandDispatcher.js";
import {
  classifyWallLengthDimension, resolveFixedEndpointForPoint,
  WALL_PARTIAL_DIMENSION_MESSAGE, ITEM_DIMENSION_MESSAGE,
} from "../../planner/ui/wallLengthDimensionMapping.js";
import { applyWallDelete } from "../../planner/ui/applyWallDelete.js";
import { applyWallBulkDelete } from "../../planner/ui/applyWallBulkDelete.js";
import { applyItemBulkDelete } from "../../planner/ui/applyItemBulkDelete.js";
import { applyLineBulkDelete } from "../../planner/ui/applyLineBulkDelete.js";
import { summarizeRoomClearItems, buildRoomClearConfirmMessage } from "../../planner/ui/roomClearSummary.js";
import { applyWallLengthEdit, createWallLengthEditSession } from "../../planner/ui/applyWallLengthEdit.js";
import { formatWallLengthMm } from "../../planner/ui/parseWallLengthInput.js";
import { validateOpeningPlacement, nextDoorNumber, nextOpeningNumber } from "../../planner/doorGeometry.js";
import { attachItemZoneFields } from "../../planner/roomZones.js";
import {
  createFarmObject,
  farmCategoryForKind,
  normalizePlannerObject,
  resolveArrowMoveStepMm,
  createRackGroup,
} from "../../planner/farmObjects.js";
import {
  defaultLineFields, attachLineEndpoints, snapLinePoint,
  insertPointOnLine, removeLineNode, reverseLine, hitTestLine,
} from "../../planner/lineProperties.js";
import {
  snapPipeDraftPoint,
  normalizePipe,
  isPipeLine,
  syncPlanPipes,
} from "../../planner/pipes.js";
import { syncElectricalPlan } from "../../planner/electrical.js";
import { isDuctLine, normalizeDuct, syncClimatePlan } from "../../planner/climate.js";
import {
  isRackKind, defaultRackFields, nextRackNumber, nextRowLabel,
  autoNumberRacks, buildRackGrid,
} from "../../planner/rackProperties.js";
import { isOpeningKind, defaultOpeningFields } from "../../planner/openingTypes.js";
import { isDoorItem } from "../../planner/doorTypes.js";
import { defaultWallFields, WALL_KINDS, THICKNESS_SIDES } from "../../planner/wallTypes.js";
import { wallFieldsFromTool, defaultWallThkForTool, wallMaterialForTool } from "../../planner/wallToolPresets.js";
import { usePlanHistory } from "../../planner/usePlanHistory.js";
import { normalizePlan, normalizePlanResult } from "../../planner/planNormalize.js";
import { isPlannerPlanCorrupt } from "../../planner/plannerPersistenceState.js";
import { hitTestWallInteraction } from "../../planner/ui/hitTesting/planHitTest.js";
import { validatePlanIntegrity } from "../../planner/core/validation/validatePlanIntegrity.js";
import { PlanDiagnosticsPanel } from "../../planner/ui/diagnostics/PlanDiagnosticsPanel.jsx";
import { getDiagnosticFocusTarget } from "../../planner/ui/diagnostics/diagnosticFocus.js";
import { isDiagnosticsStale, mergeDiagnosticsResult } from "../../planner/ui/diagnostics/diagnosticPresentation.js";
import { DEFAULT_DUCT_SIZE_H_MM, DEFAULT_DUCT_SIZE_W_MM } from "../../planner/ventDuctRender.jsx";
import {
  PlanGridScreen, PlanAxesScreen, SheetBackdrop, RoomDims, WallEl, WallsTopOverlay, PlannerWallDefs, PlannerLayerDefs, LayerMutedWrap, ItemEl, ZoneEl, LabelEl, LineEl,
  DraftLine, SelectionDims, WallSelectionDims, WallDimChains, RulerEl, DimensionsLayer, DimensionDraftEl, TypedLengthHint, LinkEl,
  SelectionMarquee, MultiSelectBounds, PlanLayerGroup, RoomFloorEl,
} from "../../planner/canvasPrimitives.jsx";
import {
  WallCursorPreview, WallSnapIndicator, WallAlignmentGuides,
  WallAngleLabels, WallLiveChips, fmtWallDraftLen,
} from "../../planner/wallDraftOverlay.jsx";
import { layerDisplayState } from "../../planner/canvasLayers.js";
import { snapRackNeighbor } from "../../planner/plannerSnap.js";
import { snapObjectPosition, constrainAxisDelta, constrainAxisPoint, snapDistanceMm } from "../../planner/objectSnap.js";
import {
  itemsInMarquee, boundsOfItems, groupMemberIds,
} from "../../planner/selectionHelpers.js";
import { warningIdsFromList } from "../../planner/selectionVisuals.js";
import {
  buildItemLabelLines, defaultFreeLabelFields, autoCalloutPlacement, autoItemLabelPlacement,
  resolveFreeLabelPosition, resolveItemLabelPlacement, pinItemLabelFromAuto, itemAnchor,
  resolveLabelAnchor, DEFAULT_LABEL_FONT_PT,
} from "../../planner/labelProperties.js";
import {
  linkTypeForLayer, canCreateLink, linkLengthMm, linksVisibleOnLayer,
  buildLinkPayload, findRackLinkTarget, RACK_LINK_ACTIONS,
} from "../../planner/linkGeometry.js";
import { PlannerLayout } from "../../planner/ui/PlannerLayout.jsx";
import {
  REQUIRED_FARM_SHEET_IDS,
  sheetById, sheetByLayerId, defaultToolForSheet, buildVisibilityFromSheet, sheetDisplayPatch, objectVisibleOnSheet,
} from "../../planner/plannerSheets.js";
import { categoryById } from "../../planner/plannerCategories.js";
import { PlannerToolMenu } from "../../planner/ui/PlannerToolMenu.jsx";
import { ObjectPalette } from "../../planner/ui/ObjectPalette.jsx";
import { toolStateFromDef, isItemVisibleOnSheet, isLineVisibleOnSheet } from "../../planner/plannerSheetUtils.js";
import { resolveTool } from "../../planner/plannerTools.js";
import { sheetAllowedInViewMode, viewModeForSheet } from "../../planner/plannerViewModes.js";
import { PropertiesPanel } from "../../planner/ui/PropertiesPanel.jsx";
import { PlannerErrorBoundary, PlannerOverlayBoundary } from "../../planner/ui/PlannerErrorBoundary.jsx";
import { WallEditOverlay } from "../../planner/wallEditOverlay.jsx";
import { WallBodyHitAreas } from "../../planner/wallRender.jsx";
import { ContextMenu, buildObjectMenu } from "../../planner/ui/ContextMenu.jsx";
import { AttachPlanModal } from "../../planner/ui/AttachPlanModal.jsx";
import "../../planner/planner.css";
import { Empty } from "../../components/ui.jsx";

const LINE_LAYER_IDS = ["drain", "irrigation", "supply", "power", "vent", "climate", "ac", "light", "staff"];
const ITEM_LAYER_IDS = LAYERS.map((l) => l.id).filter(
  (id) => !["room", "zones", "partitions", "client", "install", "spec"].includes(id)
);
// PHASE 1A-2C2D3B — только эти пять item-слоёв уже сегодня реально очищают
// items через clearSheet (не перехватываются LINE_LAYER_IDS раньше по
// цепочке if/else-if, см. RESULT — AUDIT PHASE 1A-2C2D3A). Намеренно не
// весь ITEM_LAYER_IDS — irrigation/power/light/vent (mode:"both"), climate
// и staff остаются legacy-путём до отдельной фазы.
const MIGRATED_ITEM_CLEAR_LAYER_IDS = ["racks", "water", "sockets", "sanitary", "furn"];
// PHASE 1A-2C2D3E2 — только эти два фактически line-only слоя мигрируют на
// line.bulkDelete в clearSheet (см. AUDIT PHASE 1A-2C2D3E1: drain и
// irrigation — единственные LINE_LAYER_IDS-слои с нулём catalog item kinds
// сегодня, так что line-only clear здесь ничего не оставляет позади).
// Намеренно НЕ весь LINE_LAYER_IDS — power/light/vent (mode:"both"), climate
// и staff содержат реальные item kinds и остаются legacy-путём (см. Risks R1-R3
// того же аудита) до отдельной combined item+line clear фазы.
const MIGRATED_LINE_CLEAR_LAYER_IDS = ["drain", "irrigation"];

function draftPt(from, to, opts) {
  const { point, angleSnap } = resolveDraftPoint(from, to, opts);
  return { point, angleSnap };
}

function dragShiftOn(shiftHeld, altHeld) {
  return shiftHeld && !altHeld;
}

function modKey(e) {
  return e.ctrlKey || e.metaKey;
}

export default function PlanPage() {
  const { id, draftId } = useParams();
  const navigate = useNavigate();
  const standalone = !!draftId;
  const { state, actions } = useStore();
  const project = standalone ? null : state.projects.find((p) => p.id === id);
  const [draftMeta, setDraftMeta] = useState(() => (standalone ? getStandalonePlan(draftId) : null));
  // PHASE 0B: повреждённый сохранённый план — запрет любой автозаписи/синка,
  // чтобы не затереть исходные данные пустым планом.
  const plannerPlanCorrupt = !standalone && isPlannerPlanCorrupt(project);

  // PHASE 0G corrective: lazy-seed для usePlanHistory — выполняется синхронно
  // до первого effect, где нельзя безопасно вызвать setRoomDetectionDiagnostic.
  // Diagnostic от этого начального normalize не теряется: effect ниже (загрузка
  // standalone/project) выполняет normalizePlanResult ЗАНОВО сразу после mount
  // и surfacing diagnostic через resetHistory + setRoomDetectionDiagnostic.
  const initialPlan = () => {
    if (standalone) return normalizePlan(draftMeta?.plan || getStandalonePlan(draftId)?.plan);
    return normalizePlan(project?.plan);
  };

  const {
    plan, getCurrentPlan, setPlan, replacePlan, commitPlan, undo, redo, resetHistory,
  } = usePlanHistory(initialPlan);
  const [active, setActive] = useState("room");
  const [tool, setTool] = useState("select");
  const [pending, setPending] = useState(null);
  const [pendingSize, setPendingSize] = useState(null);
  const [pendingRotationDeg, setPendingRotationDeg] = useState(0);
  const [lineDraftMeta, setLineDraftMeta] = useState({
    layer: null,
    tag: null,
    pipeSystem: null,
    pipeRole: null,
    diameterMm: null,
    material: null,
    lineType: null,
    ductType: null,
    airflowM3h: null,
    flowDirection: "forward",
  });
  const [activeToolId, setActiveToolId] = useState("select");
  const [sheetFilters, setSheetFilters] = useState({});
  const [toolSearch, setToolSearch] = useState("");
  const [selection, setSelection] = useState(null);
  const [marquee, setMarquee] = useState(null);
  const setSel = (v) => setSelection(v ? {
    coll: v.coll,
    ids: [v.id],
    ...(v.nodeIdx != null ? { nodeIdx: v.nodeIdx } : {}),
  } : null);
  const clearSelection = () => setSelection(null);
  const [view, setView] = useState({ panX: 0, panY: 0, zoom: 0.08 });
  const [display, setDisplay] = useState(() => normalizeDisplay({ ...DEFAULT_DISPLAY(), ...loadVisualPrefs() }));
  const [visualSettingsOpen, setVisualSettingsOpen] = useState(false);
  const [materialPresetsOpen, setMaterialPresetsOpen] = useState(false);
  const [materialPresetsRev, setMaterialPresetsRev] = useState(0);
  const [labelDraft, setLabelDraft] = useState(null);
  const [vis, setVis] = useState(Object.fromEntries(LAYERS.map((l) => [l.id, true])));
  const [draft, setDraft] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [measure, setMeasure] = useState([]);
  const [measureOffsetPt, setMeasureOffsetPt] = useState(null);
  const [rulerSnap, setRulerSnap] = useState(null);
  const [guides, setGuides] = useState([]);
  const [wallThk, setWallThk] = useState(100);
  const [structuralWidth, setStructuralWidth] = useState(STRUCTURAL_KINDS.beam.defaultWidth);
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
  const wallDraftStateRef = useRef(createWallDraftState());
  const wallDrawRef = useRef(null);
  const structuralDrawRef = useRef(null);
  const measureDrawRef = useRef(null);
  const [dimensionEdit, setDimensionEdit] = useState(null);
  // PHASE 1B-1B — synchronous submit guard against duplicate Enter/blur
  // dispatch for the wall-length editor (see applyWallLengthEdit.js).
  const dimensionEditSessionRef = useRef(createWallLengthEditSession());
  const [ctrlSnapFine, setCtrlSnapFine] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [activeSheetId, setActiveSheetId] = useState("base_plan");
  const [activeCategoryId, setActiveCategoryId] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [planLevel, setPlanLevel] = useState("Этаж 1");
  const [planVariant, setPlanVariant] = useState("Планировка 1");
  const [pinnedProperties, setPinnedProperties] = useState(false);
  const [propsTab, setPropsTab] = useState("props");
  const [warningsPanelOpen, setWarningsPanelOpen] = useState(false);
  const [viewMode, setViewMode] = useState("2d");
  // PHASE 0D — read-only проверка целостности плана (session-only, не persisted).
  const [planDiagnostics, setPlanDiagnostics] = useState(null); // { result, planRef }
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnosticsChecking, setDiagnosticsChecking] = useState(false);
  // PHASE 0G — последний сбой room detection (session-only, не persisted в plan).
  // Очищается следующим успешным syncAutoZones; сливается в runPlanCheck.
  const [roomDetectionDiagnostic, setRoomDetectionDiagnostic] = useState(null);
  const [diagnosticFilters, setDiagnosticFilters] = useState({ error: true, warning: true, info: true });

  const structuralKind = tool === "structural" ? pending : null;

  const criticalWarnIdsRef = useRef(new Set());

  const openWarningsPanel = useCallback(() => {
    setPropsTab("errors");
    setWarningsPanelOpen(true);
  }, []);
  const svgRef = useRef(null);
  const backdropInputRef = useRef(null);
  const [svgSize, setSvgSize] = useState({ w: 1200, h: 800 });
  const dragRef = useRef(null);
  const rackSnapStickyRef = useRef({ x: null, y: null, atX: null, atY: null });
  const objectSnapStickyRef = useRef({ x: null, y: null, atX: null, atY: null });
  const clipboardRef = useRef(null);
  const shiftRef = useRef(false);
  const altSnapRef = useRef(false);
  const ctrlRef = useRef(false);
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

  // PHASE 0G corrective: реальный production load path — result-aware API,
  // room detection failure на загрузке всплывает в session-only state, а не
  // теряется молча внутри normalizePlan().
  useEffect(() => {
    if (standalone) {
      const d = getStandalonePlan(draftId);
      if (d) {
        setDraftMeta(d);
        const { plan: normalized, diagnostics } = normalizePlanResult(d.plan);
        resetHistory(normalized);
        setRoomDetectionDiagnostic(diagnostics[0] || null);
      }
      return;
    }
    let cancelled = false;
    actions.loadProject(id).then((p) => {
      if (!cancelled && p?.plan && Object.keys(p.plan).length) {
        const { plan: normalized, diagnostics } = normalizePlanResult(p.plan);
        resetHistory(normalized);
        setRoomDetectionDiagnostic(diagnostics[0] || null);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [id, draftId, standalone, actions, resetHistory]);

  // PHASE 0G corrective: чистый room-only sync — runAutoZonesSync сам решает,
  // вызывать ли setPlan (см. определение ниже). Rejected/no-op sync не создаёт
  // history checkpoint.
  useEffect(() => {
    if (!planHasDrawnWalls(plan.walls)) return;
    runAutoZonesSync();
  }, [standalone ? draftId : id, plan.walls, plan.zones?.length, plan.rooms?.length]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // PHASE 0B: не автосохранять поверх повреждённого сохранённого плана.
    if (plannerPlanCorrupt) return;
    setSaved(false);
    const t = window.setTimeout(() => {
      actions.projectUpdate(project.id, { plan })
        .then(() => setSaved(true))
        .catch((e) => console.error("Planner autosave failed", e));
    }, 700);
    return () => window.clearTimeout(t);
  }, [plan, standalone, draftMeta?.id, draftMeta?.name, project?.id, actions, plannerPlanCorrupt]);

  const snapOn = display.snapOn && !altSnapOff;
  const snapStep = (ctrlSnapFine || view.zoom >= 1.2) ? 10 : 50;
  const unit = display.coordUnit || "mm";
  const dimensionDisplayMode = display.dimensionDisplayMode || DEFAULT_DIMENSION_DISPLAY_MODE;
  const fmtU = (mm, opts = {}) => formatDimensionValue(mm, dimensionDisplayMode, opts);
  const fmtCoordU = (mm) => fmtCoord(mm, display.coordUnit || "mm");
  const toMM = (cx, cy) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: (cx - r.left - view.panX) / view.zoom, y: (cy - r.top - view.panY) / view.zoom };
  };
  const sn = (v) => {
    if (altSnapOff) return roundMm(v, 1);
    return roundMm(snap(v, snapStep, snapOn && display.snapGrid), display.snapRoundMm || 1);
  };
  const fineMm = (v) => roundMm(v, display.snapRoundMm || 1);

  const innerBounds = useMemo(
    () => planWorkingBounds({ ...plan, walls: resolvePlanWalls(plan) }),
    [plan.walls, plan.nodes, plan.zones, plan.room],
  );
  const innerL = innerBounds.l;
  const innerT = innerBounds.t;
  const innerR = innerBounds.r;
  const innerB = innerBounds.b;

  const snapObj = useCallback((coll, obj, x, y) => {
    const gridSnap = (v) => roundMm(snap(v, snapStep, snapOn && display.snapGrid !== false), display.snapRoundMm || 1);
    if (!snapOn || altSnapRef.current) {
      return { x: gridSnap(x), y: gridSnap(y), guides: [] };
    }
    const innerBounds = { l: innerL, t: innerT, r: innerR, b: innerB };
    const thr = snapDistanceMm(view.zoom, display.snapDistancePx ?? 10);
    const isRack = coll === "items" && isRackKind(obj.kind) && display.snapObjects !== false;

    let rackSnap = null;
    if (isRack) {
      rackSnap = snapRackNeighbor(obj, x, y, plan.items, thr, rackSnapStickyRef.current);
    }

    const base = snapObjectPosition({
      obj,
      x: rackSnap?.snappedX ? rackSnap.x : x,
      y: rackSnap?.snappedY ? rackSnap.y : y,
      items: plan.items,
      walls: resolvePlanWalls(plan),
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
      sticky: objectSnapStickyRef.current,
    });

    let nx = rackSnap?.snappedX ? rackSnap.x : base.x;
    let ny = rackSnap?.snappedY ? rackSnap.y : base.y;
    const g = [...base.guides];
    if (rackSnap) g.push(...rackSnap.guides);

    return { x: nx, y: ny, guides: g };
  }, [snapOn, snapStep, view.zoom, plan.walls, plan.items, plan.room, display.snapObjects, display.snapGrid, display.snapWalls, display.snapGuides, display.snapDistancePx, display.snapRoundMm, innerL, innerR, innerT, innerB]);

  const attachWall = (obj, x, y) => {
    const maxDist = isStrictWallItem(obj.kind) ? 220 : 350;
    const rw = resolvePlanWalls(plan);
    const placed = placeOnWall(obj, { x, y }, rw, plan.room, maxDist);
    if (!placed) return null;
    const check = validateOpeningPlacement(
      obj,
      { x: placed.x, y: placed.y, wallSeg: placed.wallSeg, wallId: placed.wallId },
      rw,
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
    walls: resolvePlanWalls(plan),
    prevSegAngleDeg: wallPrevAngleRef.current,
  }), [snapOn, snapStep, display.snapAngles, display.angleTolerance, display.snapGrid, plan.walls, plan.nodes]);

  const clearWallChain = () => {
    wallChainStartRef.current = null;
    wallPrevAngleRef.current = null;
    wallDraftStateRef.current = createWallDraftState();
    setDraft([]);
    setDraftSnap(null);
    setDraftAngleSnap(null);
    setTypedLength("");
  };

  const wallSnapOptions = useCallback(() => ({
    snapOn: snapOn && !altSnapRef.current,
    snapStep,
    snapGrid: display.snapGrid !== false,
    snapWalls: display.snapWalls !== false,
    angleSnapOn: display.snapAngles !== false,
    toleranceDeg: display.angleTolerance ?? 5,
    snapDistancePx: display.snapDistancePx ?? 10,
    wallThk,
    prevSegAngleDeg: wallPrevAngleRef.current,
    chainStart: wallChainStartRef.current,
    snapGuides: display.snapGuides !== false,
  }), [snapOn, snapStep, display, wallThk]);

  const computeWallSnap = useCallback((raw, from) => {
    const result = runSnapEngine({
      point: raw,
      mode: "wall",
      plan,
      draft: { pts: draft, chainStart: wallChainStartRef.current },
      view,
      modifiers: { shift: shiftRef.current, alt: altSnapRef.current },
      options: { ...wallSnapOptions(), from },
    });
    return {
      pt: result.point,
      snap: result.snapped ? { snapped: true, kind: result.kind || result.type, ...result } : null,
      angleSnap: result.angleSnap,
      fromAdjust: result.fromAdjust,
      guides: result.guides,
    };
  }, [plan, draft, view, wallSnapOptions]);

  const computeDraftPt = (raw, from) => {
    if (tool === "wall") {
      return computeWallSnap(raw, from);
    }
    let angleSnap = null;
    let pt;
    if (from) {
      const draftResult = draftPt(from, raw, draftSnapOpts());
      pt = draftResult.point;
      angleSnap = draftResult.angleSnap;
    } else {
      pt = { x: sn(raw.x), y: sn(raw.y) };
    }
    let snap = null;
    let fromAdjust = null;
    let guidesLocal = [];
    if (tool === "line" && snapOn && !altSnapRef.current) {
      const lineLayer = lineDraftMeta.layer || active;
      const pipeDraft = lineLayer === "irrigation" || lineLayer === "drain";
      const s = pipeDraft
        ? snapPipeDraftPoint(pt, {
          items: plan.items,
          pipes: plan.lines.filter((ln) => isPipeLine(ln) || ln.layer === "irrigation" || ln.layer === "drain"),
          walls: resolvePlanWalls(plan),
          room: plan.room,
          zoom: view.zoom,
          snapOn: true,
          snapGrid: display.snapGrid !== false,
          snapWalls: display.snapWalls !== false,
          snapObjects: display.snapObjects !== false,
          snapStep,
        })
        : runSnapEngine({
          point: pt,
          mode: "line",
          plan,
          draft: { pts: draft },
          view,
          modifiers: { shift: shiftRef.current, alt: altSnapRef.current },
          options: {
            snapOn: true,
            snapGrid: display.snapGrid !== false,
            snapWalls: display.snapWalls !== false,
            snapObjects: display.snapObjects !== false,
            snapGuides: display.snapGuides !== false,
            snapStep,
            from,
            prevSegAngleDeg: from && draft.length >= 2 ? angleBetweenDeg(draft[draft.length - 2], from) : null,
            lines: plan.lines,
          },
        });
      if (s?.point) {
        pt = { x: s.point.x, y: s.point.y };
        angleSnap = s.angleSnap || angleSnap;
        guidesLocal = s.guides || [];
        if (s.snapped) snap = { snapped: true, kind: s.kind || s.type, ...s };
      } else if (s.snapped || s.kind === "grid") {
        pt = { x: s.x, y: s.y };
        if (s.snapped) snap = s;
      }
    }
    return { pt, snap, angleSnap, fromAdjust, guides: guidesLocal };
  };

  const computeRulerPt = useCallback((raw, from = null) => {
    const base = { x: sn(raw.x), y: sn(raw.y) };
    if (!snapOn || altSnapRef.current) return { pt: base, snap: null, guides: [] };
    const s = runSnapEngine({
      point: base,
      mode: "measure",
      plan,
      draft: { pts: measure },
      view,
      modifiers: { shift: shiftRef.current, alt: altSnapRef.current },
      options: {
        snapOn: true,
        snapGrid: display.snapGrid !== false,
        snapWalls: display.snapWalls !== false,
        snapObjects: display.snapObjects !== false,
        snapGuides: display.snapGuides !== false,
        snapStep,
        from,
      },
    });
    const pt = s?.point ? { x: s.point.x, y: s.point.y } : base;
    const snap = s?.snapped ? { snapped: true, kind: s.kind || s.type, ...s } : null;
    return { pt, snap, guides: s?.guides || [] };
  }, [snapOn, snapStep, display.snapGrid, display.snapWalls, display.snapObjects, display.snapGuides, plan, view, measure]);

  // PHASE 0G corrective: чистое вычисление room sync БЕЗ setState/setPlan —
  // { ok, plan, diagnostics }. Единственная точка, откуда caller решает, что
  // делать с результатом: setPlan только при ok:true и реальном изменении.
  const computeAutoZonesSync = (p) => {
    const synced = syncRoomsSafe({ ...p, walls: resolvePlanWalls(p) });
    if (!synced.ok) return { ok: false, plan: p, diagnostics: synced.diagnostics };
    const dimWarnings = (p.validationWarnings || []).filter((w) => w.source === "dimensions");
    return {
      ok: true,
      diagnostics: [],
      plan: {
        ...p,
        rooms: synced.rooms,
        zones: synced.zones,
        validationWarnings: [...dimWarnings, ...(synced.validationWarnings || [])],
      },
    };
  };

  // PHASE 0G: используется callers, которые УЖЕ выполняют реальную правку
  // геометрии (split/drag/delete/straighten) внутри того же setPlan updater —
  // checkpoint там принадлежит этой правке независимо от исхода room sync.
  // ok:false не трогает план — existing rooms/zones/metadata сохраняются как
  // есть; сбой всплывает как session-only diagnostic в панели «Проверить план».
  const syncAutoZones = (p) => {
    const result = computeAutoZonesSync(p);
    if (!result.ok) {
      setRoomDetectionDiagnostic(result.diagnostics[0]);
      return p;
    }
    if (roomDetectionDiagnostic) setRoomDetectionDiagnostic(null);
    return result.plan;
  };

  // PHASE 0G corrective: для «чистых» room-only sync (авто-эффект после
  // загрузки/правки, кнопка «Синхронизировать зоны») — вычисляем результат ДО
  // setPlan. Rejected sync НЕ вызывает setPlan вовсе (нет history checkpoint,
  // canUndo не меняется, autosave не запускается). Успешный sync без
  // фактических изменений rooms/zones тоже не создаёт пустой checkpoint.
  const runAutoZonesSync = () => {
    const result = computeAutoZonesSync(plan);
    if (!result.ok) {
      setRoomDetectionDiagnostic(result.diagnostics[0]);
      return;
    }
    if (roomDetectionDiagnostic) setRoomDetectionDiagnostic(null);
    const changed = JSON.stringify(result.plan.rooms) !== JSON.stringify(plan.rooms)
      || JSON.stringify(result.plan.zones) !== JSON.stringify(plan.zones);
    if (!changed) return;
    setPlan(() => result.plan);
  };

  // PHASE 1A-2A — единая UI orchestration граница для geometry commands
  // (executeGeometryCommand). getPlan берёт живой HistoryModel.current через
  // usePlanHistory.getCurrentPlan, а не замыкание `plan` этого рендера.
  // Это гарантирует, что две быстрые команды в одном JS tick читают актуальный
  // committed plan. commitPlan вызывается ДИСПЕТЧЕРОМ ровно один раз при
  // changed:true — room sync уже выполнен внутри executeGeometryCommand и
  // здесь повторно не запускается (см. src/planner/ui/geometryCommandDispatcher.js).
  const runGeometryCommand = createGeometryCommandDispatcher({
    getPlan: getCurrentPlan,
    commitPlan: (nextPlan) => setPlan(() => nextPlan),
    setSelection: setSel,
    setRuntimeDiagnostic: setRoomDetectionDiagnostic,
    showMessage: (text) => window.alert(text),
    makeId: uid,
  });

  const applyTypedLength = () => {
    const len = parseInt(typedLengthRef.current, 10);
    if (!len || draft.length < 1 || !cursor) return false;
    const from = draft[draft.length - 1];
    const { pt, angleSnap } = computeDraftPt(cursor, from);
    const ang = angleSnap?.snappedAngle ?? angleBetweenDeg(from, pt);
    const end = { x: from.x + Math.cos((ang * Math.PI) / 180) * len, y: from.y + Math.sin((ang * Math.PI) / 180) * len };
    if (tool === "wall") {
      addWallDraftSegment(from, end);
      setDraft(wallDraftStateRef.current.pts);
      wallPrevAngleRef.current = ang;
    } else {
      setDraft((d) => [...d, end]);
    }
    setTypedLength("");
    return true;
  };

  const syncEngineeringPlan = useCallback(
    (nextPlan) => syncClimatePlan(syncElectricalPlan(syncPlanPipes(nextPlan))),
    [],
  );

  const updateObj = (coll, oid, patch) => {
    setPlan((p) => {
      let next = {
        ...p,
        [coll]: p[coll].map((o) => (o.id === oid ? { ...o, ...patch } : o)),
      };
      if (coll === "walls") {
        const resolved = resolvePlanWalls(next);
        next = {
          ...next,
          items: refreshWallMountedItems(next.items, resolved, next.room, oid),
        };
        next = syncAutoZones(next);
      } else if (coll === "zones") {
        next = {
          ...next,
          rooms: (next.rooms || []).map((r) => {
            if (r.id !== oid) return r;
            return {
              ...r,
              name: patch.name ?? r.name,
              category: patch.category ?? r.category,
              heightMm: patch.heightMm ?? patch.height ?? r.heightMm,
              fillColor: patch.fillColor ?? patch.zoneColor ?? r.fillColor,
              climateZone: patch.climateZone ?? r.climateZone,
              sanitationZone: patch.sanitationZone ?? r.sanitationZone,
              productionZone: patch.productionZone ?? r.productionZone,
              targetTemperatureC: patch.targetTemperatureC ?? r.targetTemperatureC,
              targetRh: patch.targetRh ?? r.targetRh,
              targetCo2Ppm: patch.targetCo2Ppm ?? r.targetCo2Ppm,
              targetAirChanges: patch.targetAirChanges ?? r.targetAirChanges,
              targetAirVelocityMs: patch.targetAirVelocityMs ?? r.targetAirVelocityMs,
              notes: patch.notes ?? r.notes,
              visible: patch.visible ?? r.visible,
              locked: patch.locked ?? r.locked,
            };
          }),
        };
        next = syncEngineeringPlan(next);
      } else if (coll === "lines") {
        next = syncEngineeringPlan(next);
      } else if (coll === "items") {
        next = syncEngineeringPlan(next);
      }
      return next;
    });
  };
  const deleteHits = useCallback((coll, ids) => {
    if (!ids?.length) return false;
    if (coll === "zones") {
      const z = plan.zones.find((o) => o.id === ids[0]);
      if (z?.auto) return false;
    }
    if (coll === "item-label") {
      const idSet = new Set(ids);
      setPlan((p) => ({
        ...p,
        items: p.items.map((it) => (idSet.has(it.id) ? { ...it, labelHidden: true } : it)),
      }));
      clearSelection();
      return true;
    }
    if (coll === "walls") {
      // PHASE 1A-2C2B: canonical command boundary — wall.delete already
      // handles orphan-node pruning, dangling-opening removal (400mm
      // re-place or delete), and wall-attached manual-dimension detach (see
      // geometryCommands.js handleWallDelete) — not duplicated here.
      const { status } = applyWallDelete({ wallId: ids[0], runGeometryCommand });
      if (status === "success" || status === "noop" || status === "no-target") {
        clearSelection();
      }
      // geometry-rejected / commit-failed: selection preserved for
      // analysis/retry, geometry unchanged — no false-success cleanup.
      return status === "success";
    }
    if (coll === "items") {
      // PHASE 1A-2C2D3B (deleteHits): canonical command boundary —
      // item.bulkDelete already handles links cleanup and item-attached
      // dimension detach/delete atomically for the whole delete set (see
      // geometryCommands.js deleteItemsFromPlan) — not duplicated here.
      const { status } = applyItemBulkDelete({ itemIds: ids, runGeometryCommand });
      if (status === "success" || status === "noop" || status === "no-target") {
        clearSelection();
      }
      // geometry-rejected / commit-failed: selection preserved for
      // analysis/retry, geometry unchanged — no false-success cleanup.
      return status === "success";
    }
    if (coll === "lines") {
      // PHASE 1A-2C2D3E2 (deleteHits): canonical command boundary —
      // line.bulkDelete already runs the shared engineering-derived sync
      // exactly once for the whole delete set (see geometryCommands.js
      // deleteLinesFromPlan) — not duplicated here. Full ids array is
      // forwarded (not just ids[0]) so a future multi-line selection is
      // already handled atomically.
      const { status } = applyLineBulkDelete({ lineIds: ids, runGeometryCommand });
      if (status === "success" || status === "noop" || status === "no-target") {
        clearSelection();
      }
      // geometry-rejected / commit-failed: selection preserved for
      // analysis/retry, geometry unchanged — no false-success cleanup.
      return status === "success";
    }
    setPlan((p) => {
      let next = { ...p };
      if (coll === "rulers") {
        const idSet = new Set(ids);
        next.rulers = (p.rulers || []).filter((r) => !idSet.has(r.id));
      } else if (coll === "measurements") {
        const idSet = new Set(ids);
        next.measurements = (p.measurements || []).filter((m) => !idSet.has(m.id));
        next.rulers = (p.rulers || []).filter((r) => !idSet.has(r.id));
      } else if (coll === "dimensions") {
        const idSet = new Set(ids);
        next.dimensions = (p.dimensions || []).filter((d) => !idSet.has(d.id) || d.auto === true);
      } else if (coll === "structurals") {
        const idSet = new Set(ids);
        next.structurals = (p.structurals || []).filter((s) => !idSet.has(s.id));
      } else {
        const id = ids[0];
        if (coll === "links") {
          next.links = (p.links || []).filter((l) => l.id !== id);
        } else {
          next[coll] = p[coll].filter((o) => o.id !== id);
        }
      }
      return next;
    });
    clearSelection();
    return true;
  }, [plan.zones, runGeometryCommand]);

  const delSel = () => {
    if (!selection?.ids?.length) return;
    deleteHits(selection.coll, selection.ids);
  };

  const deleteHit = useCallback((hit) => {
    if (!hit?.id) return false;
    return deleteHits(hit.coll, [hit.id]);
  }, [deleteHits]);

  const pickPlanHit = useCallback((mm) => {
    for (const it of [...plan.items].reverse()) {
      if (mm.x >= it.x && mm.x <= it.x + it.w && mm.y >= it.y && mm.y <= it.y + it.h) {
        return { coll: "items", id: it.id };
      }
    }
    const resolvedWalls = resolvePlanWalls(plan);
    const bodyWall = pickWallBodyHit(mm, resolvedWalls, plan.room);
    if (bodyWall) return { coll: "walls", id: bodyWall.wall.id };
    for (const w of resolvedWalls) {
      for (let i = 1; i < w.pts.length; i++) {
        const a = w.pts[i - 1];
        const b = w.pts[i];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (Math.hypot(mm.x - mid.x, mm.y - mid.y) < Math.max(w.thk || 100, 120) * 0.65) {
          return { coll: "walls", id: w.id };
        }
      }
    }
    for (const ln of plan.lines) {
      if (hitTestLine(mm, ln, 140 / Math.max(view.zoom, 0.2))) {
        return { coll: "lines", id: ln.id };
      }
    }
    for (const link of linksVisibleOnLayer(plan.links, active, display)) {
      const { pts } = linkLengthMm(link, plan.items, plan.room);
      if (pts.length >= 2 && hitTestLine(mm, { pts }, 120 / Math.max(view.zoom, 0.2))) {
        return { coll: "links", id: link.id };
      }
    }
    for (const lb of plan.labels) {
      const pos = resolveFreeLabelPosition(lb, plan.items.find((i) => i.id === lb.targetId));
      if (pos && Math.hypot(mm.x - pos.x, mm.y - pos.y) < 180 / Math.max(view.zoom, 0.08)) {
        return { coll: "labels", id: lb.id };
      }
    }
    for (const m of (plan.rulers || plan.measurements || [])) {
      const d = Math.hypot(mm.x - m.a.x, mm.y - m.a.y);
      const d2 = Math.hypot(mm.x - m.b.x, mm.y - m.b.y);
      const mid = { x: (m.a.x + m.b.x) / 2, y: (m.a.y + m.b.y) / 2 };
      const dm = Math.hypot(mm.x - mid.x, mm.y - mid.y);
      const thr = 180 / Math.max(view.zoom, 0.08);
      if (d < thr || d2 < thr || dm < thr) {
        return { coll: "rulers", id: m.id };
      }
    }
    for (const s of (plan.structurals || [])) {
      if (hitTestStructural(mm, s, 140 / Math.max(view.zoom, 0.2))) {
        return { coll: "structurals", id: s.id };
      }
    }
    for (const z of plan.zones) {
      if (z.polygon?.length >= 3 && pointInPolygon(mm, z.polygon)) {
        return { coll: "zones", id: z.id };
      }
      if (mm.x >= z.x && mm.x <= z.x + z.w && mm.y >= z.y && mm.y <= z.y + z.h) {
        return { coll: "zones", id: z.id };
      }
    }
    return null;
  }, [plan.items, plan.walls, plan.lines, plan.links, plan.labels, plan.zones, plan.rulers, plan.measurements, plan.structurals, plan.room, active, display, view.zoom]);

  const enterEraseMode = useCallback(() => {
    setTool("erase");
    setPending(null);
    setLinkFrom(null);
    clearWallChain();
  }, []);

  const handleDeleteAction = useCallback(() => {
    if (selection?.ids?.length) {
      deleteHits(selection.coll, selection.ids);
      return;
    }
    if (tool === "erase") {
      setTool("select");
      return;
    }
    if ((plan.rulers || plan.measurements || []).length > 0 || (plan.dimensions || []).length > 0) {
      setPlan((p) => ({ ...p, rulers: [], measurements: [], dimensions: [] }));
      setMeasure([]);
      setMeasureOffsetPt(null);
      return;
    }
    enterEraseMode();
  }, [selection, tool, deleteHits, enterEraseMode, plan.rulers, plan.measurements, plan.dimensions, setPlan]);

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
    const baseItem = {
      ...base,
      id: uid("eq"),
      doorSwing: "left",
      doorOpenIn: true,
      doorNum: isDoorKind(c.kind) ? nextDoorNumber(plan.items) : null,
      doorHeightMm: isDoorKind(c.kind) ? 2100 : null,
      openingNum: isOpeningKind(c.kind) ? nextOpeningNumber(plan.items) : null,
      ...(isOpeningKind(c.kind) ? defaultOpeningFields(c.kind) : {}),
      ...(isRackKind(c.kind) ? defaultRackFields(c.kind, plan.items) : {}),
      params: { ...(c.params || {}), ...(pendingSize?.params || {}) },
      ...defaultObjectSpecSettings(c.kind),
    };
    const farmCategory = farmCategoryForKind(c.kind);
    const keepLegacy = isDoorKind(c.kind) || isOpeningKind(c.kind);
    const item = keepLegacy
      ? normalizePlannerObject({
        ...baseItem,
        type: "legacy_object",
        rotationDeg: pendingRotationDeg,
        angle: pendingRotationDeg || baseItem.angle || 0,
      })
      : createFarmObject(
        {
          ...baseItem,
          category: farmCategory,
          subtype: c.kind,
          name: baseItem.label || c.label,
          widthMm: baseItem.w,
          depthMm: baseItem.h,
          heightMm: baseItem.height || baseItem.rackHeightMm || plan.room?.height || 3000,
          rotationDeg: pendingRotationDeg,
          angle: pendingRotationDeg || baseItem.angle || 0,
          params: {
            ...(baseItem.params || {}),
            ...(isRackKind(c.kind) ? {
              rackType: pendingSize?.rackType || baseItem.rackType || "nft",
              levels: baseItem.tierCount || baseItem.params?.tiers || 5,
            } : {}),
          },
        },
        { presetId: pendingSize?.farmPresetId || null },
      );
    setPlan((p) => syncEngineeringPlan({ ...p, items: [...p.items, item] }));
    if (shiftRef.current && isRackKind(c.kind)) {
      setGuides(preview.guides || []);
      return;
    }
    setSel({ coll: "items", id: item.id });
    setTool("select");
    setGuides([]);
  };

  const beginLabelAnchor = useCallback((mm, targetId = null) => {
    let tid = targetId;
    if (!tid) {
      for (const it of [...plan.items].reverse()) {
        if (mm.x >= it.x && mm.x <= it.x + it.w && mm.y >= it.y && mm.y <= it.y + it.h) {
          tid = it.id;
          break;
        }
      }
    }
    const tgt = tid ? plan.items.find((i) => i.id === tid) : null;
    setLabelDraft({
      anchor: { x: sn(mm.x), y: sn(mm.y) },
      targetId: tid,
      targetName: tgt?.label || tgt?.rackNum || catalogByKind(tgt?.kind)?.label || null,
    });
  }, [plan.items, sn]);

  const cancelLabelDraft = useCallback(() => setLabelDraft(null), []);

  const confirmLabelDraft = useCallback(({ text, fontSizePt = DEFAULT_LABEL_FONT_PT }) => {
    if (!labelDraft) return;
    const { anchor, targetId } = labelDraft;
    const tgt = targetId ? plan.items.find((i) => i.id === targetId) : null;
    const box = autoCalloutPlacement(anchor, plan.room, tgt);
    const l = {
      id: uid("lb"),
      ...defaultFreeLabelFields({
        anchor,
        target: tgt,
        textBox: { x: sn(box.x), y: sn(box.y) },
        text: text || "Подпись",
        fontSizePt,
      }),
    };
    setPlan((p) => ({ ...p, labels: [...p.labels, l] }));
    setSel({ coll: "labels", id: l.id });
    setLabelDraft(null);
    setTool("select");
  }, [labelDraft, plan.items, plan.room, sn]);

  const finishWallChain = () => {
    // PHASE 1A-2B2 corrective: wallDraftStateRef.current — единственный
    // источник истины. Раньше здесь был fallback на render-closure `draft`
    // (React state) — ref обновляется синхронно (clearWallChain присваивает
    // wallDraftStateRef.current = createWallDraftState() немедленно), а
    // `draft` обновляется только на следующем render. Если бы finish
    // вызывался дважды подряд без промежуточного render (напр. два быстрых
    // Enter), второй вызов через fallback мог прочитать СТАРЫЕ точки из ещё
    // не перерендеренного `draft`, хотя ref уже пуст — риск дублирующей
    // цепочки. Без fallback второй вызов видит уже очищенный ref и корректно
    // не создаёт команду.
    const meta = wallDraftFinishMeta(wallDraftStateRef.current);
    const pts = meta?.pts;
    const closed = meta?.closed === true;
    if (!pts || pts.length < 2) {
      // Меньше 2 точек — как и раньше, тихий cancel: ни plan, ни history не
      // трогаются, draft просто очищается (см. RESULT — PHASE 1A-2B2,
      // "Draft state policy").
      clearWallChain();
      return;
    }
    // PHASE 1A-2B2: через command boundary — вся цепочка одной командой
    // (wall.create), а не commitPlan(updater) с безусловным checkpoint, как
    // раньше. wallProps считается от живого plan.room (getCurrentPlan, не
    // render-closure `plan`) — тот же снимок, что раньше читался как `p.room`
    // внутри commitPlan(updater), просто взятый непосредственно перед
    // вызовом, а не изнутри updater'а.
    const role = active === "room" ? "outer" : "partition";
    const liveRoom = getCurrentPlan().room;
    const toolFields = wallFieldsFromTool(activeToolId, role, liveRoom, wallThk);
    const wallProps = {
      ...defaultWallFields(toolFields.role || role, liveRoom),
      ...toolFields,
      thk: toolFields.thk ?? (role === "outer" ? (liveRoom.wallThk || wallThk) : wallThk),
    };
    const result = runGeometryCommand({ type: "wall.create", points: pts, wallProps, closed });
    // success (changed:true) ИЛИ no-op (changed:false, напр. цепочка схлопнулась
    // в <2 точек после dedup) — цепочку рисовать больше нечего, draft чистим.
    // rejected (ok:false) — draft НЕ трогаем, чтобы пользователь мог
    // исправить точки и повторить (см. секция 6 задания "Rejected/invalid").
    if (result?.ok) clearWallChain();
  };

  const addWallDraftSegment = (from, to, fromOverride = null) => {
    const start = fromOverride || from;
    if (!start || !to || Math.hypot(to.x - start.x, to.y - start.y) < 50) return false;
    const { state, added } = wallDraftAddSegment(wallDraftStateRef.current, to);
    if (!added) return false;
    wallDraftStateRef.current = state;
    wallPrevAngleRef.current = angleBetweenDeg(start, to);
    setDraft(state.pts);
    return true;
  };

  /** @deprecated — используйте finishWallChain / addWallDraftSegment */
  const commitWallDraft = (pts) => {
    if (!pts || pts.length < 2) return;
    wallDraftStateRef.current = { ...wallDraftStateRef.current, pts };
    finishWallChain();
  };

  const commitWallSegment = (from, to, fromOverride = null) => {
    addWallDraftSegment(from, to, fromOverride);
  };

  const commitDimension = (p1, p2, offsetPoint) => {
    if (!p1 || !p2) return;
    if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 20) return;
    const orientation = Math.abs(p2.x - p1.x) >= Math.abs(p2.y - p1.y) ? "horizontal" : "vertical";
    const offset = offsetPoint ? dimensionOffsetFromPoint(p1, p2, offsetPoint) : 120;
    setPlan((p) => ({
      ...p,
      dimensions: [
        ...(p.dimensions || []),
        {
          id: uid("dim"),
          type: "dimension",
          mode: "linear",
          p1: { x: p1.x, y: p1.y },
          p2: { x: p2.x, y: p2.y },
          offset,
          orientation,
          attachedTo: null,
          labelOverride: null,
          locked: false,
        },
      ],
    }));
  };

  /** Manual/free dimension only — wall-attached full-wall edits go through submitWallLengthEdit below. */
  const applyDimensionEdit = (dimId, value) => {
    setPlan((p) => ({
      ...p,
      dimensions: (p.dimensions || []).map((d) => (d.id === dimId ? { ...d, labelOverride: value } : d)),
    }));
  };

  // PHASE 1B-1B — canonical apply path for the full-wall-length editor. The
  // session guard makes a trailing native blur (fired when the input unmounts
  // after a successful Enter) a safe no-op, regardless of React render timing.
  const submitWallLengthEdit = (entry) => {
    if (!entry || !dimensionEditSessionRef.current.tryConsume(entry.token)) return;
    const result = applyWallLengthEdit({
      rawValue: entry.value,
      wallId: entry.wallId,
      fixedEndpoint: entry.fixedEndpoint,
      runGeometryCommand,
    });
    if (result.status === "parse-rejected") {
      dimensionEditSessionRef.current.reopen(entry.token);
      setDimensionEdit((d) => (d && d.id === entry.id ? { ...d, error: result.message } : d));
      return;
    }
    if (result.status === "geometry-rejected" || result.status === "commit-failed") {
      // result.result?.error?.message (if any) is already surfaced via
      // showMessage by the dispatcher itself — nothing further to show here.
      dimensionEditSessionRef.current.reopen(entry.token);
      setDimensionEdit((d) => (d && d.id === entry.id ? { ...d, error: null } : d));
      return;
    }
    setDimensionEdit(null); // success or no-op
  };

  /** @deprecated старый инструмент линейки. */
  const commitRuler = (a, b) => {
    if (!a || !b || Math.hypot(b.x - a.x, b.y - a.y) < 20) return;
    setPlan((p) => ({
      ...p,
      rulers: [...(p.rulers || []), { id: uid("rl"), a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } }],
    }));
  };

  const updateRuler = (id, patch) => {
    setPlan((p) => ({
      ...p,
      rulers: (p.rulers || []).map((r) => (r.id === id ? { ...r, ...patch, a: patch.a ? { ...r.a, ...patch.a } : r.a, b: patch.b ? { ...r.b, ...patch.b } : r.b } : r)),
    }));
  };

  const startRulerDrag = (e, id, end = null) => {
    const r = (plan.rulers || []).find((x) => x.id === id);
    if (!r) return;
    const mm = toMM(e.clientX, e.clientY);
    dragRef.current = {
      mode: end ? `ruler-${end}` : "ruler-move",
      id,
      ox: r.a.x,
      oy: r.a.y,
      ox2: r.b.x,
      oy2: r.b.y,
      dx: mm.x,
      dy: mm.y,
    };
    setSelection({ coll: "rulers", ids: [id] });
    try { svgRef.current.setPointerCapture(e.pointerId); } catch (_) {}
  };

  const commitStructuralSegment = (from, to) => {
    if (!from || !to || !structuralKind || structuralKind === "column") return;
    if (Math.hypot(to.x - from.x, to.y - from.y) < 50) return;
    const fields = defaultStructuralFields(structuralKind, structuralWidth);
    setPlan((p) => ({
      ...p,
      structurals: [...(p.structurals || []), { id: uid("st"), a: { ...from }, b: { ...to }, ...fields }],
    }));
  };

  const commitStructuralColumn = (center) => {
    if (!center || structuralKind !== "column") return;
    const fields = defaultStructuralFields("column", structuralWidth);
    setPlan((p) => ({
      ...p,
      structurals: [...(p.structurals || []), { id: uid("st"), center: { ...center }, ...fields }],
    }));
  };

  const nudgeWallSelection = (dx, dy) => {
    if (selection?.coll !== "walls" || selection.ids?.length !== 1) return;
    const wid = selection.ids[0];
    const nidx = selection.nodeIdx;
    // PHASE 1A-2B1: через command boundary — node.nudge уже воспроизводит
    // nudgeWallInPlan (включая whole-wall translate при nodeIdx == null) и
    // сам гарантирует ноль checkpoint на zero-delta/no-op (см.
    // geometryCommands.js handleNodeNudge).
    runGeometryCommand({ type: "node.nudge", wallId: wid, nodeIdx: nidx, dx, dy, round: fineMm });
  };

  const finishDraft = (ptsOverride = null) => {
    const pts = ptsOverride || draft;
    if (tool === "wall") {
      if (ptsOverride) wallDraftStateRef.current = { ...wallDraftStateRef.current, pts: ptsOverride };
      finishWallChain();
      return;
    }
    if (pts.length >= 2) {
      const layer = lineDraftMeta.layer || migrateLayerId(active, null);
      const draftLine = {
        id: uid("ln"),
        layer,
        pts,
        ...defaultLineFields(layer),
        ...(lineDraftMeta.tag ? { lineTag: lineDraftMeta.tag } : {}),
        ...(lineDraftMeta.lineType ? { lineType: lineDraftMeta.lineType } : {}),
        ...(lineDraftMeta.diameterMm != null ? { diameterMm: lineDraftMeta.diameterMm } : {}),
        ...(lineDraftMeta.airflowM3h != null ? { airflowM3h: lineDraftMeta.airflowM3h } : {}),
        ...(lineDraftMeta.ductType ? { ductType: lineDraftMeta.ductType } : {}),
        ...(lineDraftMeta.flowDirection ? { flowDirection: lineDraftMeta.flowDirection } : {}),
      };
      const isPipeDraft = layer === "irrigation" || layer === "drain" || !!lineDraftMeta.pipeSystem || isPipeLine(draftLine);
      const isDuctDraft = !isPipeDraft && ((layer === "vent" || layer === "climate") || isDuctLine(draftLine));
      const lineModel = isPipeDraft
        ? normalizePipe({
          ...draftLine,
          type: "pipe",
          pipeSystem: lineDraftMeta.pipeSystem || (layer === "drain" ? "drainage" : "irrigation"),
          pipeRole: lineDraftMeta.pipeRole || (layer === "drain" ? "drain" : "supply"),
          diameterMm: lineDraftMeta.diameterMm,
          material: lineDraftMeta.material,
          flowDirection: lineDraftMeta.flowDirection || "forward",
          points: pts,
        })
        : isDuctDraft
          ? normalizeDuct({
            ...draftLine,
            type: "duct",
            points: pts,
          })
        : draftLine;
      const line = attachLineEndpoints(
        {
          ...lineModel,
        },
        plan.items,
      );
      setPlan((p) => syncEngineeringPlan({ ...p, lines: [...p.lines, line] }));
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
    setPendingRotationDeg(0);
    setLineDraftMeta({
      layer: st.lineLayer,
      tag: st.lineTag,
      ...(st.linePipe || {}),
      ...(st.lineMeta || {}),
      flowDirection: "forward",
    });
    setActiveToolId(def?.id || "select");
    setSelection((sel) => (sel?.coll === "zones" ? null : sel));
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
    const sheet = sheetById(mode.defaultSheetId || "base_plan");
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

  const applyBackdropImage = (dataUrl, imgW, imgH) => {
    const fitW = plan.room.w;
    const fitH = imgW > 0 ? (imgH / imgW) * fitW : plan.room.h;
    setPlan((p) => ({
      ...p,
      room: {
        ...p.room,
        showBoundary: true,
        backdrop: {
          dataUrl,
          x: 0,
          y: Math.max(0, (p.room.h - fitH) / 2),
          w: fitW,
          h: fitH,
          opacity: 0.55,
        },
      },
    }));
  };

  const handleBackdropFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const img = new Image();
      img.onload = () => applyBackdropImage(dataUrl, img.naturalWidth, img.naturalHeight);
      img.onerror = () => window.alert("Не удалось прочитать изображение");
      img.src = dataUrl;
    };
    reader.onerror = () => window.alert("Не удалось загрузить файл");
    reader.readAsDataURL(file);
  };

  const scaleBackdrop = () => {
    const bd = plan.room?.backdrop;
    if (!bd?.dataUrl) {
      window.alert("Сначала загрузите подложку");
      return;
    }
    const nextW = +(prompt("Ширина подложки на плане, мм:", String(Math.round(bd.w || plan.room.w))) || 0);
    if (!nextW || nextW < 100) return;
    const ratio = (bd.h || plan.room.h) / (bd.w || plan.room.w);
    setPlan((p) => ({
      ...p,
      room: {
        ...p.room,
        backdrop: { ...bd, w: nextW, h: Math.round(nextW * ratio) },
      },
    }));
  };

  const clearBackdrop = () => {
    setPlan((p) => {
      const { backdrop, ...restRoom } = p.room || {};
      return { ...p, room: restRoom };
    });
  };

  const addLightForRack = useCallback((rack) => {
    if (!rack || !isRackKind(rack.kind)) return;
    const rackLevels = Math.max(1, Number(rack.params?.levels || rack.tierCount || 1));
    const lightType = prompt(
      "Тип светильника (linear_60, linear_100, linear_120, quantum_board, service_light, germination_light):",
      "linear_100",
    );
    if (!lightType) return;
    const perLevel = Math.max(1, +(prompt("Количество на ярус:", "2") || 0));
    const lengthMm = Math.max(300, +(prompt("Длина светильника, мм:", "1000") || 0));
    const powerW = Math.max(1, +(prompt("Мощность одного светильника, Вт:", "40") || 0));
    const levels = Math.max(1, +(prompt("Ярусов для света:", String(rackLevels)) || 0));
    const groupName = (prompt("Группа света:", "D") || "D").trim() || "D";
    const offsetX = Math.round((rack.w || rack.widthMm || 1000) * 0.15);
    const offsetY = Math.round((rack.h || rack.depthMm || 600) * 0.15);
    const light = createFarmObject({
      id: uid("eq"),
      kind: "light_panel",
      layer: "light",
      x: rack.x + offsetX,
      y: rack.y + offsetY,
      w: Math.max(300, Math.min(lengthMm, rack.w || lengthMm)),
      h: 120,
      label: "Свет стеллажа",
      category: "light",
      params: {
        lightType,
        lengthMm,
        powerW,
        linkedRackId: rack.id,
        groupName,
        perLevel,
        levels,
        count: perLevel * levels,
        offsetX,
        offsetY,
      },
    });
    setPlan((p) => syncEngineeringPlan({ ...p, items: [...p.items, attachItemZoneFields(p, light)] }));
  }, [syncEngineeringPlan]);

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
      else if (toolDef.action === "backdrop_upload") backdropInputRef.current?.click();
      else if (toolDef.action === "backdrop_scale") scaleBackdrop();
      else if (toolDef.action === "backdrop_clear") clearBackdrop();
      else if (toolDef.action === "rack_add_light") {
        const obj = selObj && isRackKind(selObj.kind) ? selObj : plan.items.find((i) => isRackKind(i.kind));
        if (!obj) { window.alert("Выберите стеллаж на плане"); return; }
        addLightForRack(obj);
      }
      else if (toolDef.action === "rack_number") setPlan((p) => syncEngineeringPlan({ ...p, items: autoNumberRacks(p.items) }));
      else if (toolDef.action === "rack_grid" || toolDef.action === "rack_row") {
        const obj = selObj && isRackKind(selObj.kind) ? selObj : plan.items.find((i) => isRackKind(i.kind));
        if (!obj) { window.alert("Выберите стеллаж на плане"); return; }
        const cols = toolDef.action === "rack_row" ? 1 : +(prompt("Колонок:", "3") || 0);
        const rows = toolDef.action === "rack_row" ? +(prompt("Стеллажей в ряду:", "5") || 0) : +(prompt("Рядов:", "2") || 0);
        const gap = +(prompt("Расстояние между стеллажами, мм:", "800") || 800);
        const aisle = +(prompt("Проход между рядами, мм:", "900") || 900);
        if (cols > 0 && rows > 0) {
          setPlan((p) => {
            const countInRow = toolDef.action === "rack_row" ? rows : cols;
            const rowCount = toolDef.action === "rack_row" ? 1 : rows;
            const { group, children } = createRackGroup(
              obj,
              { count: countInRow, rows: rowCount, spacingMm: gap, aisleMm: aisle, direction: "x" },
              uid,
            );
            let items = [...p.items];
            const nextChildren = children.map((child, idx) => {
              const patch = idx === 0 && child.id === obj.id
                ? child
                : { ...child, id: uid("eq") };
              const numbered = isRackKind(patch.kind)
                ? { ...patch, rackNum: nextRackNumber(items, patch.id, patch.rowNum || obj.rowNum || "") }
                : patch;
              const normalized = normalizePlannerObject(numbered);
              if (idx === 0) {
                items = items.map((it) => (it.id === obj.id ? normalized : it));
              } else {
                items.push(normalized);
              }
              return normalized;
            });
            return syncEngineeringPlan({
              ...p,
              items: items.map((it) => attachItemZoneFields({ ...p, items }, it)),
              farmObjectGroups: [
                ...(p.farmObjectGroups || []).filter((g) => g.id !== group.id),
                { ...group, childrenIds: nextChildren.map((c) => c.id) },
              ],
            });
          });
        }
      }
      return;
    }
    const st = toolStateFromDef(toolDef);
    setTool(st.tool);
    setPending(st.pending);
    setPendingSize(st.pendingSize);
    setLineDraftMeta({
      layer: st.lineLayer,
      tag: st.lineTag,
      ...(st.linePipe || {}),
      ...(st.lineMeta || {}),
      flowDirection: "forward",
    });
    setLinkFrom(null);
    if (st.tool === "wall" || st.tool === "line") clearWallChain();
    if (st.tool !== "measure") {
      measureDrawRef.current = null;
      setMeasure([]);
      setMeasureOffsetPt(null);
      setRulerSnap(null);
    }
    if (st.tool === "wall" && toolDef.id) {
      setWallThk(defaultWallThkForTool(toolDef.id, wallThk));
    }
    if (st.tool === "structural" && st.pending) {
      setStructuralWidth(getStructuralDefaultWidth(st.pending));
      structuralDrawRef.current = null;
    }
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
    if (t !== "measure") {
      measureDrawRef.current = null;
      setMeasure([]);
      setMeasureOffsetPt(null);
      setRulerSnap(null);
    }
    if (t === "add" && !pending && catalogForLayer(active).length) setPending(catalogForLayer(active)[0].kind);
    if (t !== "add") setPendingRotationDeg(0);
  };

  const handlePending = (kind, size) => {
    setPending(kind);
    if (size?.w != null) {
      setPendingSize({ ...size });
    } else {
      const c = resolveCatalogKind(kind);
      setPendingSize(c?.w != null ? { w: c.w, h: c.h } : null);
    }
    setPendingRotationDeg(0);
    setTool("add");
  };

  const toggleDisplay = (key) => setDisplay((d) => normalizeDisplay({ ...d, [key]: !d[key] }));
  const patchDisplay = (patch) => {
    setDisplay((d) => {
      const next = normalizeDisplay({ ...d, ...patch });
      if (Object.keys(patch).some((k) => VISUAL_PREF_KEYS.includes(k))) saveVisualPrefs(next);
      return next;
    });
  };

  const fitView = () => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const b = planWorkingBounds(plan);
    const bw = b.r - b.l;
    const bh = b.b - b.t;
    const m = 160;
    const z = clamp(Math.min((r.width - m) / bw, (r.height - m) / bh), 0.015, 3);
    setView({ zoom: z, panX: (r.width - bw * z) / 2 - b.l * z, panY: (r.height - bh * z) / 2 - b.t * z });
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

  useEffect(() => {
    const id = requestAnimationFrame(() => fitView());
    return () => cancelAnimationFrame(id);
  }, [standalone ? draftId : id]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (active === "room") {
      // PHASE 1A-2C2D3D2: canonical command boundary — item.bulkDelete
      // already handles links cleanup and item-attached dimension detach/
      // delete atomically for the whole delete set (see geometryCommands.js
      // deleteItemsFromPlan) — not duplicated here. This clear is
      // intentionally project-wide: layer:"room" items (doors/windows/
      // openings/legacy-import) exist independently of which room the user
      // is currently viewing, so a generic per-sheet confirm text would be
      // misleading — see RESULT — PHASE 1A-2C2D3D2, "Product policy".
      const roomItemsBeforeConfirm = getCurrentPlan().items.filter((it) => it.layer === "room");
      if (roomItemsBeforeConfirm.length === 0) {
        setSel(null);
        return;
      }
      const counts = summarizeRoomClearItems(roomItemsBeforeConfirm);
      if (!window.confirm(buildRoomClearConfirmMessage(counts))) return;
      // Live-plan race: itemIds are recomputed from a fresh getCurrentPlan()
      // read taken AFTER the confirm dialog closes, never from the
      // pre-confirm snapshot used only for the displayed counts.
      const itemIds = getCurrentPlan().items.filter((it) => it.layer === "room").map((it) => it.id);
      const { status } = applyItemBulkDelete({ itemIds, runGeometryCommand });
      if (status === "success" || status === "noop" || status === "no-target") {
        setSel(null);
      }
      // geometry-rejected / commit-failed: selection preserved, no
      // false-success cleanup.
      return;
    }
    const name = layerById(active).name;
    if (!window.confirm(`Очистить объекты листа «${name}»?`)) return;
    if (active === "partitions") {
      // PHASE 1A-2C2D2: canonical command boundary — wall.bulkDelete already
      // handles orphan-node pruning, dangling-opening removal, link cleanup,
      // and wall-attached dimension detach/delete atomically for the whole
      // delete set (see geometryCommands.js deleteWallsFromPlan) — not
      // duplicated here. Outer walls are excluded from the delete set below
      // and never sent to the command at all, so they and their nodes/
      // openings are untouched.
      const wallIds = getCurrentPlan().walls.filter((w) => w.role !== "outer").map((w) => w.id);
      const { status } = applyWallBulkDelete({ wallIds, runGeometryCommand });
      if (status === "success" || status === "noop" || status === "no-target") {
        setSel(null);
      }
      // geometry-rejected / commit-failed: selection preserved, no
      // false-success cleanup.
      return;
    }
    if (MIGRATED_ITEM_CLEAR_LAYER_IDS.includes(active)) {
      // PHASE 1A-2C2D3B (clearSheet): canonical command boundary —
      // item.bulkDelete already handles links cleanup and item-attached
      // dimension detach/delete atomically for the whole delete set (see
      // geometryCommands.js deleteItemsFromPlan) — not duplicated here.
      const itemIds = getCurrentPlan().items.filter((it) => it.layer === active).map((it) => it.id);
      const { status } = applyItemBulkDelete({ itemIds, runGeometryCommand });
      if (status === "success" || status === "noop" || status === "no-target") {
        setSel(null);
      }
      // geometry-rejected / commit-failed: selection preserved, no
      // false-success cleanup.
      return;
    }
    if (MIGRATED_LINE_CLEAR_LAYER_IDS.includes(active)) {
      // PHASE 1A-2C2D3E2 (clearSheet): canonical command boundary —
      // line.bulkDelete already runs the shared engineering-derived sync
      // exactly once for the whole delete set (see geometryCommands.js
      // deleteLinesFromPlan) — not duplicated here.
      const lineIds = getCurrentPlan().lines
        .filter((line) => line.layer === active || migrateLayerId(line.layer) === active)
        .map((line) => line.id);
      const { status } = applyLineBulkDelete({ lineIds, runGeometryCommand });
      if (status === "success" || status === "noop" || status === "no-target") {
        setSel(null);
      }
      // geometry-rejected / commit-failed: selection preserved, no
      // false-success cleanup.
      return;
    }
    setPlan((p) => {
      const next = { ...p };
      if (LINE_LAYER_IDS.includes(active)) next.lines = p.lines.filter((l) => l.layer !== active && migrateLayerId(l.layer) !== active);
      else if (ITEM_LAYER_IDS.includes(active)) next.items = p.items.filter((i) => i.layer !== active);
      return next;
    });
    setSel(null);
  };

  const copySel = () => {
    if (!selection?.ids?.length || selection.coll !== "items") return;
    let ids = selection.ids;
    if (selection.ids.length === 1) {
      const only = plan.items.find((it) => it.id === selection.ids[0]);
      if (only?.groupId) ids = groupMemberIds(plan.items, only);
    }
    const idSet = new Set(ids);
    const items = plan.items.filter((o) => idSet.has(o.id));
    if (items.length) clipboardRef.current = items.map((it) => ({ ...it }));
  };

  const pasteSel = () => {
    const src = clipboardRef.current;
    if (!src?.length) return;
    setPlan((p) => {
      let items = [...p.items];
      const newItems = src.map((it) => {
        const copy = {
          ...it,
          id: uid("eq"),
          x: it.x + 200,
          y: it.y + 200,
          groupId: null,
        };
        if (isRackKind(copy.kind)) copy.rackNum = nextRackNumber(items);
        if (isDoorKind(copy.kind)) copy.doorNum = nextDoorNumber(items);
        if (isOpeningKind(copy.kind)) copy.openingNum = nextOpeningNumber(items);
        const placed = attachItemZoneFields(p, copy);
        items.push(placed);
        return placed;
      });
      const gid = newItems.length > 1 ? uid("grp") : null;
      if (gid) newItems.forEach((c) => { c.groupId = gid; });
      setSelection({ coll: "items", ids: newItems.map((c) => c.id) });
      return { ...p, items };
    });
  };

  const moveSelByKeys = (e) => {
    if (!selection?.ids?.length) return;
    const step = resolveArrowMoveStepMm(e, display);
    const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
    const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
    if (!dx && !dy) return;
    e.preventDefault();

    if (selection.coll === "walls" && selection.ids.length === 1) {
      nudgeWallSelection(dx, dy);
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

    if (selection.coll === "structurals" && selection.ids.length === 1) {
      const sid = selection.ids[0];
      setPlan((p) => ({
        ...p,
        structurals: (p.structurals || []).map((s) => {
          if (s.id !== sid) return s;
          if (s.kind === "column" && s.center) {
            return { ...s, center: { x: sn(s.center.x + dx), y: sn(s.center.y + dy) } };
          }
          if (s.a && s.b) {
            return {
              ...s,
              a: { x: sn(s.a.x + dx), y: sn(s.a.y + dy) },
              b: { x: sn(s.b.x + dx), y: sn(s.b.y + dy) },
            };
          }
          return s;
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
          if (lb.anchorRelX != null) return lb;
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

    if (selection.coll === "item-label" && selection.ids.length) {
      const ids = new Set(selection.ids);
      setPlan((p) => ({
        ...p,
        items: p.items.map((it) => {
          if (!ids.has(it.id)) return it;
          if (!it.labelPinned) {
            const pinned = pinItemLabelFromAuto(it, p.room);
            return {
              ...it,
              ...pinned,
              labelOffsetX: pinned.labelOffsetX + dx,
              labelOffsetY: pinned.labelOffsetY + dy,
            };
          }
          return {
            ...it,
            labelOffsetX: (it.labelOffsetX ?? 0) + dx,
            labelOffsetY: (it.labelOffsetY ?? 0) + dy,
          };
        }),
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
    const groupId = uid("fog");
    const row = source.rowNum || nextRowLabel(planState.items);
    const base = {
      ...source,
      groupId,
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
        groupId,
      };
      delete copy._gridIdx;
      placed.push(attachItemZoneFields({ ...planState, items: [...items, ...placed] }, copy));
    });
    const childrenIds = [source.id, ...placed.map((p) => p.id)];
    return {
      ...planState,
      items: [...items, ...placed],
      farmObjectGroups: [
        ...(planState.farmObjectGroups || []).filter((g) => g.id !== groupId),
        {
          id: groupId,
          type: "farm_object_group",
          category: "rack_group",
          childrenIds,
          params: {
            sourceKind: source.kind,
            count: grid.length,
          },
        },
      ],
    };
  };

  const handleCtxAction = (actionId) => {
    if (actionId === "wall-draft-finish") {
      finishWallChain();
      return;
    }
    if (actionId === "wall-draft-cancel") {
      clearWallChain();
      return;
    }
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
    const obj = findSelObject(sel.coll, sel.id);
    if (!obj) return;
    if (actionId === "delete") {
      if (sel.coll === "zones" && obj.auto) return;
      delSel();
    }
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
      beginLabelAnchor({ x: obj.x + obj.w / 2, y: obj.y + obj.h / 2 }, obj.id);
    }
    else if (actionId === "item-lock" && sel.coll === "items") {
      updateObj("items", obj.id, { locked: !obj.locked });
    }
    else if (actionId === "item-dims" && sel.coll === "items") {
      const show = obj.dimensions?.display !== false;
      updateObj("items", obj.id, { dimensions: { ...(obj.dimensions || {}), display: !show } });
    }
    else if (actionId === "rack-num" && sel.coll === "items" && isRackKind(obj.kind)) {
      const num = prompt("Номер стеллажа:", obj.rackNum || nextRackNumber(plan.items, obj.id));
      if (num != null) updateObj("items", obj.id, { rackNum: num.trim() });
    }
    else if (actionId === "rack-auto-num" && sel.coll === "items") {
      setPlan((p) => syncEngineeringPlan({ ...p, items: autoNumberRacks(p.items) }));
    }
    else if (actionId === "rack-row" && sel.coll === "items" && isRackKind(obj.kind)) {
      const count = parseInt(prompt("Сколько стеллажей в ряду?", "4"), 10);
      if (!count || count < 2) return;
      const gap = parseInt(prompt("Зазор между стеллажами, мм:", "800"), 10) || 800;
      setPlan((p) => syncEngineeringPlan(placeRackCopies(p, obj, buildRackGrid(obj, { cols: count, rows: 1, gapMm: gap }))));
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
    else if (actionId === "rack-add-light" && sel.coll === "items" && isRackKind(obj.kind)) {
      addLightForRack(obj);
    }
    else if (actionId === "rack-grid" && sel.coll === "items" && isRackKind(obj.kind)) {
      const cols = parseInt(prompt("Стеллажей в ряду (по горизонтали)?", "4"), 10);
      const rows = parseInt(prompt("Количество рядов?", "2"), 10);
      if (!cols || !rows || cols < 1 || rows < 1) return;
      const gap = parseInt(prompt("Зазор между стеллажами, мм:", "800"), 10) || 800;
      const rowGap = parseInt(prompt("Проход между рядами, мм:", "1200"), 10) || 1200;
      const dir = prompt("Направление рядов (h — горизонтально, v — вертикально):", "h");
      setPlan((p) => syncEngineeringPlan(placeRackCopies(p, obj, buildRackGrid(obj, {
        cols, rows, gapMm: gap, rowGapMm: rowGap, direction: dir === "v" ? "v" : "h",
      }))));
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
        setPlan((p) => {
          let next = movePlanNode(p, obj.a, nw.pts[0]);
          next = movePlanNode(next, obj.b, nw.pts[1]);
          const resolved = resolvePlanWalls(next);
          return syncAutoZones({
            ...next,
            items: refreshWallMountedItems(p.items, resolved, p.room, obj.id),
          });
        });
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
        setPlan((p) => {
          let next = movePlanNode(p, obj.a, nw.pts[0]);
          next = movePlanNode(next, obj.b, nw.pts[1]);
          const resolved = resolvePlanWalls(next);
          return syncAutoZones({
            ...next,
            items: refreshWallMountedItems(p.items, resolved, p.room, obj.id),
          });
        });
      }
    }
    else if (actionId === "wall-role-outer" && sel.coll === "walls") {
      updateObj("walls", obj.id, { role: "outer", kind: obj.kind || "existing" });
    }
    else if (actionId === "wall-role-partition" && sel.coll === "walls") {
      updateObj("walls", obj.id, { role: "partition", kind: obj.kind || "new" });
    }
    else if (actionId === "wall-straight-h" && sel.coll === "walls") {
      // PHASE 1A-2A: через command boundary — selection исходной стены
      // сохраняется (selectAfter не передан), как и в старом коде.
      runGeometryCommand({ type: "wall.straightenHorizontal", wallId: obj.id });
    }
    else if (actionId === "wall-straight-v" && sel.coll === "walls") {
      runGeometryCommand({ type: "wall.straightenVertical", wallId: obj.id });
    }
    else if (actionId === "wall-align" && sel.coll === "walls") {
      runGeometryCommand({ type: "wall.alignToNeighbor", wallId: obj.id });
    }
    else if (actionId === "wall-merge" && sel.coll === "walls") {
      // Surviving wall id берётся из typed entityRemap, а не угадывается —
      // для этого способа вызова (merge всегда стартует от obj.id) он и так
      // всегда совпадает с obj.id, но контракт остаётся явным и корректным
      // на случай будущих caller'ов с другой семантикой выбора.
      runGeometryCommand(
        { type: "wall.merge", wallId: obj.id },
        { selectAfter: (result) => ({ coll: "walls", id: result.entityRemap.walls.survivingWallId }) },
      );
    }
    else if (actionId === "wall-break" && sel.coll === "walls") {
      const mm = ctxMenuRef.current?.mm;
      if (!mm) return;
      // PHASE 1A-2A: через command boundary — dispatcher сам гарантирует, что
      // rejected/no-op split не вызывает commitPlan (см. PHASE 0F/1A-1: ранее
      // это обеспечивалось вручную здесь же, теперь — структурно в
      // geometryCommandDispatcher.js). newWallId выбирается через typed
      // operationResult.childWallIds[1] (тот же PHASE 0F newWallId).
      runGeometryCommand(
        { type: "wall.split", wallId: obj.id, point: mm },
        {
          selectAfter: (result) => ({ coll: "walls", id: result.operationResult.childWallIds[1] }),
          warningMessage: () => "Стена разделена. Часть размеров пересекала линию разрыва и была откреплена.",
        },
      );
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
    if (tool === "wall" && draft.length > 0) {
      e.preventDefault();
      const mm = toMM(e.clientX, e.clientY);
      setCtxMenu({
        x: e.clientX,
        y: e.clientY,
        mm,
        items: [
          { id: "wall-draft-finish", label: "Завершить цепочку (Enter)" },
          { id: "wall-draft-cancel", label: "Отменить цепочку (Esc)", danger: true },
        ],
      });
      return;
    }
    const mm = toMM(e.clientX, e.clientY);
    let hit = null;
    for (const it of [...plan.items].reverse()) {
      if (mm.x >= it.x && mm.x <= it.x + it.w && mm.y >= it.y && mm.y <= it.y + it.h) {
        hit = { coll: "items", id: it.id };
        break;
      }
    }
    if (!hit) {
      for (const w of resolvePlanWalls(plan)) {
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
    if (!hit) {
      for (const z of plan.zones) {
        if (z.polygon?.length >= 3 && pointInPolygon(mm, z.polygon)) {
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
    const obj = hit.coll === "walls"
      ? resolvePlanWalls(plan).find((o) => o.id === hit.id)
      : plan[hit.coll]?.find((o) => o.id === hit.id);
    setCtxMenu({ x: e.clientX, y: e.clientY, mm, items: buildObjectMenu(obj || {}, hit.coll, { nodeIdx: selection?.nodeIdx }) });
  };

  const orthoTools = tool === "line" || tool === "wall" || tool === "measure" || tool === "structural";

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "Shift") shiftRef.current = true;
      if (e.key === "Control") { ctrlRef.current = true; setCtrlSnapFine(true); }
      if (e.key === "Alt") { altSnapRef.current = true; setAltSnapOff(true); }
      if (e.key === " " && document.activeElement === document.body) { e.preventDefault(); setSpacePan(true); }
      if (e.key === "Escape") {
        if (labelDraft) { cancelLabelDraft(); return; }
        if (tool === "wall" && draft.length > 0) {
          e.preventDefault();
          clearWallChain();
          return;
        }
        if (tool === "line" && draft.length > 0) {
          e.preventDefault();
          setDraft([]);
          setDraftSnap(null);
          setDraftAngleSnap(null);
          setTypedLength("");
          return;
        }
        if (tool === "measure" && (measureDrawRef.current || measure.length)) {
          e.preventDefault();
          measureDrawRef.current = null;
          setMeasure([]);
          setMeasureOffsetPt(null);
          setRulerSnap(null);
          return;
        }
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
        if (tool === "wall" && draft.length >= 1) {
          e.preventDefault();
          finishWallChain();
          return;
        }
        if (tool === "measure" && measureDrawRef.current?.stage === 2 && measure.length === 2 && measureOffsetPt) {
          e.preventDefault();
          commitDimension(measure[0], measure[1], measureOffsetPt);
          measureDrawRef.current = null;
          setMeasure([]);
          setMeasureOffsetPt(null);
          setRulerSnap(null);
          return;
        }
        if (draft.length >= 2) finishDraft();
      }
      if ((e.key === "Delete" || e.key === "Backspace") && document.activeElement === document.body && !typedLengthRef.current) {
        if (tool === "wall" && draft.length >= 1) {
          e.preventDefault();
          const { state } = wallDraftBackspace(wallDraftStateRef.current);
          wallDraftStateRef.current = state;
          if (state.pts.length) {
            setDraft(state.pts);
            if (!state.chainStart) wallChainStartRef.current = null;
          } else {
            clearWallChain();
          }
          return;
        }
        if (tool === "line" && draft.length >= 1) {
          e.preventDefault();
          setDraft((d) => d.slice(0, -1));
          return;
        }
        e.preventDefault();
        handleDeleteAction();
      }
      if (/^\d$/.test(e.key) && (tool === "wall" || tool === "line") && draft.length >= 1) {
        e.preventDefault();
        setTypedLength((s) => s + e.key);
      }
      if (e.key === "Backspace" && typedLengthRef.current && (tool === "wall" || tool === "line")) {
        e.preventDefault();
        setTypedLength((s) => s.slice(0, -1));
      }
      if ((e.key === "r" || e.key === "R" || e.code === "KeyR") && tool === "line") {
        e.preventDefault();
        if (selection?.coll === "lines" && selection.ids.length) {
          selection.ids.forEach((id) => {
            const ln = plan.lines.find((l) => l.id === id);
            if (!ln || (!isPipeLine(ln) && !isDuctLine(ln))) return;
            updateObj("lines", id, reverseLine({
              ...ln,
              flowDirection: ln.flowDirection === "reverse" ? "forward" : "reverse",
            }));
          });
        } else {
          setLineDraftMeta((prev) => ({
            ...prev,
            flowDirection: prev.flowDirection === "reverse" ? "forward" : "reverse",
          }));
        }
        return;
      }
      if ((e.key === "r" || e.key === "R" || e.code === "KeyR") && tool === "add" && pending) {
        e.preventDefault();
        setPendingRotationDeg((v) => (v + 90) % 360);
        setPendingSize((prev) => {
          const baseSize = prev?.w != null ? prev : (() => {
            const c = resolveCatalogKind(pending);
            return c?.w != null ? { w: c.w, h: c.h } : null;
          })();
          if (!baseSize) return prev;
          return {
            ...baseSize,
            w: baseSize.h,
            h: baseSize.w,
          };
        });
        return;
      }
      if (e.key === "f" || e.key === "F") fitView();
      if (e.ctrlKey && e.key === "z") { e.preventDefault(); undo(); }
      if (e.ctrlKey && (e.key === "y" || (e.shiftKey && e.key === "z"))) { e.preventDefault(); redo(); }
      if (modKey(e) && (e.code === "KeyC" || e.key === "c" || e.key === "с")) { e.preventDefault(); copySel(); }
      if (modKey(e) && (e.code === "KeyV" || e.key === "v" || e.key === "м")) { e.preventDefault(); pasteSel(); }
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
      if (e.key === "Control") { ctrlRef.current = false; setCtrlSnapFine(false); }
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

  // PHASE 0B: повреждённый сохранённый план — безопасный экран без canvas.
  // Редактор не открывается, автозапись и создание нового пустого плана
  // поверх повреждённых данных исключены; исходный payload не перезаписан.
  if (!standalone && plannerPlanCorrupt) {
    return (
      <div className="content">
        <Empty title="Не удалось загрузить сохранённую планировку">
          <p style={{ maxWidth: 520, margin: "0 auto 16px", lineHeight: 1.5 }}>
            Проект «{project.name}». Данные планировки повреждены или имеют
            неподдерживаемый формат. Исходные данные не перезаписаны. Для
            восстановления используйте резервную копию или обратитесь к
            администратору.
          </p>
          <Link className="btn btn-primary" to={`/project/${project.id}`}>Назад к проекту</Link>
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
      // PHASE 0G corrective: импорт — production load path, доступен UI.
      const { plan: normalized, diagnostics } = normalizePlanResult(imported);
      resetHistory(normalized);
      setRoomDetectionDiagnostic(diagnostics[0] || null);
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
      const snapshot = normalizePlan(plan);
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

  const onDblClick = (e) => {
    if (tool === "wall" && draft.length >= 1) {
      finishWallChain();
      return;
    }
    if (draft.length >= 2) finishDraft();
  };

  const onDown = (e) => {
    if (e.button === 2) return;
    if (ctrlRef.current !== !!e.ctrlKey) {
      ctrlRef.current = !!e.ctrlKey;
      setCtrlSnapFine(!!e.ctrlKey);
    }
    svgRef.current.setPointerCapture(e.pointerId);
    const mm = toMM(e.clientX, e.clientY);
    const panTool = tool === "pan" || spacePan || e.button === 1;
    const bgClick = e.target === svgRef.current || e.target.getAttribute("data-canvas-bg") === "1";

    if (panTool) {
      dragRef.current = { mode: "pan", sx: e.clientX, sy: e.clientY, px: view.panX, py: view.panY };
      return;
    }
    if (active === "spec") return;
    if (tool === "erase") {
      const hit = pickPlanHit(mm);
      if (hit) deleteHit(hit);
      return;
    }
    if (tool === "add" && pending) return addItemAt(mm);
    if (tool === "label") return beginLabelAnchor(mm);
    if (tool === "wall") {
      if (e.button !== 0) return;
      const chainFrom = draft.length >= 1 ? draft[draft.length - 1] : null;
      let from;
      if (chainFrom) {
        from = chainFrom;
        wallDraftStateRef.current = wallDraftContinueFrom(wallDraftStateRef.current, from);
      } else {
        const computed = computeWallSnap(mm, null);
        from = computed.pt;
        wallChainStartRef.current = from;
        wallDraftStateRef.current = wallDraftStart(createWallDraftState(), from);
        setDraftSnap(computed.snap);
      }
      wallDrawRef.current = { from };
      setDraft((d) => (chainFrom ? d : [from, from]));
      try { svgRef.current.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }
    if (tool === "line") {
      const last = draft[draft.length - 1];
      const { pt, snap, angleSnap, guides: snapGuides = [] } = computeDraftPt(mm, last);
      setDraftAngleSnap(angleSnap);
      setDraftSnap(snap);
      setGuides(snapGuides);
      setDraft((d) => [...d, pt]);
      return;
    }
    if (tool === "measure") {
      if (e.button !== 0) return;
      const st = measureDrawRef.current;
      if (!st) {
        const { pt, snap, guides: snapGuides = [] } = computeRulerPt(mm);
        measureDrawRef.current = { stage: 1, p1: pt };
        setMeasure([pt, pt]);
        setMeasureOffsetPt(null);
        setRulerSnap(snap);
        setGuides(snapGuides);
        return;
      }
      if (st.stage === 1) {
        const { pt, snap, guides: snapGuides = [] } = computeRulerPt(mm, st.p1);
        if (Math.hypot(pt.x - st.p1.x, pt.y - st.p1.y) < 20) return;
        measureDrawRef.current = { stage: 2, p1: st.p1, p2: pt };
        setMeasure([st.p1, pt]);
        setMeasureOffsetPt(pt);
        setRulerSnap(snap);
        setGuides(snapGuides);
        return;
      }
      if (st.stage === 2) {
        const { pt, snap, guides: snapGuides = [] } = computeRulerPt(mm);
        commitDimension(st.p1, st.p2, pt);
        measureDrawRef.current = null;
        setMeasure([]);
        setMeasureOffsetPt(null);
        setRulerSnap(snap);
        setGuides(snapGuides);
      }
      return;
    }
    if (tool === "structural") {
      if (e.button !== 0) return;
      if (structuralKind === "column") {
        const computed = computeDraftPt(mm, null);
        commitStructuralColumn(computed.pt);
        return;
      }
      const chainFrom = draft.length === 1 ? draft[0] : null;
      let from;
      if (chainFrom) from = chainFrom;
      else {
        const computed = computeDraftPt(mm, null);
        from = computed.pt;
      }
      structuralDrawRef.current = { from };
      setDraft([from, from]);
      try { svgRef.current.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }
    if (tool === "select" && e.button === 0) {
      const wallHit = pickWallBodyHit(mm, resolvePlanWalls(plan), plan.room);
      if (wallHit) { selectWall(e, wallHit.wall); return; }
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
    if (ctrlRef.current !== !!e.ctrlKey) {
      ctrlRef.current = !!e.ctrlKey;
      setCtrlSnapFine(!!e.ctrlKey);
    }
    const raw = toMM(e.clientX, e.clientY);
    let mm = raw;
    if (wallDrawRef.current && tool === "wall") {
      const { from } = wallDrawRef.current;
      const { pt, snap, angleSnap, fromAdjust } = computeWallSnap(raw, from);
      const start = fromAdjust || from;
      if (fromAdjust) wallDrawRef.current = { from: start };
      setDraftSnap(snap);
      setDraftAngleSnap(angleSnap);
      const base = wallDraftStateRef.current.pts.length
        ? wallDraftStateRef.current.pts
        : [start];
      setDraft([...base.slice(0, -1), base[base.length - 1] || start, pt]);
      mm = pt;
    } else if (structuralDrawRef.current && tool === "structural") {
      const { from } = structuralDrawRef.current;
      const { pt, snap, angleSnap } = computeDraftPt(raw, from);
      setDraftSnap(snap);
      setDraftAngleSnap(angleSnap);
      setDraft([from, pt]);
      mm = pt;
    } else if (measureDrawRef.current && tool === "measure") {
      if (measureDrawRef.current.stage === 1) {
        const { p1 } = measureDrawRef.current;
        const { pt, snap, guides: snapGuides = [] } = computeRulerPt(raw, p1);
        setMeasure([p1, pt]);
        setRulerSnap(snap);
        setGuides(snapGuides);
        mm = pt;
      } else if (measureDrawRef.current.stage === 2) {
        const { pt, snap, guides: snapGuides = [] } = computeRulerPt(raw);
        setMeasureOffsetPt(pt);
        setRulerSnap(snap);
        setGuides(snapGuides);
        mm = pt;
      }
    } else if (orthoTools && draft.length > 0) {
      const { pt, snap, angleSnap, guides: snapGuides = [] } = computeDraftPt(raw, draft[draft.length - 1]);
      setDraftSnap(snap);
      setDraftAngleSnap(angleSnap);
      if (tool === "line") setGuides(snapGuides);
      mm = pt;
    } else {
      setDraftSnap(null);
      setDraftAngleSnap(null);
      if (tool === "line" || tool === "measure") setGuides([]);
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
        replacePlan((p) => syncEngineeringPlan({
          ...p,
          items: p.items.map((it) => (
            it.id === d.id
              ? attachItemZoneFields(p, {
                ...it,
                x,
                y,
                angle: placed.angle || it.angle || 0,
                wallId: placed.wallId,
                wallSeg: placed.wallSeg,
              })
              : it
          )),
        }));
        setGuides([]);
      } else {
        const s = snapObj(d.coll, obj, x, y);
        x = s.x; y = s.y;
        setGuides(s.guides);
        if (d.coll === "items" && !obj.wall && itemOverlapsAnyWall({ ...obj, x, y }, resolvePlanWalls(plan))) return;
        if (d.coll === "items" && !obj.wall && itemOverlapsBlocked({ ...obj, x, y }, plan.items, { excludeId: d.id }).blocked) return;
        if (d.coll === "items") {
          const ldx = x - obj.x;
          const ldy = y - obj.y;
          replacePlan((p) => syncEngineeringPlan({
            ...p,
            items: p.items.map((it) => (
              it.id === d.id ? attachItemZoneFields(p, { ...it, x, y }) : it
            )),
            labels: p.labels.map((lb) => {
              if (lb.pinned || lb.targetId !== d.id) return lb;
              if (lb.anchorRelX != null) return lb;
              return { ...lb, x: (lb.x || 0) + ldx, y: (lb.y || 0) + ldy };
            }),
          }));
        } else if (d.coll === "labels") {
          const tgt = obj.targetId ? plan.items.find((i) => i.id === obj.targetId) : null;
          const anchor = resolveLabelAnchor(obj, tgt);
          const patch = { x, y, pinned: true };
          if (anchor) {
            patch.offsetX = x - anchor.x;
            patch.offsetY = y - anchor.y;
          }
          updateObj("labels", obj.id, patch);
        } else {
          updateObj(d.coll, d.id, { x, y });
        }
      }
    } else if (d.mode === "ruler-move") {
      const dx = mm.x - d.dx;
      const dy = mm.y - d.dy;
      updateRuler(d.id, {
        a: { x: d.ox + dx, y: d.oy + dy },
        b: { x: d.ox2 + dx, y: d.oy2 + dy },
      });
    } else if (d.mode === "ruler-a" || d.mode === "ruler-b") {
      const { pt } = computeRulerPt(mm);
      updateRuler(d.id, d.mode === "ruler-a" ? { a: pt } : { b: pt });
    } else if (d.mode === "move-item-label") {
      const obj = plan.items.find((o) => o.id === d.id);
      if (!obj) return;
      let dx = mm.x - d.dx;
      let dy = mm.y - d.dy;
      if (dragShiftOn(shiftRef.current, altSnapRef.current)) {
        ({ dx, dy } = constrainAxisDelta(dx, dy, true));
      }
      const x = d.ox + dx;
      const y = d.oy + dy;
      const anchor = itemAnchor(obj);
      updateObj("items", d.id, {
        labelPinned: true,
        labelHidden: false,
        labelOffsetX: x - anchor.x,
        labelOffsetY: y - anchor.y,
      });
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
        commitPlan((p) => p);
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
          if (!lb.pinned && lb.targetId && ids.includes(lb.targetId) && lb.anchorRelX == null) {
            labelOrigins[lb.id] = { x: lb.x || 0, y: lb.y || 0 };
          }
        });
        dragRef.current = {
          mode: "move-items",
          ids,
          origins,
          labelOrigins,
          dx: d.mm.x,
          dy: d.mm.y,
        };
      }
      replacePlan((p) => {
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
        return syncEngineeringPlan({
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
          if (itemHitsAnyStructural({ ...it, x, y }, p.structurals)) return it;
          if (!it.wall && itemOverlapsAnyWall({ ...it, x, y }, resolvePlanWalls(p))) return it;
          if (!it.wall && itemOverlapsBlocked({ ...it, x, y }, p.items, { excludeIds: ids }).blocked) return it;
          if (it.wall) {
            const placed = attachWall({ ...it, kind: it.kind }, x, y);
            if (!placed || placed.error) return it;
            return { ...it, x: placed.x, y: placed.y, angle: placed.angle || it.angle || 0, wallId: placed.wallId };
          }
          if (snapDx || snapDy) {
            return attachItemZoneFields(p, { ...it, x, y });
          }
          return attachItemZoneFields(p, { ...it, x, y });
        }),
        });
      });
    } else if (d.mode === "marquee") {
      setMarquee({ x1: d.x1, y1: d.y1, x2: mm.x, y2: mm.y });
    } else if (d.mode === "resize") {
      const obj = plan[d.coll].find((o) => o.id === d.id);
      if (!obj) return;
      if (d.coll === "zones" && (obj.locked || obj.auto)) return;
      if (obj.locked) return;
      const axis = d.axis || "corner";
      const nextPatch = axis === "w"
        ? { w: Math.max(50, sn(mm.x - obj.x)) }
        : axis === "h"
          ? { h: Math.max(50, sn(mm.y - obj.y)) }
          : { w: Math.max(50, sn(mm.x - obj.x)), h: Math.max(50, sn(mm.y - obj.y)) };
      if (d.coll === "items") {
        replacePlan((p) => syncEngineeringPlan({
          ...p,
          items: p.items.map((it) => (
            it.id === d.id ? attachItemZoneFields(p, { ...it, ...nextPatch }) : it
          )),
        }));
        return;
      }
      if (axis === "w") {
        updateObj(d.coll, d.id, { w: Math.max(50, sn(mm.x - obj.x)) });
      } else if (axis === "h") {
        updateObj(d.coll, d.id, { h: Math.max(50, sn(mm.y - obj.y)) });
      } else {
        updateObj(d.coll, d.id, { w: Math.max(50, sn(mm.x - obj.x)), h: Math.max(50, sn(mm.y - obj.y)) });
      }
    } else if (d.mode === "move-wall-seg-pending") {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) {
        dragRef.current = { ...d, mode: "move-wall-seg" };
      }
    } else if (d.mode === "move-wall-seg") {
      const wall = resolvePlanWalls(plan).find((w) => w.id === d.id);
      if (!wall || wall.pts.length !== 2 || !d.origPts?.length) return;
      let dx = mm.x - d.dx;
      let dy = mm.y - d.dy;
      if (dragShiftOn(shiftRef.current, altSnapRef.current)) {
        ({ dx, dy } = constrainAxisDelta(dx, dy, true));
      }
      const a0 = d.origPts[0];
      const b0 = d.origPts[1];
      const segLen = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1;
      const nx = -(b0.y - a0.y) / segLen;
      const ny = (b0.x - a0.x) / segLen;
      const move = dx * nx + dy * ny;
      const newA = { x: fineMm(a0.x + nx * move), y: fineMm(a0.y + ny * move) };
      const newB = { x: fineMm(b0.x + nx * move), y: fineMm(b0.y + ny * move) };
      // PHASE 1A-2B1: финальный target (для commit на pointer up) считается
      // от origPts + delta каждый кадр, а не накапливается — тот же newA/newB,
      // что уже применяется в preview ниже, просто сохраняем последнее
      // значение в dragRef для onUp.
      dragRef.current = { ...d, finalA: newA, finalB: newB };
      replacePlan((p) => {
        const next = applyNetworkWallSegMove(p, d.id, newA, newB);
        const resolved = resolvePlanWalls(next);
        return syncAutoZones({
          ...next,
          items: refreshWallMountedItems(p.items, resolved, p.room, d.id),
        });
      });
    } else if (d.mode === "node") {
      if (d.coll === "walls") {
        const wall = resolvePlanWalls(plan).find((w) => w.id === d.id);
        let pt = { x: mm.x, y: mm.y };
        if (wall?.pts?.length >= 2) {
          const anchorIdx = d.idx > 0 ? d.idx - 1 : 1;
          const anchor = wall.pts[anchorIdx];
          pt = constrainAxisPoint(anchor, pt, dragShiftOn(shiftRef.current, altSnapRef.current));
        }
        const resolved = resolvePlanWalls(plan);
        const snapped = snapWallPoint(pt, resolved, plan.room, view.zoom, snapOn && display.snapWalls !== false && !altSnapRef.current, snapStep);
        // PHASE 1A-2B1: последняя абсолютная target-точка — для commit на
        // pointer up (см. onUp), preview ниже не меняется.
        dragRef.current = { ...d, finalPoint: { x: snapped.x, y: snapped.y } };
        replacePlan((p) => {
          const next = applyNetworkNodeAtWall(p, d.id, d.idx, { x: snapped.x, y: snapped.y });
          const rw = resolvePlanWalls(next);
          return syncAutoZones({
            ...next,
            items: refreshWallMountedItems(p.items, rw, p.room),
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
            const patch = { pts, points: pts };
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
          return syncEngineeringPlan({ ...p, lines });
        });
      }
    }
  };

  const onUp = (e) => {
    if (wallDrawRef.current && tool === "wall") {
      const { from } = wallDrawRef.current;
      wallDrawRef.current = null;
      const raw = toMM(e.clientX, e.clientY);
      const { pt, snap, fromAdjust } = computeWallSnap(raw, from);
      const start = fromAdjust || from;
      if (snap?.kind === "close" && wallChainStartRef.current) {
        const end = { x: wallChainStartRef.current.x, y: wallChainStartRef.current.y };
        addWallDraftSegment(start, end, fromAdjust);
        wallDraftStateRef.current = { ...wallDraftStateRef.current, closedLoop: true };
        finishWallChain();
      } else if (Math.hypot(pt.x - start.x, pt.y - start.y) >= 50) {
        addWallDraftSegment(start, pt, fromAdjust);
        setDraftSnap(snap);
      } else if (
        wallChainStartRef.current &&
        Math.hypot(from.x - wallChainStartRef.current.x, from.y - wallChainStartRef.current.y) < 5
      ) {
        clearWallChain();
      }
    }
    if (structuralDrawRef.current && tool === "structural") {
      const { from } = structuralDrawRef.current;
      structuralDrawRef.current = null;
      const raw = toMM(e.clientX, e.clientY);
      const { pt } = computeDraftPt(raw, from);
      if (Math.hypot(pt.x - from.x, pt.y - from.y) >= 50) {
        commitStructuralSegment(from, pt);
        setDraft([pt]);
      } else {
        setDraft([]);
      }
    }
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
    } else if (d?.mode === "move-wall-seg" && d.basePlan && d.finalA && d.finalB) {
      // PHASE 1A-2B1: финальный commit — не commitFrom(preview-plan), а
      // geometry command, пересчитанный от committed d.basePlan + final
      // target. Preview мог накопить промежуточные side-effects
      // (refreshWallMountedItems/syncAutoZones на каждый кадр) — commit
      // должен считать заново, а не наследовать их. Restore синхронный:
      // getCurrentPlan() внутри dispatcher сразу увидит basePlan.
      //
      // ВАЖНО: restore здесь делается через setPlan, а не replacePlan.
      // HistoryModel.replace() выставляет skipNext=true и не сбрасывает его;
      // preview (см. onMove) уже вызвал replace() как минимум один раз, так
      // что skipNext уже true к этому моменту. Если восстановить basePlan
      // ЕЩЁ одним replace(), skipNext останется true, и следующий
      // commitPlan()->HistoryModel.mutate() решит, что чекпоинт уже сделан,
      // и молча пропустит его — ноль checkpoint вместо одного (проверено
      // тестом, см. tests/plannerGeometryDragDispatcher.test.js). setPlan
      // (mutate) для restore, наоборот, УЖЕ checkpoint-free при skipNext=true
      // (унаследованном от preview) и корректно сбрасывает флаг, так что
      // последующий commitPlan честно создаёт один checkpoint.
      if (getCurrentPlan() !== d.basePlan) setPlan(() => d.basePlan);
      runGeometryCommand({ type: "wall.moveSegment", wallId: d.id, a: d.finalA, b: d.finalB });
    } else if (d?.mode === "node" && d.coll === "walls" && d.basePlan && d.finalPoint) {
      if (getCurrentPlan() !== d.basePlan) setPlan(() => d.basePlan);
      runGeometryCommand({ type: "node.move", wallId: d.id, nodeIdx: d.idx, point: d.finalPoint });
    }
    dragRef.current = null;
    rackSnapStickyRef.current = { x: null, y: null, atX: null, atY: null };
    objectSnapStickyRef.current = { x: null, y: null, atX: null, atY: null };
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
  const resolvedWalls = useMemo(() => resolvePlanWalls(plan), [plan.walls, plan.nodes]);
  const weldedWalls = useMemo(() => weldWallNodes(resolvedWalls), [resolvedWalls]);
  const runtimeDimensionData = useMemo(
    () => resolvePlanDimensions(plan, { dimensionDisplayMode }),
    [plan.walls, plan.nodes, plan.items, plan.zones, plan.room, plan.dimensions, dimensionDisplayMode],
  );
  const runtimeRoomWarnings = useMemo(
    () => validateRooms(plan, plan.rooms || []),
    [plan.rooms, plan.items, plan.links, plan.walls],
  );
  const runtimeDimensions = runtimeDimensionData.dimensions;
  const useWallChainDims = planHasDrawnWalls(weldedWalls);
  const sel = selection?.ids?.length === 1 ? { coll: selection.coll, id: selection.ids[0] } : null;
  const findSelObject = (coll, id) => {
    if (coll === "walls") return resolvePlanWalls(plan).find((o) => o.id === id);
    if (coll === "dimensions") return runtimeDimensions.find((o) => o.id === id);
    if (coll === "item-label") return plan.items.find((o) => o.id === id);
    return plan[coll]?.find((o) => o.id === id);
  };
  const selObj = sel ? findSelObject(sel.coll, sel.id) : null;
  const multiBounds = selection?.coll === "items" && selection.ids.length > 1
    ? boundsOfItems(plan.items, selection.ids)
    : null;

  const startMoveItems = (ids, mm) => {
    const movable = ids.filter((id) => !plan.items.find((i) => i.id === id)?.locked);
    if (!movable.length) return;
    commitPlan((p) => p);
    const origins = {};
    const labelOrigins = {};
    movable.forEach((id) => {
      const o = plan.items.find((i) => i.id === id);
      if (o) origins[id] = { x: o.x, y: o.y };
    });
    plan.labels.forEach((lb) => {
      if (!lb.pinned && lb.targetId && movable.includes(lb.targetId) && lb.anchorRelX == null) {
        labelOrigins[lb.id] = { x: lb.x || 0, y: lb.y || 0 };
      }
    });
    dragRef.current = {
      mode: "move-items",
      ids: movable,
      origins,
      labelOrigins,
      dx: mm.x,
      dy: mm.y,
    };
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
    if (coll === "items") commitPlan((p) => p);
    setSel({ coll, id: obj.id });
    dragRef.current = {
      mode: "move",
      coll,
      id: obj.id,
      ox,
      oy,
      dx: mm.x,
      dy: mm.y,
    };
  };

  const startMoveItemLabel = (e, it) => {
    if (tool === "erase") {
      e.stopPropagation();
      deleteHits("item-label", [it.id]);
      return;
    }
    e.stopPropagation();
    if (tool !== "select" && tool !== "label") return;
    svgRef.current.setPointerCapture(e.pointerId);
    const mm = toMM(e.clientX, e.clientY);
    let place = resolveItemLabelPlacement(it, plan.room);
    if (!place) {
      place = autoItemLabelPlacement(it, plan.room);
      const pinned = pinItemLabelFromAuto(it, plan.room);
      updateObj("items", it.id, { ...pinned, labelHidden: false });
    } else if (!it.labelPinned) {
      updateObj("items", it.id, pinItemLabelFromAuto(it, plan.room));
    }
    setSel({ coll: "item-label", id: it.id });
    dragRef.current = {
      mode: "move-item-label",
      id: it.id,
      ox: place.x,
      oy: place.y,
      dx: mm.x,
      dy: mm.y,
    };
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
    if (coll === "items") commitPlan((p) => p);
    setSel({ coll, id: obj.id });
    dragRef.current = {
      mode: "resize",
      coll,
      id: obj.id,
      axis,
    };
  };
  const startWallMidNode = (e, wall) => {
    if (!wall?.pts || wall.pts.length !== 2) return;
    e.stopPropagation();
    e.preventDefault();
    if (tool === "erase") {
      deleteHit({ coll: "walls", id: wall.id });
      return;
    }
    const mm = toMM(e.clientX, e.clientY);
    setSelection({ coll: "walls", ids: [wall.id], nodeIdx: -1 });
    dragRef.current = {
      mode: "move-wall-seg-pending",
      id: wall.id,
      origPts: wall.pts.map((p) => ({ x: p.x, y: p.y })),
      basePlan: plan,
      sx: e.clientX,
      sy: e.clientY,
      dx: mm.x,
      dy: mm.y,
    };
    setHoverWallNode({ wallId: wall.id, idx: -1 });
    try { svgRef.current?.setPointerCapture(e.pointerId); } catch (_) {}
  };

  const wallChainIdsFor = (wall, walls) => {
    const chainId = wall.chainId || wall.id;
    return walls.filter((w) => (w.chainId || w.id) === chainId).map((w) => w.id);
  };

  const wallContourIdsFor = (wall, walls, thr = 10) => {
    const map = new Map((walls || []).map((w) => [w.id, w]));
    const queue = [wall.id];
    const seen = new Set(queue);
    const endpoints = (w) => (w?.pts?.length >= 2 ? [w.pts[0], w.pts[w.pts.length - 1]] : []);

    while (queue.length) {
      const id = queue.shift();
      const cur = map.get(id);
      if (!cur) continue;
      const curEnds = endpoints(cur);
      for (const w of walls) {
        if (seen.has(w.id)) continue;
        const ends = endpoints(w);
        const touches = curEnds.some((a) => ends.some((b) => Math.hypot(a.x - b.x, a.y - b.y) <= thr));
        if (touches) {
          seen.add(w.id);
          queue.push(w.id);
        }
      }
    }
    return [...seen];
  };

  const selectWall = (e, wall) => {
    if (tool === "erase") {
      deleteHit({ coll: "walls", id: wall.id });
      return;
    }
    e.stopPropagation();
    const mm = toMM(e.clientX, e.clientY);
    const walls = resolvePlanWalls(plan);
    // PHASE 0E: screen-space резолвер (узел ≈10px, тело стены +8px), вместо
    // прежних 320px/zoom с безусловным приоритетом узла.
    const hit = hitTestWallInteraction({ wall, worldPoint: mm, zoom: view.zoom, allWalls: walls, room: plan.room });
    if (e.detail >= 2) {
      setSelection({ coll: "walls", ids: wallContourIdsFor(wall, walls) });
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setSelection({ coll: "walls", ids: wallChainIdsFor(wall, walls) });
      return;
    }
    setSel({
      coll: "walls",
      id: wall.id,
      nodeIdx: hit.kind === "node" ? hit.idx : (hit.kind === "segment" ? -1 : undefined),
    });
  };

  const startNode = (e, coll, oid, idx) => {
    e.stopPropagation();
    if (tool === "erase") {
      deleteHit({ coll, id: oid });
      return;
    }
    svgRef.current.setPointerCapture(e.pointerId);
    setSelection({ coll, ids: [oid], nodeIdx: idx });
    dragRef.current = { mode: "node", coll, id: oid, idx, basePlan: plan };
    if (coll === "walls") setHoverWallNode({ wallId: oid, idx });
  };

  const onItemDown = (e, it) => {
    if (tool === "erase") {
      e.stopPropagation();
      deleteHit({ coll: "items", id: it.id });
      return;
    }
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
    if (tool === "label") { e.stopPropagation(); beginLabelAnchor(mm, it.id); return; }

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
        REQUIRED_FARM_SHEET_IDS.map((sid) => {
          const s = sheetById(sid);
          return { id: s.id, sheet: s.pdfSheetName || s.name };
        }),
        { projectName: planTitle, projectId: planMetaId, version: "1" },
        mode,
        {
          pdfGridInstall: display.pdfGridInstall,
          pdfGridTechnical: display.pdfGridTechnical,
          pdfGridMajorOnly: display.pdfGridMajorOnly,
          plan,
          warnings: warnList,
        },
      );
    } catch (e) { alert("Не удалось собрать PDF: " + e.message); }
    setBusy(false);
  };

  const syncSpec = async () => {
    // PHASE 0B: не запускать planner → specification sync при повреждённом плане
    // (иначе projectUpdate({ plan }) затрёт исходные данные).
    if (plannerPlanCorrupt) return;
    setBusy(true);
    try {
      const materials = state.materialsLoaded ? state.materials : await actions.ensureMaterials();
      const modules = state.modulesLoaded ? state.modules : await actions.ensureModules();
      const res = createPlannerSpecItems({
        plan,
        materials,
        modules,
        existingItems: standalone ? (draftMeta?.specItems || []) : (project.items || []),
      });
      if (standalone) {
        const nextDraft = saveStandalonePlan({
          ...draftMeta,
          specItems: res.items,
          specSummary: {
            objects: res.objectCount,
            lines: res.lineCount,
            links: res.linkCount,
            kitObjects: res.kitCount,
            generated: res.generatedCount,
          },
          plannerSyncAt: new Date().toISOString(),
        });
        setDraftMeta(nextDraft);
        alert(`Спецификация сформирована из черновика.\nПозиции: ${res.generatedCount}\nКомплекты: ${res.kitCount || 0}\nОбъекты: ${res.objectCount}\nТрассы: ${res.lineCount}\n\nПривяжите черновик к проекту, чтобы записать в таблицу.`);
      } else {
        await actions.projectUpdate(project.id, { items: res.items, plan, plannerSyncAt: new Date().toISOString() });
        alert(`Спецификация обновлена из плана.\nПозиции: ${res.generatedCount}\nКомплекты: ${res.kitCount || 0}\nОбъекты: ${res.objectCount}\nТрассы: ${res.lineCount}\nСвязи: ${res.linkCount || 0}`);
      }
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
    items = items.filter((it) => objectVisibleOnSheet(it, activeSheetId));
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

  useEffect(() => {
    const nextWarn = runtimeDimensionData.validationWarnings || [];
    setPlan((p) => {
      const prevAll = p.validationWarnings || [];
      const prevDims = prevAll.filter((w) => w.source === "dimensions");
      const same = prevDims.length === nextWarn.length
        && prevDims.every((w, i) => w.id === nextWarn[i].id && w.text === nextWarn[i].text);
      if (same) return p;
      const withoutDims = prevAll.filter((w) => w.source !== "dimensions");
      return { ...p, validationWarnings: [...withoutDims, ...nextWarn] };
    });
  }, [runtimeDimensionData.validationWarnings, setPlan]);

  useEffect(() => {
    const nextWarn = runtimeRoomWarnings || [];
    setPlan((p) => {
      const prevAll = p.validationWarnings || [];
      const prevRooms = prevAll.filter((w) => w.source === "rooms");
      const same = prevRooms.length === nextWarn.length
        && prevRooms.every((w, i) => w.id === nextWarn[i].id && (w.message || w.text) === (nextWarn[i].message || nextWarn[i].text));
      if (same) return p;
      const withoutRooms = prevAll.filter((w) => w.source !== "rooms");
      return { ...p, validationWarnings: [...withoutRooms, ...nextWarn] };
    });
  }, [runtimeRoomWarnings, setPlan]);

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
  const partitionWalls = wallsForLayer(weldedWalls, "partitions");
  const roomWalls = wallsForLayer(weldedWalls, "room");

  const draftCursor = orthoTools && draft.length > 0 ? cursor : null;

  const activeWallMaterial = useMemo(
    () => wallMaterialForTool(activeToolId).id,
    [activeToolId],
  );

  const wallDraftFrom = draft.length > 0 ? draft[draft.length - 1] : null;

  const wallDraftGuides = useMemo(() => {
    if (tool !== "wall" || !cursor || display.snapGuides === false || altSnapRef.current) return [];
    if (draftSnap?.guides?.length) {
      const projected = draftSnap.guides
        .filter((g) => g.type === "V" || g.type === "H")
        .map((g) => ({ ...g }));
      if (projected.length) return projected;
    }
    const from = wallDraftFrom || (draft.length === 1 ? draft[0] : null);
    if (!from && !wallDraftFrom) return [];
    return alignmentGuides(plan.nodes, resolvedWalls, cursor, plan.room, wallDraftFrom || from);
  }, [tool, cursor, draft, wallDraftFrom, plan.nodes, resolvedWalls, plan.room, display.snapGuides, draftSnap]);

  const wallDraftArea = useMemo(() => {
    if (tool !== "wall" || draftSnap?.kind !== "close") return null;
    const start = draft[0] || wallChainStartRef.current;
    if (!start || !cursor) return null;
    const pts = draft.length >= 2 ? [...draft, cursor] : [start, draft[0] || cursor, cursor];
    return draftChainArea(pts);
  }, [tool, draft, cursor, draftSnap]);

  const wallDraftNodeAngles = useMemo(() => {
    if (tool !== "wall" || !cursor || !wallDraftFrom) return [];
    return angleAt(wallDraftFrom, resolvedWalls);
  }, [tool, cursor, wallDraftFrom, resolvedWalls]);

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

  const itemProps = (it, lid, extra = {}) => (
    <ItemEl
      key={extra.key || it.id}
      it={it}
      k={k}
      selected={selection?.coll === "items" && selection.ids.includes(it.id)}
      hovered={hoverHit?.coll === "items" && hoverHit.id === it.id}
      showDims={showDimsFor(lid)}
      fmtU={fmtU}
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
      labelSelected={selection?.coll === "item-label" && selection.ids.includes(it.id)}
      onLabelDown={startMoveItemLabel}
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
    if (w.targetType === "room" && w.targetId) {
      const room = (plan.rooms || []).find((r) => r.id === w.targetId);
      const zone = (plan.zones || []).find((z) => z.id === w.targetId);
      const poly = room?.polygon || zone?.polygon;
      if (poly?.length) {
        const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
        const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
        setSel({ coll: "zones", id: w.targetId });
        centerOnMm(cx, cy, 0.12);
        return;
      }
    }
    if (w.objectIds?.[0]) {
      const id = w.objectIds[0];
      const it = plan.items.find((i) => i.id === id);
      if (!it) return;
      handlePickPlanItem(id);
      centerOnMm(it.x + it.w / 2, it.y + it.h / 2);
      return;
    }
    if (w.wallIds?.[0]) {
      const wall = resolvePlanWalls(plan).find((x) => x.id === w.wallIds[0]);
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

  // PHASE 0D — ручной запуск проверки целостности (без autosave/backend/mutation).
  // PHASE 0G: сливает session-only room detection diagnostic в тот же result.
  const runPlanCheck = () => {
    setDiagnosticsChecking(true);
    const result = validatePlanIntegrity(plan);
    const merged = mergeDiagnosticsResult(result, roomDetectionDiagnostic ? [roomDetectionDiagnostic] : []);
    setPlanDiagnostics({ result: merged, planRef: plan });
    setDiagnosticFilters({ error: true, warning: true, info: true });
    setDiagnosticsChecking(false);
    setDiagnosticsOpen(true);
  };
  const toggleDiagnosticFilter = (sev) => {
    if (sev === "all") {
      setDiagnosticFilters({ error: true, warning: true, info: true });
      return;
    }
    setDiagnosticFilters((f) => ({ ...f, [sev]: !f[sev] }));
  };
  const focusDiagnostic = (diag) => {
    const target = getDiagnosticFocusTarget(plan, diag);
    if (target.selection) setSel(target.selection);
    if (target.canFocus && target.point) {
      centerOnMm(target.point.x, target.point.y, 0.12);
      return { ok: true };
    }
    return {
      ok: false,
      message: target.selection
        ? "Объект нельзя показать на схеме: его геометрия повреждена"
        : "Объект не найден на плане",
    };
  };
  const diagnosticsStale = isDiagnosticsStale(planDiagnostics?.planRef, plan);

  const cursorStyle = spacePan || tool === "pan" ? "grab" : tool === "wall" || tool === "structural" ? "crosshair" : tool === "add" || tool === "label" ? "copy" : tool === "link" ? "crosshair" : tool === "erase" ? "not-allowed" : "default";
  const drawerTitle = activeCategoryId
    ? (categoryById(activeCategoryId)?.label || layerById(active).name)
    : layerById(active).name;
  const hasSelection = !!(selection?.ids?.length);
  const showProperties = hasSelection || pinnedProperties || warningsPanelOpen;

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
      {tool === "erase" && (
        <span className="planner-coords__sel"> · режим удаления — клик по объекту · Esc — выход</span>
      )}
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
          ) : sel.coll === "item-label" ? (
            <>подпись · {buildItemLabelLines(selObj, plan)[0] || "—"}</>
          ) : sel.coll === "dimensions" ? (
            <>размер · {selObj.labelOverride || fmtU(Math.hypot((selObj.p2?.x || 0) - (selObj.p1?.x || 0), (selObj.p2?.y || 0) - (selObj.p1?.y || 0)))}</>
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
      {tool === "select" && (
        <span className="planner-coords__hint">
          ЛКМ — панорама · Shift+ЛКМ — рамка · Shift+drag — по оси
        </span>
      )}
      {tool === "wall" && (
        <span className="planner-coords__hint">
          Зажать и тянуть — стена · замкнуть на стартовый узел · Esc — выход
        </span>
      )}
      {tool === "structural" && structuralKind && (
        <span className="planner-coords__hint">
          {STRUCTURAL_KINDS[structuralKind]?.label}
          {structuralKind === "column" ? " · клик — поставить" : " · тянуть — длина"}
          {" · ширина "}
          <input
            type="number"
            min={50}
            step={10}
            value={structuralWidth}
            onChange={(e) => setStructuralWidth(Math.max(50, +e.target.value || STRUCTURAL_KINDS[structuralKind]?.defaultWidth || 200))}
            style={{ width: 64, marginLeft: 4, padding: "2px 6px", borderRadius: 4, border: "1px solid #d9e0dc" }}
          />
          {" мм"}
        </span>
      )}
      {tool === "measure" && (
        <span className="planner-coords__hint">
          1-й клик — точка A · 2-й — точка B · 3-й — отступ · Enter/Esc — завершить/отмена
        </span>
      )}
      {tool === "add" && pending && (
        <span className="planner-coords__hint">
          Клик — поставить{isRackKind(pending) ? " · Shift — несколько подряд" : ""}
          {" · Ctrl+C / Ctrl+V — копировать"}
        </span>
      )}
      {linkFrom && (
        <span style={{ marginLeft: 10, color: "#1f6f8b" }}>Связь: выберите второй объект</span>
      )}
      {measure.length === 2 && (
        <span style={{ marginLeft: 10, color: "#e0312a" }}>
          Размер: {fmtU(Math.round(Math.hypot(measure[1].x - measure[0].x, measure[1].y - measure[0].y)))}
          {rulerSnap?.angleSnap?.isSnapped ? ` · ${rulerSnap.angleSnap.snappedAngle}°` : ""}
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
          onCheckPlan: runPlanCheck,
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
              key={`presets-${materialPresetsRev}`}
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
              onSync={syncSpec}
              onSyncZones={runAutoZonesSync}
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
                onSync={syncSpec}
                onSyncZones={runAutoZonesSync}
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
          onUnitChange: (id) => patchDisplay({ coordUnit: id }),
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
          onDelete: handleDeleteAction,
          eraseMode: tool === "erase",
          onCopy: copySel,
          onGroup: groupSelection,
          onMeasure: () => handleToolPick(resolveTool("measure")),
          onLabel: () => handleToolPick(resolveTool("label")),
          onComment: () => handleToolPick(resolveTool("comment")),
          onExportPdf: () => exportPDF("full"),
          onOpenVisualSettings: () => setVisualSettingsOpen(true),
          onOpenMaterialPresets: () => setMaterialPresetsOpen(true),
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
          <PlannerErrorBoundary resetKey={selection?.ids?.[0] || ""}>
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
            onSync={syncSpec}
            specSummary={specSummary}
            allWarnings={warnList}
            onFocusWarning={focusPlanWarning}
            onClose={closePropertiesPanel}
            onSelectLink={handleSelectLink}
            />
          </PlannerErrorBoundary>
        )}
        canvas={(
          <svg
            ref={svgRef}
            className="plan-svg"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onWheel={onWheel}
            onDoubleClick={onDblClick}
            onContextMenu={onContextMenu}
            style={{ cursor: cursorStyle }}
          >
            <rect width="100%" height="100%" fill="#f7f8f6" data-canvas-bg="1" />
            <PlannerWallDefs display={canvasDisplay} />
            <PlannerLayerDefs />
            <PlanGridScreen view={view} width={svgSize.w} height={svgSize.h} display={canvasDisplay} />
            <PlanAxesScreen view={view} width={svgSize.w} height={svgSize.h} display={canvasDisplay} />
            <g data-main transform={`translate(${view.panX},${view.panY}) scale(${z})`}>
              <SheetBackdrop
                room={plan.room}
                k={k}
                showBoundary={!useWallChainDims && (plan.room.showBoundary || !!plan.room.backdrop?.dataUrl)}
              />
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
                  <WallBodyHitAreas
                    key={`wh-${w.id}`}
                    wall={w}
                    allWalls={weldedWalls}
                    room={plan.room}
                    editable={tool === "select" || tool === "wall"}
                    eraseMode={tool === "erase"}
                    onDown={(e) => selectWall(e, w)}
                  />
                ))}
                {roomWalls.map((w) => (
                  <WallEl
                    key={w.id}
                    wall={w}
                    k={k}
                    editable={active === "room" && (tool === "select" || tool === "wall")}
                    eraseMode={tool === "erase"}
                    selected={selection?.coll === "walls" && selection.ids[0] === w.id}
                    hovered={hoverHit?.coll === "walls" && hoverHit.id === w.id}
                    hasError={warnWallIds.has(w.id)}
                    hoverNodeIdx={hoverWallNode?.wallId === w.id ? hoverWallNode.idx : null}
                    fmtU={fmtU}
                    showDims={showDimsFor("room")}
                    chainDims={useWallChainDims}
                    onSel={(e) => selectWall(e, w)}
                    onHover={(id) => setHoverHit(id ? { coll: "walls", id } : null)}
                    onNodeHover={(idx) => setHoverWallNode(idx == null ? null : { wallId: w.id, idx })}
                    onNode={startNode}
                    onDel={delSel}
                    onMidNode={startWallMidNode}
                    openings={plan.items}
                    room={plan.room}
                    allWalls={weldedWalls}
                    display={canvasDisplay}
                  />
                ))}
                {showDimsFor("room") && plan.room.showBoundary && !planHasDrawnWalls(weldedWalls) && (
                  <RoomDims room={plan.room} k={k} fmtU={fmtU} display={canvasDisplay} />
                )}
                {(plan.structurals || []).map((s) => (
                  <StructuralEl
                    key={s.id}
                    s={s}
                    k={k}
                    editable={active === "room" && (tool === "select" || tool === "structural")}
                    selected={selection?.coll === "structurals" && selection.ids[0] === s.id}
                    hovered={hoverHit?.coll === "structurals" && hoverHit.id === s.id}
                    fmtU={fmtU}
                    showDims={showDimsFor("room")}
                    chainDims={useWallChainDims}
                    onSel={() => {
                      if (tool === "erase") {
                        deleteHit({ coll: "structurals", id: s.id });
                        return;
                      }
                      setSel({ coll: "structurals", id: s.id });
                    }}
                    onDel={delSel}
                  />
                ))}
              </PlanLayerGroup>
              <PlanLayerGroup layerId="partitions" activeLayer={active} vis={vis} display={canvasDisplay}>
                {partitionWalls.map((w) => (
                  <WallBodyHitAreas
                    key={`wh-pt-${w.id}`}
                    wall={w}
                    allWalls={weldedWalls}
                    room={plan.room}
                    editable={active === "partitions" && (tool === "select" || tool === "wall")}
                    eraseMode={tool === "erase"}
                    onDown={(e) => selectWall(e, w)}
                  />
                ))}
                {partitionWalls.map((w) => (
                  <WallEl
                    key={`pt-${w.id}`}
                    wall={w}
                    k={k}
                    editable={active === "partitions" && (tool === "select" || tool === "wall")}
                    eraseMode={tool === "erase"}
                    selected={selection?.coll === "walls" && selection.ids[0] === w.id}
                    hovered={hoverHit?.coll === "walls" && hoverHit.id === w.id}
                    hasError={warnWallIds.has(w.id)}
                    hoverNodeIdx={hoverWallNode?.wallId === w.id ? hoverWallNode.idx : null}
                    fmtU={fmtU}
                    showDims={showDimsFor("partitions")}
                    chainDims={useWallChainDims}
                    onSel={(e) => selectWall(e, w)}
                    onHover={(id) => setHoverHit(id ? { coll: "walls", id } : null)}
                    onNodeHover={(idx) => setHoverWallNode(idx == null ? null : { wallId: w.id, idx })}
                    onNode={startNode}
                    onDel={delSel}
                    onMidNode={startWallMidNode}
                    openings={plan.items}
                    room={plan.room}
                    allWalls={weldedWalls}
                    display={canvasDisplay}
                  />
                ))}
              </PlanLayerGroup>
              <g data-room-labels pointerEvents="none">
                <LayerMutedWrap muted={layerState("zones").isMuted}>
                  {plan.zones.map((zn) => (
                    <ZoneEl
                      key={`lbl-${zn.id}`}
                      zn={zn}
                      k={k}
                      room={plan.room}
                      interactive={false}
                      showRoomLabels={display.showZoneNames !== false}
                      showZoneAreas={display.showZoneAreas}
                      showZoneFill={false}
                      fmtU={fmtU}
                    />
                  ))}
                </LayerMutedWrap>
              </g>
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
                      onSel={() => {
                        if (tool === "erase") {
                          deleteHit({ coll: "lines", id: l.id });
                          return;
                        }
                        setSel({ coll: "lines", id: l.id });
                      }}
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
                      if (tool === "erase") {
                        deleteHit({ coll: "links", id: link.id });
                        return;
                      }
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
                    onDown={(e) => {
                      if (tool === "erase") {
                        e.stopPropagation();
                        deleteHit({ coll: "labels", id: lb.id });
                        return;
                      }
                      startMove(e, "labels", lb);
                    }}
                  />
                ))}
              </PlanLayerGroup>
              <PlannerOverlayBoundary resetKey={`${selection?.coll}-${selection?.ids?.[0]}-${selection?.nodeIdx ?? ""}`}>
              <WallsTopOverlay
                walls={weldedWalls}
                k={k}
                warnWallIds={warnWallIds}
                openings={plan.items}
                room={plan.room}
                display={canvasDisplay}
                selectedWallId={selection?.coll === "walls" ? selection.ids[0] : null}
                hoveredWallId={hoverHit?.coll === "walls" ? hoverHit.id : null}
              />
              </PlannerOverlayBoundary>
              <PlannerOverlayBoundary resetKey={`wall-dims-${weldedWalls.length}`}>
              {display.showDims && useWallChainDims && runtimeDimensions.length === 0 && (
                <WallDimChains
                  walls={weldedWalls}
                  room={plan.room}
                  items={plan.items}
                  k={k}
                  fmtU={fmtU}
                  display={canvasDisplay}
                />
              )}
              </PlannerOverlayBoundary>
              <PlannerOverlayBoundary resetKey={`dims-${selection?.ids?.[0] || ""}`}>
              <g data-ui="dims-top" pointerEvents="none">
                {selObj && sel.coll === "items" && display.showDims && selection?.ids?.length === 1 && (
                  <SelectionDims it={selObj} plan={plan} k={k} fmtU={fmtU} display={display} />
                )}
                {selection?.coll === "walls" && selection?.ids?.length === 1 && display.showDims && (() => {
                  const w = weldedWalls.find((wl) => wl.id === selection.ids[0]);
                  return w ? <WallSelectionDims wall={w} room={plan.room} k={k} fmtU={fmtU} display={canvasDisplay} /> : null;
                })()}
              </g>
              </PlannerOverlayBoundary>
              {display.showDims && (
                <PlannerOverlayBoundary resetKey={`runtime-dims-${runtimeDimensions.length}`}>
                <DimensionsLayer
                  dimensions={runtimeDimensions}
                  k={k}
                  fmtDim={fmtU}
                  display={canvasDisplay}
                  selectedId={selection?.coll === "dimensions" ? selection.ids[0] : null}
                  onSelect={(e, dim) => {
                    if (dim.auto) return;
                    if (tool === "erase") {
                      deleteHit({ coll: "dimensions", id: dim.id });
                      return;
                    }
                    setSelection({ coll: "dimensions", ids: [dim.id] });
                  }}
                  onDoubleClick={(e, dim, pos) => {
                    if (dim.auto || dim.locked) return;
                    setSelection({ coll: "dimensions", ids: [dim.id] });
                    // PHASE 1B-1B — classify BEFORE opening any editor: only a
                    // dimension that provably spans one whole network-wall
                    // gets the geometry-editing UI; partial/item dimensions
                    // never open an editor at all (see RESULT — PHASE 1B-1B).
                    const classification = classifyWallLengthDimension(dim, getCurrentPlan());
                    if (classification.kind === "item") {
                      window.alert(ITEM_DIMENSION_MESSAGE);
                      return;
                    }
                    if (classification.kind === "wall-partial") {
                      window.alert(WALL_PARTIAL_DIMENSION_MESSAGE);
                      return;
                    }
                    if (classification.kind === "wall-full") {
                      const token = dimensionEditSessionRef.current.open();
                      setDimensionEdit({
                        kind: "wall-full",
                        id: dim.id,
                        wallId: classification.wallId,
                        value: formatWallLengthMm(classification.currentLengthMm),
                        error: null,
                        point1: dim.p1,
                        point2: dim.p2,
                        point1Endpoint: classification.point1Endpoint,
                        point2Endpoint: classification.point2Endpoint,
                        fixedEndpoint: classification.defaultFixedEndpoint,
                        token,
                        x: pos.x,
                        y: pos.y,
                      });
                      return;
                    }
                    // classification.kind === "manual" — unchanged existing UX.
                    setDimensionEdit({
                      kind: "manual",
                      id: dim.id,
                      value: dim.labelOverride || "",
                      x: pos.x,
                      y: pos.y,
                    });
                  }}
                />
                </PlannerOverlayBoundary>
              )}
              <g data-ui="overlay">
                {tool !== "wall" && guides.map((g, i) => {
                  if (g.type === "V") {
                    return <line key={i} x1={g.at} y1={g.y0 ?? 0} x2={g.at} y2={g.y1 ?? plan.room.h} stroke="#116355" strokeWidth={1 * k} strokeDasharray={`${5 * k} ${4 * k}`} opacity={0.45} />;
                  }
                  if (g.type === "H") {
                    return <line key={i} x1={g.x0 ?? 0} y1={g.at} x2={g.x1 ?? plan.room.w} y2={g.at} stroke="#116355" strokeWidth={1 * k} strokeDasharray={`${5 * k} ${4 * k}`} opacity={0.45} />;
                  }
                  if (g.a && g.b) {
                    const isPerpLike = g.type === "perpendicular" || g.type === "wall-perp";
                    const isExtLike = g.type === "continue" || g.type === "wall-extension" || g.type === "parallel" || g.type === "wall-parallel";
                    return (
                      <line
                        key={i}
                        x1={g.a.x}
                        y1={g.a.y}
                        x2={g.b.x}
                        y2={g.b.y}
                        stroke={g.color || "#116355"}
                        strokeWidth={(isPerpLike ? 1.2 : 1) * k}
                        strokeDasharray={isExtLike ? `${7 * k} ${5 * k}` : `${4 * k} ${3 * k}`}
                        opacity={0.7}
                      />
                    );
                  }
                  if (g.type === "angle" && g.at && Number.isFinite(g.angle)) {
                    const r = Math.max(plan.room.w, plan.room.h) * 1.5;
                    const rad = (g.angle * Math.PI) / 180;
                    const dx = Math.cos(rad) * r;
                    const dy = Math.sin(rad) * r;
                    return (
                      <line
                        key={i}
                        x1={g.at.x - dx}
                        y1={g.at.y - dy}
                        x2={g.at.x + dx}
                        y2={g.at.y + dy}
                        stroke={g.color || "#116355"}
                        strokeWidth={1 * k}
                        strokeDasharray={`${7 * k} ${5 * k}`}
                        opacity={0.5}
                      />
                    );
                  }
                  return null;
                })}
                {tool === "wall" && snapOn && display.snapGuides !== false && (
                  <WallAlignmentGuides
                    guides={wallDraftGuides}
                    k={k}
                    bounds={{ l: innerL, t: innerT, r: innerR, b: innerB }}
                  />
                )}
                {tool === "wall" && draft.length === 0 && cursor && (
                  <WallCursorPreview cursor={cursor} materialId={activeWallMaterial} thk={wallThk} k={k} />
                )}
                {tool === "wall" && (
                  <WallSnapIndicator cursor={cursor} snapPt={draftSnap} k={k} angleSnapOn={draftAngleSnap?.isSnapped} />
                )}
                {tool === "wall" && wallDraftFrom && wallDraftNodeAngles.length > 0 && (
                  <WallAngleLabels nodePt={wallDraftFrom} angles={wallDraftNodeAngles} k={k} />
                )}
                {tool === "wall" && cursor && (
                  <WallLiveChips cursor={cursor} roomHeight={plan.room.height} areaM2={wallDraftArea} k={k} />
                )}
                {draft.length > 0 && (
                  <DraftLine
                    pts={draft}
                    cursor={draftCursor}
                    k={k}
                    wall={tool === "wall"}
                    thk={wallThk}
                    color={tool === "wall" ? "#116355" : (LINE_STYLE[active] || LINE_STYLE.irrigation)?.color || "#1f6f8b"}
                    fmtU={fmtU}
                    fmtDraftLen={tool === "wall" ? fmtWallDraftLen : fmtU}
                    snapPt={draftSnap}
                    angleSnap={draftAngleSnap}
                    room={plan.room}
                    ventDuct={tool !== "wall" && (lineDraftMeta.layer || active) === "vent"}
                    allWalls={tool === "wall" ? resolvedWalls : null}
                    draftWallKind={tool === "wall" ? wallFieldsFromTool(activeToolId, active === "room" ? "outer" : "partition", plan.room, wallThk).kind : null}
                    draftWallMaterial={tool === "wall" ? activeWallMaterial : null}
                    lineDraft={{
                      layer: lineDraftMeta.layer || active,
                      ductSizeWmm: DEFAULT_DUCT_SIZE_W_MM,
                      ductSizeHmm: DEFAULT_DUCT_SIZE_H_MM,
                    }}
                  />
                )}
                {marquee && <SelectionMarquee rect={marquee} k={k} />}
                {multiBounds && <MultiSelectBounds bounds={multiBounds} k={k} />}
                {labelDraft && (
                  <g data-ui="label-draft" pointerEvents="none">
                    <circle
                      cx={labelDraft.anchor.x}
                      cy={labelDraft.anchor.y}
                      r={4 * k}
                      fill="#111"
                      stroke="#fff"
                      strokeWidth={0.6 * k}
                    />
                    <circle
                      cx={labelDraft.anchor.x}
                      cy={labelDraft.anchor.y}
                      r={14 * k}
                      fill="none"
                      stroke="#116355"
                      strokeWidth={1 * k}
                      strokeDasharray={`${4 * k} ${3 * k}`}
                      opacity={0.7}
                    />
                  </g>
                )}
                {display.showRulers !== false && (
                  <g data-rulers pointerEvents={tool === "erase" || tool === "select" || tool === "measure" ? "all" : "none"}>
                    {(plan.rulers || []).map((r) => (
                      <RulerEl
                        key={r.id}
                        ruler={r}
                        k={k}
                        fmtU={fmtU}
                        display={canvasDisplay}
                        selected={selection?.coll === "rulers" && selection.ids[0] === r.id}
                        onSel={() => {
                          if (tool === "erase") {
                            deleteHit({ coll: "rulers", id: r.id });
                            return;
                          }
                          setSelection({ coll: "rulers", ids: [r.id] });
                        }}
                        onDel={(id) => deleteHit({ coll: "rulers", id })}
                        onDragStart={startRulerDrag}
                      />
                    ))}
                  </g>
                )}
                {measure.length === 2 && (
                  <DimensionDraftEl
                    p1={measure[0]}
                    p2={measure[1]}
                    offsetPoint={measureOffsetPt}
                    k={k}
                    fmtDim={fmtU}
                    display={canvasDisplay}
                    snapPt={rulerSnap}
                  />
                )}
                {dimensionEdit && (!dimensionEdit.kind || dimensionEdit.kind === "manual") && (
                  <foreignObject
                    x={dimensionEdit.x - 80 * k}
                    y={dimensionEdit.y - 16 * k}
                    width={160 * k}
                    height={30 * k}
                  >
                    <input
                      autoFocus
                      value={dimensionEdit.value}
                      onChange={(e) => setDimensionEdit((d) => ({ ...d, value: e.target.value }))}
                      onBlur={() => {
                        if (dimensionEdit.id) applyDimensionEdit(dimensionEdit.id, dimensionEdit.value.trim());
                        setDimensionEdit(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          applyDimensionEdit(dimensionEdit.id, dimensionEdit.value.trim());
                          setDimensionEdit(null);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setDimensionEdit(null);
                        }
                      }}
                      style={{
                        width: "100%",
                        height: "100%",
                        border: "1px solid #d9e0dc",
                        borderRadius: "5px",
                        padding: "2px 6px",
                        fontSize: `${11 * k}px`,
                        fontFamily: "var(--mono)",
                      }}
                    />
                  </foreignObject>
                )}
                {dimensionEdit && dimensionEdit.kind === "wall-full" && (
                  <React.Fragment>
                    <g data-ui="wall-length-badges" pointerEvents="none">
                      {[
                        { n: 1, pt: dimensionEdit.point1, endpoint: dimensionEdit.point1Endpoint },
                        { n: 2, pt: dimensionEdit.point2, endpoint: dimensionEdit.point2Endpoint },
                      ].map(({ n, pt, endpoint }) => {
                        if (!pt) return null;
                        const isFixed = endpoint === dimensionEdit.fixedEndpoint;
                        return (
                          <g key={n}>
                            <circle cx={pt.x} cy={pt.y} r={9 * k} fill={isFixed ? "#116355" : "#ffffff"} stroke="#116355" strokeWidth={1.5 * k} />
                            <text x={pt.x} y={pt.y} textAnchor="middle" dominantBaseline="central" fontSize={10 * k} fontFamily="var(--mono)" fill={isFixed ? "#ffffff" : "#116355"}>
                              {n}
                            </text>
                          </g>
                        );
                      })}
                    </g>
                    <foreignObject
                      x={dimensionEdit.x - 95 * k}
                      y={dimensionEdit.y - 40 * k}
                      width={190 * k}
                      height={(dimensionEdit.error ? 92 : 74) * k}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: `${4 * k}px`,
                          background: "#fff",
                          border: "1px solid #d9e0dc",
                          borderRadius: "6px",
                          padding: `${5 * k}px ${7 * k}px`,
                          fontFamily: "var(--mono)",
                          boxSizing: "border-box",
                        }}
                      >
                        <input
                          autoFocus
                          value={dimensionEdit.value}
                          onChange={(e) => setDimensionEdit((d) => (d ? { ...d, value: e.target.value, error: null } : d))}
                          onBlur={() => submitWallLengthEdit(dimensionEdit)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              submitWallLengthEdit(dimensionEdit);
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              dimensionEditSessionRef.current.close();
                              setDimensionEdit(null);
                            }
                          }}
                          style={{
                            width: "100%",
                            border: "1px solid #d9e0dc",
                            borderRadius: "5px",
                            padding: "2px 6px",
                            fontSize: `${11 * k}px`,
                            fontFamily: "var(--mono)",
                            boxSizing: "border-box",
                          }}
                        />
                        <div style={{ display: "flex", gap: `${4 * k}px` }}>
                          {[1, 2].map((pointNumber) => {
                            const endpoint = pointNumber === 1 ? dimensionEdit.point1Endpoint : dimensionEdit.point2Endpoint;
                            const isActive = dimensionEdit.fixedEndpoint === endpoint;
                            return (
                              <button
                                key={pointNumber}
                                type="button"
                                // Keep DOM focus on the input — the toggle must
                                // never trigger a "leaving the editor" blur
                                // (PHASE 1B-1B §10, anchor toggle policy).
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => setDimensionEdit((d) => (d ? { ...d, fixedEndpoint: resolveFixedEndpointForPoint(pointNumber, d) } : d))}
                                style={{
                                  flex: 1,
                                  fontSize: `${9 * k}px`,
                                  fontFamily: "var(--mono)",
                                  border: "1px solid #d9e0dc",
                                  borderRadius: "4px",
                                  padding: "2px 4px",
                                  background: isActive ? "#116355" : "#fff",
                                  color: isActive ? "#fff" : "#111",
                                  cursor: "pointer",
                                }}
                              >
                                {`Закрепить точку ${pointNumber}`}
                              </button>
                            );
                          })}
                        </div>
                        {dimensionEdit.error && (
                          <div style={{ fontSize: `${9 * k}px`, color: "#c0392b", fontFamily: "var(--mono)" }}>
                            {dimensionEdit.error}
                          </div>
                        )}
                      </div>
                    </foreignObject>
                  </React.Fragment>
                )}
                {tool === "structural" && draft.length >= 1 && (
                  <StructuralDraft
                    kind={structuralKind}
                    a={draft[0]}
                    b={draft[1] || cursor}
                    width={structuralWidth}
                    k={k}
                    fmtU={fmtU}
                  />
                )}
                {tool === "select" && selection?.coll === "walls" && selection.ids?.length === 1 && (
                  <PlannerOverlayBoundary resetKey={`edit-${selection.ids[0]}-${selection.nodeIdx ?? ""}`}>
                  <WallEditOverlay
                    walls={weldedWalls}
                    selection={selection}
                    k={k}
                    stepMm={display.arrowStepMm ?? 10}
                    onNudge={nudgeWallSelection}
                  />
                  </PlannerOverlayBoundary>
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
      <input
        ref={backdropInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleBackdropFile(file);
          e.target.value = "";
        }}
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
      <PlannerVisualSettingsModal
        open={visualSettingsOpen}
        display={display}
        onPatch={patchDisplay}
        onClose={() => setVisualSettingsOpen(false)}
      />
      <PlannerMaterialPresetsModal
        open={materialPresetsOpen}
        onClose={() => setMaterialPresetsOpen(false)}
        onChanged={() => setMaterialPresetsRev((n) => n + 1)}
      />
      <PlannerLabelModal
        open={!!labelDraft}
        targetName={labelDraft?.targetName}
        onConfirm={confirmLabelDraft}
        onCancel={cancelLabelDraft}
      />
      {diagnosticsOpen && (
        <PlanDiagnosticsPanel
          result={planDiagnostics?.result || null}
          stale={diagnosticsStale}
          checking={diagnosticsChecking}
          filters={diagnosticFilters}
          onFilterToggle={toggleDiagnosticFilter}
          onRerun={runPlanCheck}
          onClose={() => setDiagnosticsOpen(false)}
          onFocus={focusDiagnostic}
          propertiesOpen={showProperties}
        />
      )}
    </>
  );
}
