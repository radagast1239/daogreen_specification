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
import { commitWallChain } from "../../planner/core/walls/wallCommit.js";
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
  addWall, moveNode, splitWall, deleteWall, deleteNode, mergeNodes, connectWallEndpoint,
  classifyWallSegmentAttachments, moveWallSegment, moveLogicalWallChain,
  materializeWallCommand, connectFloatingEndpointsToWallBodies,
  NODE_LINK_THR,
} from "../../planner/core/walls/index.js";
import {
  wallMoveHandleEligibility,
  logicalChainMoveHandleEligibility,
} from "../../planner/core/walls/wallMoveEligibility.js";
import {
  resolveLogicalWallChain,
  logicalChainEndpointGrips,
} from "../../planner/core/walls/logicalWallChain.js";
import { wallEndpointGrips } from "../../planner/core/walls/endpointGripEligibility.js";
import {
  WallEndpointGripLayer, WallChainMoveHandleLayer, dedupeGripsByNode, gripKey,
} from "../../planner/wallEndpointGrips.jsx";
import { commitDrawnWall, resolveWallDraftEnd } from "../../planner/core/walls/wallDrawTopology.js";
import {
  createWallGestureState,
  wallGesturePointerDown,
  wallGesturePointerMove,
  wallGesturePointerUp,
  wallGestureCancel,
  wallGestureMarkCommitted,
  shouldBlockWallGeometryDrag,
  WALL_DRAW_MIN_LEN_MM,
} from "../../planner/core/walls/wallDrawGestures.js";
import { syncRoomsSafe } from "../../planner/core/rooms/index.js";
import { validateRooms } from "../../planner/core/rooms/validateRooms.js";
import {
  resolvePlanWalls, deleteWallEdge, movePlanNode,
  wallNodeIdAt, isNetworkPlan, ensureWallNetwork,
  applyNetworkNodeAtWall, applyNetworkWallSegMove, nudgeWallInPlan,
  tryMergeWallEdge, breakWallEdgeAt, straightenWallEdge, alignWallEdgeToNeighbor,
  findNodeIdAt,
} from "../../planner/wallNetwork.js";
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
import { usePlanInteractionSession } from "../../planner/usePlanInteractionSession.js";
import { createWallDrawController } from "../../planner/core/session/index.js";
import { resolveWallPoint } from "../../planner/core/snap/index.js";
import { createPlanAutosaveBridge } from "../../planner/core/history/planAutosaveBridge.js";
import { normalizePlan, normalizePlanResult } from "../../planner/planNormalize.js";
import { isPlannerPlanCorrupt } from "../../planner/plannerPersistenceState.js";
import { hitTestWallInteraction } from "../../planner/ui/hitTesting/planHitTest.js";
import { validatePlanIntegrity } from "../../planner/core/validation/validatePlanIntegrity.js";
import { PlanDiagnosticsPanel } from "../../planner/ui/diagnostics/PlanDiagnosticsPanel.jsx";
import { getDiagnosticFocusTarget } from "../../planner/ui/diagnostics/diagnosticFocus.js";
import { isDiagnosticsStale } from "../../planner/ui/diagnostics/diagnosticPresentation.js";
import { DEFAULT_DUCT_SIZE_H_MM, DEFAULT_DUCT_SIZE_W_MM } from "../../planner/ventDuctRender.jsx";
import {
  PlanGridScreen, PlanAxesScreen, SheetBackdrop, RoomDims, WallEl, WallsTopOverlay, PlannerWallDefs, PlannerLayerDefs, LayerMutedWrap, ItemEl, ZoneEl, LabelEl, LineEl,
  DraftLine, SelectionDims, WallDimChains, RulerEl, DimensionsLayer, DimensionDraftEl, TypedLengthHint, LinkEl,
  SelectionMarquee, MultiSelectBounds, PlanLayerGroup, RoomFloorEl,
} from "../../planner/canvasPrimitives.jsx";
import { pickDimensionHit } from "../../planner/dimensionMarkers.jsx";
import {
  createAngleDimension,
} from "../../planner/core/dimensions/anchorOperations.js";
import {
  WallCursorPreview, WallSnapIndicator, WallAlignmentGuides,
  WallAngleLabels, fmtWallDraftLen,
} from "../../planner/wallDraftOverlay.jsx";
import { WallLiveMeasurementOverlay } from "../../planner/wallLiveMeasurementOverlay.jsx";
import { AngleMagnetOverlay } from "../../planner/angleMagnetOverlay.jsx";
import {
  resolveAngleMagnet,
  resolveEndpointMagnetContext,
  resolveDraftMagnetContext,
  buildAngleMagnetPreview,
  buildDraftMovementAngles,
  emptyAngleMagnetPreview,
  pointAtMagnetLength,
} from "../../planner/core/dimensions/angleMagnetSnap.js";
import { WallFloatingLengthEditor } from "../../planner/wallFloatingLengthEditor.jsx";
import {
  buildLiveWallDrawMeasurements,
  buildLiveWallEditMeasurements,
  parseLengthInput,
  applyExactWallLength,
  resolveLiveDrawSegment,
  assertLiveMeasurementModel,
  pointAtLengthAlong,
  resolveLengthEditAnchor,
} from "../../planner/core/walls/liveWallMeasurements.js";
import {
  filterDimensionsForActiveInteraction,
} from "../../planner/core/dimensions/activeDimensionArbitration.js";
import {
  resolveSelectedDimensionSemantics,
} from "../../planner/core/dimensions/selectedDimensionSemantics.js";
import { nearWallLaneOffsetMm } from "../../planner/core/viewport/gripScale.js";
import { cursorCenteredZoomView, resolveViewportLod } from "../../planner/core/grid/adaptiveGrid.js";
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
import { toolStateFromDef, isItemVisibleOnSheet, isLineVisibleOnSheet } from "../../planner/plannerSheetUtils.js";
import { resolveTool } from "../../planner/plannerTools.js";
import { sheetAllowedInViewMode, viewModeForSheet } from "../../planner/plannerViewModes.js";
import {
  buildPlannerToolRailTools,
  resolveRailActiveToolId,
} from "../../planner/plannerToolRailCatalog.js";
import {
  buildInspectorModel,
  inspectorChangeToPatch,
} from "../../planner/plannerInspectorModel.js";
import {
  computePlanContentBounds,
  computeFitTransform,
  shouldAutoFitPlan,
  PLANNER_DEFAULT_ZOOM,
} from "../../planner/viewport.js";
import { PlannerErrorBoundary, PlannerOverlayBoundary } from "../../planner/ui/PlannerErrorBoundary.jsx";
import { WallEditOverlay } from "../../planner/wallEditOverlay.jsx";
import { WallBodyHitAreas, WallMassLayer } from "../../planner/wallRender.jsx";
import { ContextMenu, buildObjectMenu } from "../../planner/ui/ContextMenu.jsx";
import { AttachPlanModal } from "../../planner/ui/AttachPlanModal.jsx";
import "../../planner/planner.css";
import { Empty } from "../../components/ui.jsx";

const PLANNER_TOOL_RAIL = buildPlannerToolRailTools();

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

function modKey(e) {
  return e.ctrlKey || e.metaKey;
}

/**
 * Physical-key match for shortcuts.
 *
 * event.key carries the LAYOUT character, so on a Russian layout the physical
 * Z key reports "я" and Ctrl+Z never matched — the toolbar button worked while
 * the shortcut silently did nothing. event.code is the physical key, so it is
 * the primary match; the event.key fallback only covers engines that omit code.
 */
function physicalKey(e, code, ...keyAliases) {
  if (e.code) return e.code === code;
  const key = String(e.key || "").toLowerCase();
  return keyAliases.some((alias) => alias.toLowerCase() === key);
}

/**
 * Which history action a keydown requests, or null.
 * Exported so the shortcut contract is tested against the exact matcher the
 * keydown handler uses, rather than a copy of it.
 */
export function matchHistoryShortcut(e) {
  if (!e || !modKey(e)) return null;
  if (isEditableTarget(e.target)) return null;
  if (physicalKey(e, "KeyY", "y", "н")) return "redo";
  if (physicalKey(e, "KeyZ", "z", "я")) return e.shiftKey ? "redo" : "undo";
  return null;
}

/** True for real text-entry targets, where the browser's own undo must win. */
export function isEditableTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return typeof target.closest === "function" && !!target.closest("[contenteditable='true']");
}

/**
 * Read-only acceptance seam, dev-only and opt-in.
 *
 * Requires BOTH a dev build and an explicit handshake, so no plan state, counter
 * name or seam string can reach a production bundle: Vite substitutes
 * import.meta.env.DEV with false in a production build, which makes this constant
 * statically false and lets the minifier drop every guarded block.
 *
 * Enable locally with VITE_DG_PLANNER_E2E=1 on the dev server.
 */
const EXPOSE_PLANNER_E2E = !!import.meta.env.DEV
  && import.meta.env.VITE_DG_PLANNER_E2E === "1";

/**
 * PHASE 2A — B+ single-wall drag-release drawing, opt-in.
 *
 * Off by default: the legacy click-click path below is untouched unless this
 * is set. Vite substitutes the value statically, so a build without the flag
 * drops every guarded block.
 *
 * Enable locally with VITE_DG_PLANNER_WALL_DRAW_V2=1.
 */
const WALL_DRAW_V2 = import.meta.env.VITE_DG_PLANNER_WALL_DRAW_V2 === "1";

/**
 * Translate the bounded resolver's decision into the explicit topology intent
 * consumed by commitDrawnWall. The point is always the exact point previewed
 * by the V2 session; resolver metadata only selects the topology operation.
 */
/**
 * PHASE 2D / 2F1 — what the right mouse button means for the current planner state.
 *
 * First RMB while ANY non-neutral state exists cancels to Select (no menu).
 * Second RMB may open a context menu only when already neutral.
 */
export const CONTEXT_MENU_ACTION = {
  NONE: "none",
  CANCEL_AND_SELECT: "cancel-and-select",
  CONTEXT_MENU: "context-menu",
};

export function isPlannerNonNeutral(tool, state = {}) {
  if (tool && tool !== "select") return true;
  if (state.wallDrawActive) return true;
  if (state.previewActive) return true;
  if (state.dragActive) return true;
  if (state.inspectorOpen) return true;
  if (state.ctxMenuOpen) return true;
  const sel = state.selection;
  if (!sel) return false;
  if (Array.isArray(sel.ids) && sel.ids.length > 0) return true;
  if (sel.id) return true;
  return false;
}

export function contextMenuActionFor(tool, activeLayer, state = {}) {
  if (activeLayer === "spec") return CONTEXT_MENU_ACTION.NONE;
  if (isPlannerNonNeutral(tool, state)) return CONTEXT_MENU_ACTION.CANCEL_AND_SELECT;
  return CONTEXT_MENU_ACTION.CONTEXT_MENU;
}

/**
 * PHASE 2D — may this double click open the wall properties?
 *
 * The decision is made from what the POINT hits, not from the DOM target: a
 * dblclick that follows a preventDefault()ed pointerdown is retargeted to the
 * <svg> itself, so the element under the mouse tells us nothing. Hit-testing
 * the model point also gives the whole visible wall mass for free — outline,
 * hatch and the transparent hit area all resolve to the same wall.
 *
 * Exported so the guard the handler actually uses is the guard under test.
 */
export function wallDoubleClickOpensInspector({ tool, hitColl }) {
  if (tool !== "select") return false;
  return hitColl === "walls";
}

export function wallDrawV2SnapToTopologyIntent(snap, point) {
  const resolvedPoint = { x: point.x, y: point.y };
  if (snap?.kind === "node") {
    return {
      kind: "node", point: resolvedPoint, nodeId: snap.nodeId,
      wallId: null, hostWallId: null, connects: true,
    };
  }
  if (snap?.kind === "wall-end") {
    return {
      kind: "wall-end", point: resolvedPoint, nodeId: snap.nodeId,
      wallId: snap.wallId, hostWallId: null, connects: true,
    };
  }
  if (snap?.kind === "wall-body") {
    return {
      kind: "wall-body", point: resolvedPoint, nodeId: null,
      wallId: null, hostWallId: snap.hostWallId, connects: true,
    };
  }
  return {
    kind: "none", point: resolvedPoint, nodeId: null,
    wallId: null, hostWallId: null, connects: false,
  };
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

  const initialPlan = () => {
    if (standalone) return normalizePlan(draftMeta?.plan || getStandalonePlan(draftId)?.plan);
    return normalizePlan(project?.plan);
  };

  const {
    plan, setPlan, replacePlan, syncDerivedPlan, commitPlan, commitFrom, undo, redo, resetHistory,
    canUndo, canRedo, undoDepth, redoDepth,
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
  const [view, setView] = useState({ panX: 0, panY: 0, zoom: PLANNER_DEFAULT_ZOOM });
  const viewportManualRef = useRef(false);
  const viewportFittedRef = useRef(false);
  const viewportAutoStateRef = useRef({});
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
  // PHASE 2E.1 REWORK — endpoint-grip affordance state (hover / drag), so the
  // control has a visible resting, hover and active appearance.
  const [hoverGripKey, setHoverGripKey] = useState(null);
  const [activeGripKey, setActiveGripKey] = useState(null);
  const [hoverHit, setHoverHit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(true);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saveUiStatus, setSaveUiStatus] = useState("saved"); // hydrating|dirty|saving|saved|error
  const [hoverDimensionId, setHoverDimensionId] = useState(null);
  const [spacePan, setSpacePan] = useState(false);
  const [altSnapOff, setAltSnapOff] = useState(false);
  const [linkFrom, setLinkFrom] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null);
  const ctxMenuRef = useRef(null);
  ctxMenuRef.current = ctxMenu;
  const [typedLength, setTypedLength] = useState("");
  // PHASE 2A — transient V2 rubber band (declared here so the read-only E2E
  // snapshot effect above can list it as a dependency).
  const [wallDrawV2Preview, setWallDrawV2Preview] = useState(null);
  const [draftSnap, setDraftSnap] = useState(null);
  const [draftAngleSnap, setDraftAngleSnap] = useState(null);
  // PHASE 2F2.2 — MODE A magnet preview (ephemeral; never persisted / reloaded).
  const [angleMagnetPreview, setAngleMagnetPreview] = useState(() => emptyAngleMagnetPreview());
  const angleMagnetSnapRef = useRef(null);
  const wallChainStartRef = useRef(null);
  const wallPrevAngleRef = useRef(null);
  const wallDraftStateRef = useRef(createWallDraftState());
  const wallDrawRef = useRef(null);
  const wallGestureRef = useRef(createWallGestureState());
  // Observability counters for automated acceptance runs (no behaviour change).
  // Only allocated when the dev seam is live, so not even the counter names reach
  // a production bundle.
  const geomProbeRef = useRef(EXPOSE_PLANNER_E2E
    ? {
      selectWallCalls: 0,
      selectWallBlocked: 0,
      moveWallCalls: 0,
      moveWallBlocked: 0,
      moveNodeCalls: 0,
      moveNodeBlocked: 0,
      wallGestureLog: [],
    }
    : null);
  const structuralDrawRef = useRef(null);
  const measureDrawRef = useRef(null);
  const [measureKind, setMeasureKind] = useState("linear"); // linear | diagonal | angle
  const [dimensionEdit, setDimensionEdit] = useState(null);
  const [ctrlSnapFine, setCtrlSnapFine] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [activeSheetId, setActiveSheetId] = useState("base_plan");
  const [activeCategoryId, setActiveCategoryId] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  /**
   * PHASE 2D — wall properties are opened by an explicit double click, never
   * by selection. Selecting a wall and editing its parameters are two separate
   * user intents, so they are two separate pieces of state: `selection` says
   * WHICH wall, `wallInspectorOpen` says whether its editor is showing.
   * The counters carry the intent down to the panel, so repeating the same
   * intent (double click, double click) is always observed.
   */
  const [wallInspectorOpen, setWallInspectorOpen] = useState(false);
  const [inspectorOpenReq, setInspectorOpenReq] = useState(0);
  const [inspectorCloseReq, setInspectorCloseReq] = useState(0);
  /** PHASE 2F1-LIVE2 — compact floating length editor (not the docked inspector). */
  const [floatEditorOpen, setFloatEditorOpen] = useState(false);
  const [floatFocusReq, setFloatFocusReq] = useState(0);
  const [exactLengthPreview, setExactLengthPreview] = useState(null);
  const [drawTypedSeed, setDrawTypedSeed] = useState(null);
  const floatInputRef = useRef(null);
  const pointerRafRef = useRef(0);
  const pointerPendingRef = useRef(null);
  const v2PreviewRafRef = useRef(0);
  const wheelRafRef = useRef(0);
  const wheelPendingRef = useRef(null);
  const openWallInspector = () => {
    setWallInspectorOpen(true);
    setInspectorOpenReq((n) => n + 1);
  };
  const closeWallInspector = () => {
    setWallInspectorOpen(false);
    setInspectorCloseReq((n) => n + 1);
  };
  const closeFloatEditor = () => {
    setFloatEditorOpen(false);
    setExactLengthPreview(null);
  };
  // The editor belongs to a selected wall: dropping that selection (or picking
  // a different kind of entity) ends the editing intent, so Escape and the
  // panel stay in agreement about what is open.
  useEffect(() => {
    if (selection?.coll !== "walls") {
      setWallInspectorOpen(false);
      setFloatEditorOpen(false);
      setExactLengthPreview(null);
    }
  }, [selection]);
  const [planLevel, setPlanLevel] = useState("Этаж 1");
  const [planVariant, setPlanVariant] = useState("Планировка 1");
  const [pinnedProperties, setPinnedProperties] = useState(true);
  const [propsTab, setPropsTab] = useState("props");
  const [warningsPanelOpen, setWarningsPanelOpen] = useState(false);
  const [viewMode, setViewMode] = useState("2d");
  // PHASE 0D — read-only проверка целостности плана (session-only, не persisted).
  const [planDiagnostics, setPlanDiagnostics] = useState(null); // { result, planRef }
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnosticsChecking, setDiagnosticsChecking] = useState(false);
  const [diagnosticFilters, setDiagnosticFilters] = useState({ error: true, warning: true, info: true });
  // Phase 2A3/2A4 — session-only room detection diagnostic (load/import/live-edit).
  // Never persisted into plan JSON, autosave payload, or undo history.
  const [roomDetectionDiagnostic, setRoomDetectionDiagnostic] = useState(null);
  const [roomDiagnosticDismissed, setRoomDiagnosticDismissed] = useState(false);

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
  const draftMetaRef = useRef(draftMeta);
  draftMetaRef.current = draftMeta;
  const plannerPlanCorruptRef = useRef(plannerPlanCorrupt);
  plannerPlanCorruptRef.current = plannerPlanCorrupt;
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const autosaveBridgeRef = useRef(null);
  const autosaveIdentityRef = useRef(null);

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

  // Hydration-aware autosave: one controller for the PlanPage lifetime.
  useEffect(() => {
    const bridge = createPlanAutosaveBridge({
      debounceMs: 700,
      getActiveIdentity: () => autosaveIdentityRef.current,
      onStatus: ({ status, dirty, failed, identity }) => {
        if (!identity || !autosaveIdentityRef.current) return;
        if (`${identity.mode}:${identity.id}` !== `${autosaveIdentityRef.current.mode}:${autosaveIdentityRef.current.id}`) {
          return;
        }
        setSaveFailed(!!failed);
        if (failed) {
          setSaveUiStatus("error");
          setSaved(false);
        } else if (status === "hydrating") {
          setSaveUiStatus("hydrating");
          setSaved(false);
        } else if (status === "saving") {
          setSaveUiStatus("saving");
          setSaved(false);
        } else if (dirty) {
          setSaveUiStatus("dirty");
          setSaved(false);
        } else {
          setSaveUiStatus("saved");
          setSaved(true);
        }
      },
      persistFn: async (identity, planToSave) => {
        if (identity.mode === "standalone") {
          const meta = draftMetaRef.current;
          if (!meta?.id) throw new Error("standalone draft missing");
          const next = saveStandalonePlan({ ...meta, plan: planToSave });
          setDraftMeta(next);
          return next;
        }
        // PHASE 0B: never overwrite a corrupt stored plan with a default/empty plan.
        if (plannerPlanCorruptRef.current) {
          const err = new Error("planner plan corrupt — autosave blocked");
          err.code = "PLANNER_PLAN_CORRUPT";
          throw err;
        }
        return actionsRef.current.projectUpdate(identity.id, { plan: planToSave });
      },
    });
    autosaveBridgeRef.current = bridge;
    return () => {
      bridge.dispose();
      autosaveBridgeRef.current = null;
    };
  }, []);

  useEffect(() => {
    // Phase 2A3 — project/draft switch: previous diagnostic must never leak
    // into the newly loaded plan while it's still being fetched/normalized.
    setRoomDetectionDiagnostic(null);
    setRoomDiagnosticDismissed(false);
    setSaveFailed(false);
    setSaved(true);
    setSelection(null);
    setDimensionEdit(null);
    measureDrawRef.current = null;
    setMeasure([]);
    setMeasureOffsetPt(null);

    const getBridge = () => autosaveBridgeRef.current;

    if (standalone) {
      const identity = { mode: "standalone", id: draftId };
      autosaveIdentityRef.current = identity;
      getBridge()?.beginHydration(identity);
      const d = getStandalonePlan(draftId);
      if (d) {
        setDraftMeta(d);
        const { plan: normalized, diagnostics } = normalizePlanResult(d.plan);
        resetHistory(normalized);
        setRoomDetectionDiagnostic(diagnostics[0] || null);
        getBridge()?.completeHydration(identity, normalized);
      } else {
        getBridge()?.failHydration(identity, new Error("standalone draft not found"));
      }
      return undefined;
    }

    const identity = { mode: "project", id };
    autosaveIdentityRef.current = identity;
    getBridge()?.beginHydration(identity);
    let cancelled = false;
    actionsRef.current.loadProject(id).then((p) => {
      if (cancelled) return;
      const bridge = getBridge();
      if (!bridge) return;
      const { plan: normalized, diagnostics } = normalizePlanResult(p?.plan);
      resetHistory(normalized);
      setRoomDetectionDiagnostic(diagnostics[0] || null);
      bridge.completeHydration(identity, normalized);
    }).catch((err) => {
      if (cancelled) return;
      const bridge = getBridge();
      if (!bridge) return;
      // Keep hydrating→failed only when still waiting; never wipe a later session.
      if (bridge.getState(identity)?.status === "hydrating") {
        bridge.failHydration(identity, err);
        console.error("Planner project load failed", err);
      }
    });
    return () => { cancelled = true; };
  }, [id, draftId, standalone, resetHistory]);

  useEffect(() => {
    if (!planHasDrawnWalls(plan.walls)) return;
    // Rooms/zones are derived from walls, so this sync must not become its own
    // undo step: syncAutoZones always returns a fresh object, and recording it
    // buried each real wall commit under no-op checkpoints, so one Ctrl+Z looked
    // like it did nothing. PHASE 2E.1: the exemption is now declared BY THIS CALL
    // (origin = derived-sync) instead of by a flag armed earlier during load.
    syncDerivedPlan((p) => syncAutoZones(p));
  }, [standalone ? draftId : id, plan.walls, plan.zones?.length, plan.rooms?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Report live plan to the hydration-aware autosave controller.
  useEffect(() => {
    const identity = autosaveIdentityRef.current;
    const bridge = autosaveBridgeRef.current;
    if (!identity || !bridge) return;
    if (!standalone && plannerPlanCorrupt) return;
    bridge.observePlan(identity, plan);
  }, [plan, standalone, draftId, id, plannerPlanCorrupt]);

  // Read-only snapshot for automated acceptance runs: lets a browser test wait on
  // real state and map world mm -> screen px. Never written back into the plan,
  // and dev-only + opt-in (see EXPOSE_PLANNER_E2E).
  useEffect(() => {
    if (!EXPOSE_PLANNER_E2E || typeof window === "undefined") return;
    const v2Preview = WALL_DRAW_V2 ? (wallDrawV2Ref.current?.getPreview() || null) : null;
    window.__dgPlanner = {
      ...(window.__dgPlanner || {}),
      plan,
      view,
      tool,
      draftLen: draft.length,
      gesturePhase: wallGestureRef.current?.phase || "idle",
      wallDrawV2: {
        enabled: WALL_DRAW_V2,
        active: !!(WALL_DRAW_V2 && wallDrawV2Ref.current?.isActive()),
        txId: WALL_DRAW_V2 ? (wallDrawV2Ref.current?.getTxId() ?? 0) : 0,
        preview: v2Preview,
        intents: v2Preview ? {
          start: wallDrawV2SnapToTopologyIntent(v2Preview.startSnap, v2Preview.start),
          end: v2Preview.end
            ? wallDrawV2SnapToTopologyIntent(v2Preview.endSnap, v2Preview.end)
            : null,
        } : null,
      },
      svgRect: svgRef.current?.getBoundingClientRect?.() || null,
      probe: geomProbeRef.current,
      selection,
      wallInspectorOpen,
      floatEditorOpen,
      canUndo,
      canRedo,
      at: Date.now(),
    };
  }, [plan, view, tool, draft, selection, canUndo, canRedo, wallDrawV2Preview, wallInspectorOpen, floatEditorOpen]);

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
    wallDrawRef.current = null;
    wallGestureRef.current = wallGestureCancel();
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

  const computeWallSnap = useCallback((raw, from, extraOptions) => {
    const result = runSnapEngine({
      point: raw,
      mode: "wall",
      plan,
      draft: { pts: draft, chainStart: wallChainStartRef.current },
      view,
      modifiers: { shift: shiftRef.current, alt: altSnapRef.current },
      options: { ...wallSnapOptions(), from, ...extraOptions },
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

  // Phase 2A4 — safe runtime wrapper around room re-sync for live-edit paths.
  // On success: applies new rooms/zones, clears the session diagnostic.
  // On failure: wall geometry and previous rooms/zones are left untouched
  // (returns `p` unchanged) and a diagnostic is surfaced instead of throwing.
  const syncAutoZones = (p) => {
    const safe = syncRoomsSafe({ ...p, walls: resolvePlanWalls(p) });
    if (!safe.ok) {
      setRoomDetectionDiagnostic(safe.diagnostics[0] || null);
      setRoomDiagnosticDismissed(false);
      // PHASE 2F1 ghost fix: never keep stale room floors glued to new walls.
      // Empty zones hide floor strokes; walls remain authoritative.
      const dimWarnings = (p.validationWarnings || []).filter((w) => w.source === "dimensions");
      const wallCmdWarnings = (p.validationWarnings || []).filter((w) => w.source === "wall-command");
      return {
        ...p,
        rooms: [],
        zones: [],
        validationWarnings: [...dimWarnings, ...wallCmdWarnings, ...(safe.diagnostics || [])],
      };
    }
    setRoomDetectionDiagnostic(null);
    const dimWarnings = (p.validationWarnings || []).filter((w) => w.source === "dimensions");
    const wallCmdWarnings = (p.validationWarnings || []).filter((w) => w.source === "wall-command");
    return {
      ...p,
      rooms: safe.rooms,
      zones: safe.zones,
      validationWarnings: [...dimWarnings, ...wallCmdWarnings, ...(safe.validationWarnings || [])],
    };
  };

  /** Run a wallCommands result: on changed:true → materialize + safe room sync. */
  const applyWallCmd = (p, result, opts) => {
    const mat = materializeWallCommand(p, result, opts);
    if (!mat.changed) return p;
    return syncAutoZones(mat.plan);
  };

  /**
   * PHASE 1A — transient wall/node edit transaction.
   *
   * A drag preview lives in this session, never in the committed plan, so
   * history, autosave and the room engine only ever observe committed state.
   * Derived rooms/dimensions refresh on commit, not on pointermove: the room
   * sync is too heavy to run per pointer event and is deliberately deferred to
   * `finalize` below, which runs exactly once per transaction.
   */
  const wallEdit = usePlanInteractionSession({
    finalize: (previewPlan) => syncAutoZones(previewPlan),
    commitFrom,
  });
  const wallEditPreview = wallEdit.getPreviewPlan();
  /** Renderer-facing plan: typed-length preview, in-flight edit, else committed. */
  const effectivePlan = exactLengthPreview || wallEditPreview || plan;
  /**
   * PHASE 2F1 — single authoritative geometry snapshot for all live layers.
   * Room floors/zones must track the same walls as WallMassLayer; otherwise
   * committed zone strokes ghost at pre-drag coordinates during/after edits.
   */
  const renderZones = effectivePlan.zones || [];
  const renderRooms = effectivePlan.rooms || [];

  /**
   * Geometry-only wall-segment move. Always reduced from the transaction's base
   * plan. Preview rooms/zones are re-synced from the preview walls so floor
   * strokes cannot remain frozen at committed coordinates (ghost geometry).
   * History/autosave still observe only the committed plan until finalize.
   */
  const wallSegMovePreviewPlan = (basePlan, wallId, newA, newB, endpointAttachments) => {
    const netWall = (basePlan.walls || []).find((w) => w.id === wallId);
    if (!netWall?.a || !netWall?.b) {
      const next = applyNetworkWallSegMove(basePlan, wallId, newA, newB);
      const resolved = resolvePlanWalls(next);
      const withItems = {
        ...next,
        items: refreshWallMountedItems(basePlan.items, resolved, basePlan.room, wallId),
      };
      const safe = syncRoomsSafe(withItems);
      if (!safe.ok) return { ...withItems, rooms: [], zones: [] };
      return { ...withItems, rooms: safe.rooms, zones: safe.zones };
    }
    const baseA = basePlan.nodes?.[netWall.a];
    if (!baseA) return basePlan;
    const delta = { x: newA.x - baseA.x, y: newA.y - baseA.y };
    // PHASE 2F1 — a host split by a T is ONE wall for the user, so its centre
    // handle runs the chain transaction: one rigid translation of every segment
    // and every internal T junction node, in one command (= one history entry,
    // one write). A wall that was never split takes the unchanged path.
    const chain = resolveLogicalWallChain(basePlan, wallId);
    const result = chain.segmentCount > 1
      ? moveLogicalWallChain(basePlan, {
        wallId,
        delta,
        expectedChainWallIds: chain.wallIds,
        makeId: uid,
      })
      : moveWallSegment(basePlan, {
        wallId,
        delta,
        expectedEndpointAttachments: endpointAttachments,
        makeId: uid,
      });
    if (EXPOSE_PLANNER_E2E) {
      geomProbeRef.current.lastWallMoveResult = {
        input: "mouse",
        wallId,
        changed: !!result.changed,
        reason: result.reason || null,
        warnings: [...(result.warnings || [])],
        requestedDelta: { ...delta },
        effectiveDelta: result.changed
          ? (result.movement?.delta || null)
          : { x: 0, y: 0 },
      };
    }
    const mat = materializeWallCommand(basePlan, result);
    if (!mat.changed) return basePlan;
    // Keep preview rooms/zones in lockstep with preview walls so floor strokes
    // cannot ghost at committed coordinates. On detection failure, clear zones
    // rather than keep stale floors.
    const safe = syncRoomsSafe(mat.plan);
    if (!safe.ok) return { ...mat.plan, rooms: [], zones: [] };
    return { ...mat.plan, rooms: safe.rooms, zones: safe.zones };
  };

  /** Geometry-only wall-node move (merge / T-junction preserved; rooms synced for render). */
  const wallNodeMovePreviewPlan = (basePlan, d, snapped) => {
    const netWall = (basePlan.walls || []).find((w) => w.id === d.id);
    const nodeId = d.idx === 0 ? netWall?.a : netWall?.b;
    if (!nodeId) {
      const next = applyNetworkNodeAtWall(basePlan, d.id, d.idx, { x: snapped.x, y: snapped.y });
      const rw = resolvePlanWalls(next);
      const withItems = { ...next, items: refreshWallMountedItems(basePlan.items, rw, basePlan.room) };
      const safe = syncRoomsSafe(withItems);
      if (!safe.ok) return { ...withItems, rooms: [], zones: [] };
      return { ...withItems, rooms: safe.rooms, zones: safe.zones };
    }
    let r = moveNode(basePlan, nodeId, { x: snapped.x, y: snapped.y });
    // Merge onto another existing node when the drag lands within link tolerance.
    const hitId = findNodeIdAt(r.plan.nodes, { x: snapped.x, y: snapped.y }, NODE_LINK_THR);
    if (hitId && hitId !== nodeId) {
      const merged = mergeNodes(r.plan, hitId, nodeId);
      if (merged.changed) r = merged;
    } else {
      // T-junction: endpoint dragged onto another wall body
      const host = pickWallBodyHit({ x: snapped.x, y: snapped.y }, resolvePlanWalls(r.plan), r.plan.room);
      if (host?.wall?.id && host.wall.id !== d.id) {
        const connected = connectWallEndpoint(r.plan, nodeId, host.wall.id, { x: snapped.x, y: snapped.y }, uid);
        if (connected.changed) r = connected;
      }
    }
    const mat = materializeWallCommand(basePlan, r);
    if (!mat.changed) return basePlan;
    const safe = syncRoomsSafe(mat.plan);
    if (!safe.ok) return { ...mat.plan, rooms: [], zones: [] };
    return { ...mat.plan, rooms: safe.rooms, zones: safe.zones };
  };

  /** Latest transient geometry a drag should read from (snapping, anchors). */
  const wallEditDragPlan = (d) => wallEdit.getPreviewPlan() || d?.basePlan || plan;

  /**
   * PHASE 2A — B+ single-wall drag-release drawing session (opt-in, V2).
   *
   * pointerdown → pointermove preview → pointerup → exactly one committed wall
   * → idle. The session never holds a plan, so a preview cannot reach history
   * or autosave; the release runs the existing commitDrawnWall pipeline once.
   * None of the legacy chain state (wallChainStartRef, wallDraftStateRef,
   * wallPrevAngleRef, suppressNextClick) participates in this path.
   */
  const wallDrawV2CommitRef = useRef(null);
  const wallDrawV2Ref = useRef(null);
  // True once the gesture has previewed an endpoint, so a release never
  // resolves a second, different endpoint over one the user already saw.
  const wallDrawV2MovedRef = useRef(false);
  if (WALL_DRAW_V2 && !wallDrawV2Ref.current) {
    wallDrawV2Ref.current = createWallDrawController({
      minLenMm: WALL_DRAW_MIN_LEN_MM,
      commitSegment: (segment) => wallDrawV2CommitRef.current?.(segment),
      // LIVE3/LIVE4: at most one React preview commit per animation frame.
      // Skip setState when quantized endpoints did not change (cuts p95 spikes).
      onChange: () => {
        if (v2PreviewRafRef.current) return;
        v2PreviewRafRef.current = requestAnimationFrame(() => {
          v2PreviewRafRef.current = 0;
          const next = wallDrawV2Ref.current?.getPreview?.() || null;
          setWallDrawV2Preview((prev) => {
            if (!next && !prev) return prev;
            if (!next || !prev) return next;
            const q = (p) => (p && Number.isFinite(p.x)
              ? `${Math.round(p.x)}:${Math.round(p.y)}`
              : "");
            if (
              q(prev.start) === q(next.start)
              && q(prev.end) === q(next.end)
              && !!prev.moved === !!next.moved
              && Math.round(prev.lengthMm || 0) === Math.round(next.lengthMm || 0)
            ) {
              return prev;
            }
            return next;
          });
        });
      },
    });
  }
  const wallDrawV2 = wallDrawV2Ref.current;

  // Kept on a ref so the controller (created once) always commits against the
  // current plan and tool settings rather than the first render's closure.
  wallDrawV2CommitRef.current = (segment) => {
    const base = plan;
    const role = active === "room" ? "outer" : "partition";
    const toolFields = wallFieldsFromTool(activeToolId, role, base.room, wallThk);
    const props = {
      ...defaultWallFields(toolFields.role || role, base.room),
      ...toolFields,
      thk: toolFields.thk ?? (role === "outer" ? (base.room.wallThk || wallThk) : wallThk),
      chainId: uid("ch"),
    };
    // Canonical single-segment pipeline: split/intersection/topology stay in
    // commitDrawnWall, then one materialization + one room sync + one history
    // step, which the autosave effect then observes exactly once.
    const r = commitDrawnWall(base, segment.start, segment.end, props, uid, {
      startIntent: wallDrawV2SnapToTopologyIntent(segment.startSnap, segment.start),
      endIntent: wallDrawV2SnapToTopologyIntent(segment.endSnap, segment.end),
    });
    if (!r.changed) return;
    const next = applyWallCmd(base, {
      plan: r.plan,
      changed: true,
      affectedNodeIds: r.affectedNodeIds || [],
      affectedWallIds: r.affectedWallIds || [],
      warnings: r.warnings || [],
    });
    if (next === base) return;
    commitFrom(base, next);
  };

  /**
   * The wall tool owns the whole pointer sequence in V2 — claimed in the
   * capture phase so no child affordance can take the press first.
   *
   * Wall/node hit areas inside the canvas (WallEl's body path, the mid-node
   * handle) call stopPropagation on pointerdown while the plan is editable, so
   * a drag that STARTS on top of an existing wall never reached the canvas
   * handler. Legacy click-click never noticed: it defers every segment to
   * finishWallChain, so no wall exists yet under the next corner. V2 commits
   * each wall on release, so the following gesture genuinely does start over
   * real geometry — and every closing edge of a rectangle was silently
   * dropped. Claiming the event before the children resolves that and matches
   * the existing contract (wallToolAllowsGeometryDrag() === false).
   */
  const onCanvasPointerDownCapture = (e) => {
    if (!WALL_DRAW_V2 || tool !== "wall") return;
    if (e.button !== 0 || !e.isPrimary) return;
    e.stopPropagation();
    onDown(e);
  };

  /**
   * PHASE 2B2 — the single point authority for V2 wall drawing.
   *
   * Candidates come from collectSnapCandidates (the same collectors the legacy
   * engine uses) and the final point comes from resolveWallPoint, never from
   * runSnapEngine's post-processed result. runSnapEngine keeps ranking, then
   * overwriting its own winner in refineWallDraftSnap and clipWallDraftEnd;
   * on the V2 path exactly one bounded decision is made here, so the point in
   * the preview is the point that reaches commitDrawnWall.
   *
   * No legacy chain state participates: chainStart and prevSegAngleDeg are
   * cleared so close-snap and previous-segment bias cannot fire on a path
   * where every gesture is an independent wall.
   */
  const resolveWallDrawPoint = (raw, { role, from = null }) => resolveWallPoint({
    point: raw,
    from,
    role,
    zoom: view.zoom,
    plan,
    candidateContext: { view, draft: { pts: [], chainStart: null } },
    modifiers: {
      shift: shiftRef.current,
      alt: altSnapRef.current,
      ctrl: ctrlRef.current,
    },
    grid: {
      enabled: display.snapGrid !== false,
      step: snapStep,
      fineStep: 10,
    },
    options: {
      ...wallSnapOptions(),
      chainStart: null,
      prevSegAngleDeg: null,
    },
  });

  /**
   * Adapt resolver metadata onto the existing snap-indicator shape.
   * Display only — no new visual, no CSS: the resolved kind is mapped to the
   * legacy snap type the overlay already knows how to draw.
   */
  const wallDrawV2SnapView = (resolved) => {
    if (!resolved) return null;
    const map = {
      node: { type: "wall-end", label: "узел" },
      "wall-end": { type: "wall-end", label: "узел" },
      "wall-body": { type: "wall-line", label: "на стене" },
      axis: { type: "wall-extension", label: "продолжение" },
      angle: { type: "angle", label: null },
      grid: { type: "grid", label: null },
    };
    const snapView = map[resolved.kind];
    if (!snapView) return null;
    return {
      snapped: true,
      type: snapView.type,
      kind: snapView.type,
      label: snapView.label,
      resolvedKind: resolved.kind,
    };
  };

  /** Metadata carried into the session next to the resolved point. */
  const wallDrawV2Meta = (raw, resolved) => ({
    ...resolved,
    raw: { x: raw.x, y: raw.y },
  });

  /**
   * PHASE 2D — the previewed endpoint is the endpoint that gets committed.
   *
   * resolveWallDrawPoint decides where the cursor wants to land; this then
   * applies the very same first-intersection rule commitDrawnWall applies on
   * release, so a rubber band can no longer run through a wall that the
   * release would have cut it at. The clipped point also carries the topology
   * intent of the wall it stopped on, so the commit reuses that decision
   * instead of making a second one.
   *
   * Guides are dropped once the endpoint has been clipped: they were computed
   * for the point the cursor asked for, which is no longer where the wall ends.
   */
  const clipWallDrawV2End = (start, resolved) => {
    if (!WALL_DRAW_V2 || !start) return resolved;
    const decision = resolveWallDraftEnd(plan, {
      walls: resolvePlanWalls(plan),
      start,
      end: resolved.point,
      endIntentProvided: true,
      endIntent: wallDrawV2SnapToTopologyIntent(resolved, resolved.point),
    });
    if (!decision.clipped || !decision.snapPatch) return resolved;
    return {
      ...resolved,
      ...decision.snapPatch,
      point: decision.point,
      guides: [],
      clip: {
        clipped: true,
        wallId: decision.hostWallId,
        kind: decision.kind,
        t: decision.t,
        reason: decision.reason,
        requestedEnd: decision.requestedEnd,
      },
    };
  };

  /**
   * PHASE 2D / 2F1 — first RMB cancels non-neutral state to Select.
   * Transient only — no plan mutation, no history, no autosave.
   */
  const cancelWallDrawingAndSelect = () => {
    const pointerId = WALL_DRAW_V2 ? wallDrawV2?.getPointerId?.() : null;
    if (pointerId != null) {
      try { svgRef.current?.releasePointerCapture(pointerId); } catch (_) {}
    }
    cancelWallDrawV2();
    clearWallChain();
    wallGestureRef.current = createWallGestureState();
    wallDrawRef.current = null;
    if (wallEdit?.isActive?.()) {
      try { wallEdit.cancel(); } catch (_) {}
    }
    dragRef.current = null;
    setCtxMenu(null);
    setDraftSnap(null);
    setDraftAngleSnap(null);
    setTypedLength("");
    setGuides([]);
    clearAngleMagnet();
    setHoverWallNode(null);
    setSel(null);
    // Close wall inspector / rename if open.
    try { setWallInspectorOpen?.(false); } catch (_) {}
    try { setInspectorOpen?.(false); } catch (_) {}
    try { setRenameTarget?.(null); } catch (_) {}
    handleTool("select");
  };

  const plannerRmbState = () => ({
    selection,
    inspectorOpen: !!wallInspectorOpen,
    ctxMenuOpen: !!ctxMenu,
    dragActive: !!(dragRef.current || wallEdit?.isActive?.()),
    previewActive: !!(WALL_DRAW_V2 && wallDrawV2?.isActive?.()) || !!(draft && draft.length),
    wallDrawActive: tool === "wall" || !!(WALL_DRAW_V2 && wallDrawV2?.isActive?.()),
  });

  /** PHASE 2F2.2 — clear temporary magnets/sectors; no plan/history writes. */
  const clearAngleMagnet = () => {
    angleMagnetSnapRef.current = null;
    setAngleMagnetPreview((prev) => (prev?.active ? emptyAngleMagnetPreview() : prev));
  };

  /** Drop an in-flight V2 gesture (Escape, pointer abort, tool change). */
  const cancelWallDrawV2 = () => {
    if (!WALL_DRAW_V2 || !wallDrawV2?.isActive()) return false;
    wallDrawV2.cancel();
    wallDrawV2MovedRef.current = false;
    setDraftSnap(null);
    setDraftAngleSnap(null);
    clearAngleMagnet();
    return true;
  };

  const applyDrawTypedPreview = (text, { commit = false } = {}) => {
    const parsed = parseLengthInput(text, { bareAsMm: true });
    if (!parsed.ok || !parsed.mm) return false;
    if (!(parsed.mm >= WALL_DRAW_MIN_LEN_MM)) return false;
    if (!(WALL_DRAW_V2 && tool === "wall" && wallDrawV2?.isActive?.())) return false;
    const prev = wallDrawV2.getPreview?.();
    if (!prev?.start || !prev?.end) return false;
    const end = pointAtLengthAlong(prev.start, prev.end, parsed.mm);
    if (!end) return false;
    const txId = wallDrawV2.getTxId();
    wallDrawV2.preview(txId, {
      point: end,
      snap: wallDrawV2Meta(end, { point: end, kind: "typed", guides: prev.endSnap?.guides || null }),
    });
    setCursor(end);
    if (commit && parsed.mm >= 100) {
      wallDrawV2MovedRef.current = true;
      wallDrawV2.commit(txId);
      setTypedLength("");
      setDrawTypedSeed(null);
      setWallDrawV2Preview(null);
      return true;
    }
    return true;
  };

  const applyTypedLength = () => {
    // LIVE3 draw path: bare-as-mm + optional commit on Enter.
    if (WALL_DRAW_V2 && tool === "wall" && wallDrawV2?.isActive?.()) {
      const text = typedLengthRef.current;
      const parsed = parseLengthInput(text, { bareAsMm: true });
      if (!parsed.ok || !(parsed.mm >= 100)) return false;
      // Preserve active magnet direction when length is typed during snap.
      const prev = wallDrawV2.getPreview?.();
      if (prev?.start && angleMagnetSnapRef.current != null && Number.isFinite(angleMagnetSnapRef.current)) {
        const end = pointAtMagnetLength(prev.start, angleMagnetSnapRef.current, parsed.mm);
        if (end) {
          const txId = wallDrawV2.getTxId();
          wallDrawV2.preview(txId, {
            point: end,
            snap: wallDrawV2Meta(end, { point: end, kind: "typed", guides: [] }),
          });
          setCursor(end);
          wallDrawV2MovedRef.current = true;
          wallDrawV2.commit(txId);
          setTypedLength("");
          setDrawTypedSeed(null);
          setWallDrawV2Preview(null);
          clearAngleMagnet();
          return true;
        }
      }
      applyDrawTypedPreview(text, { commit: true });
      clearAngleMagnet();
      return true;
    }
    const parsed = parseLengthInput(typedLengthRef.current);
    if (!parsed.ok || !parsed.mm) return false;
    if (draft.length < 1 || !cursor) return false;
    const from = draft[draft.length - 1];
    const { pt, angleSnap } = computeDraftPt(cursor, from);
    const ang = angleSnap?.snappedAngle ?? angleBetweenDeg(from, pt);
    const end = {
      x: from.x + Math.cos((ang * Math.PI) / 180) * parsed.mm,
      y: from.y + Math.sin((ang * Math.PI) / 180) * parsed.mm,
    };
    // Preview first: move cursor to exact end. Second Enter / click commits
    // via the normal chain path. If already at that length (±0.5 mm), commit.
    const curLen = Math.hypot(pt.x - from.x, pt.y - from.y);
    if (Math.abs(curLen - parsed.mm) > 0.5) {
      setCursor(end);
      setTypedLength("");
      return true;
    }
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

  /**
   * PHASE 2F1 — keys that identify or place ONE record. Everything else is a
   * property of the wall the user sees, and a wall the user sees may be several
   * collinear segments split by T junctions (see resolveLogicalWallChain): the
   * type/thickness/height/lock of a host must never end up different on the two
   * sides of a partition.
   */
  const WALL_PER_SEGMENT_KEYS = new Set(["id", "a", "b", "pts", "chainId"]);

  const updateObj = (coll, oid, patch) => {
    setPlan((p) => {
      const list = Array.isArray(p[coll]) ? p[coll] : [];
      if (coll === "dimensions" && !list.some((o) => o.id === oid)) return p;
      const targetIds = coll === "walls"
        && Object.keys(patch || {}).every((key) => !WALL_PER_SEGMENT_KEYS.has(key))
        ? new Set(resolveLogicalWallChain(p, oid).wallIds)
        : new Set([oid]);
      let next = {
        ...p,
        [coll]: list.map((o) => (targetIds.has(o.id) ? { ...o, ...patch } : o)),
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
    // PHASE 2E FOLLOW-UP 1 (M4) — deleting a wall, together with the collinear
    // host heal it triggers, is ONE explicit history checkpoint.
    //
    // Originally this also worked around HistoryModel.skipNext, the global
    // suppression flag that reset()/commitFrom() left armed for the next
    // mutation. PHASE 2E.1 removed that flag (mutation origin is now declared
    // per call), so a plain setPlan would checkpoint here too — but the explicit
    // commit stays: it is the single checkpoint that spans delete + host heal.
    const applyDelete = coll === "walls" ? commitPlan : setPlan;
    applyDelete((p) => {
      let next = { ...p };
      if (coll === "items") {
        const idSet = new Set(ids);
        next.items = p.items.filter((o) => !idSet.has(o.id));
        next.links = (p.links || []).filter((l) => !idSet.has(l.fromId) && !idSet.has(l.toId));
      } else if (coll === "walls") {
        const id = ids[0];
        if (isNetworkPlan(p)) {
          const wall = (p.walls || []).find((w) => w.id === id);
          const nidx = selection?.nodeIdx;
          if (wall && nidx != null && nidx >= 0) {
            const nodeId = nidx === 0 ? wall.a : wall.b;
            next = applyWallCmd(p, deleteNode(p, nodeId));
          } else {
            next = applyWallCmd(p, deleteWall(p, id));
          }
        } else {
          next.walls = p.walls.filter((o) => o.id !== id);
          next.items = refreshWallMountedItems(next.items, resolvePlanWalls(next), next.room, id);
          next = syncAutoZones(next);
        }
      } else if (coll === "rulers") {
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
      if (coll === "items" || coll === "lines") {
        next = syncEngineeringPlan(next);
      }
      return next;
    });
    clearSelection();
    return true;
  }, [plan.zones]);

  const delSel = () => {
    if (!selection?.ids?.length) return;
    // PHASE 2F1 — deleting the selected wall deletes the LOGICAL wall: leaving
    // the far half of a T-split host behind would be a silent partial delete.
    if (selection.coll === "walls") {
      const ids = new Set();
      for (const id of selection.ids) {
        for (const memberId of resolveLogicalWallChain(plan, id).wallIds) ids.add(memberId);
      }
      deleteHits("walls", [...ids]);
      return;
    }
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
    const meta = wallDraftFinishMeta(wallDraftStateRef.current) || (
      draft.length >= 2 ? { pts: draft, closed: false } : null
    );
    const pts = meta?.pts;
    const closed = meta?.closed === true;
    if (!pts || pts.length < 2) {
      clearWallChain();
      return;
    }
    const role = active === "room" ? "outer" : "partition";
    commitPlan((p) => {
      const toolFields = wallFieldsFromTool(activeToolId, role, p.room, wallThk);
      const props = {
        ...defaultWallFields(toolFields.role || role, p.room),
        ...toolFields,
        thk: toolFields.thk ?? (role === "outer" ? (p.room.wallThk || wallThk) : wallThk),
        chainId: uid("ch"),
      };
      let chainPts = pts.map((pt) => ({ x: pt.x, y: pt.y }));
      if (closed && chainPts.length >= 3) chainPts = [...chainPts, { ...chainPts[0] }];

      let next = p;
      let anyChanged = false;
      const warnings = [];
      const affectedWallIds = [];
      const affectedNodeIds = [];
      for (let i = 0; i < chainPts.length - 1; i++) {
        const r = commitDrawnWall(next, chainPts[i], chainPts[i + 1], props, uid);
        next = r.changed ? r.plan : next;
        anyChanged = anyChanged || r.changed;
        warnings.push(...(r.warnings || []));
        if (r.changed) {
          affectedWallIds.push(...(r.affectedWallIds || []));
          affectedNodeIds.push(...(r.affectedNodeIds || []));
          // Subsequent chain points: if this segment stopped at first hit, stop the chain.
          if (r.meta?.firstIntersection && i < chainPts.length - 2) {
            break;
          }
        }
      }
      if (!anyChanged) return p;

      return applyWallCmd(p, {
        plan: next,
        changed: true,
        affectedNodeIds: [...new Set(affectedNodeIds)],
        affectedWallIds: [...new Set(affectedWallIds)],
        warnings,
      });
    });
    wallGestureRef.current = wallGestureMarkCommitted(wallGestureRef.current);
    clearWallChain();
    // Keep suppress flag after clearWallChain reset.
    wallGestureRef.current = { ...createWallGestureState(), suppressNextClick: true };
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

  const resolveDimAnchorAt = (nodes, pt) => {
    const nodeId = findNodeIdAt(nodes || {}, pt, NODE_LINK_THR);
    if (nodeId) return { type: "node", nodeId };
    return { type: "free", point: { x: pt.x, y: pt.y } };
  };

  const commitDimension = (p1, p2, offsetPoint, kind = measureKind) => {
    if (!p1 || !p2) return;
    if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 20) return;
    const orientation = Math.abs(p2.x - p1.x) >= Math.abs(p2.y - p1.y) ? "horizontal" : "vertical";
    const offset = offsetPoint ? dimensionOffsetFromPoint(p1, p2, offsetPoint) : 120;
    const mode = kind === "diagonal" ? "diagonal" : "linear";
    setPlan((p) => ({
      ...p,
      dimensions: [
        ...(p.dimensions || []),
        {
          id: uid("dim"),
          type: "dimension",
          mode,
          p1: { x: p1.x, y: p1.y },
          p2: { x: p2.x, y: p2.y },
          offset,
          orientation,
          attachedTo: null,
          labelOverride: null,
          locked: false,
          auto: false,
          visible: true,
          anchors: [
            resolveDimAnchorAt(p.nodes, p1),
            resolveDimAnchorAt(p.nodes, p2),
          ],
        },
      ],
    }));
  };

  const commitAngleDimension = (vertex, ray1, ray2) => {
    if (!vertex || !ray1 || !ray2) return;
    if (Math.hypot(ray1.x - vertex.x, ray1.y - vertex.y) < 20) return;
    if (Math.hypot(ray2.x - vertex.x, ray2.y - vertex.y) < 20) return;
    setPlan((p) => {
      const a0 = resolveDimAnchorAt(p.nodes, vertex);
      const a1 = resolveDimAnchorAt(p.nodes, ray1);
      const a2 = resolveDimAnchorAt(p.nodes, ray2);
      const dim = createAngleDimension({
        id: uid("dim"),
        vertexNodeId: a0.type === "node" ? a0.nodeId : null,
        rayNodeId1: a1.type === "node" ? a1.nodeId : null,
        rayNodeId2: a2.type === "node" ? a2.nodeId : null,
      });
      return {
        ...p,
        dimensions: [
          ...(p.dimensions || []),
          {
            ...dim,
            auto: false,
            visible: true,
            vertex: { ...vertex },
            rayPoint1: { ...ray1 },
            rayPoint2: { ...ray2 },
            anchors: [a0, a1, a2],
          },
        ],
      };
    });
  };

  const applyDimensionEdit = (dimId, value) => {
    const dim = (plan.dimensions || []).find((d) => d.id === dimId);
    if (!dim) return;
    if (dim.attachedTo?.type === "wall" || dim.attachedTo?.type === "item") {
      // TODO: change attached geometry/object by typed dimension value.
      window.alert("Изменение геометрии по связанному размеру будет добавлено следующим шагом.");
      return;
    }
    setPlan((p) => ({
      ...p,
      dimensions: (p.dimensions || []).map((d) => (d.id === dimId ? { ...d, labelOverride: value } : d)),
    }));
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
    setPlan((p) => {
      const wall = (p.walls || []).find((w) => w.id === wid);
      if (!wall?.a || !isNetworkPlan(p)) {
        const plan = nudgeWallInPlan(p, wid, nidx, dx, dy, fineMm);
        const resolved = resolvePlanWalls(plan);
        return syncAutoZones({
          ...plan,
          items: refreshWallMountedItems(p.items, resolved, p.room, wid),
        });
      }
      const rw = resolvePlanWalls(p).find((w) => w.id === wid);
      if (!rw?.pts?.length) return p;
      if (nidx != null && nidx >= 0) {
        const nodeId = nidx === 0 ? wall.a : wall.b;
        const pt = rw.pts[nidx];
        if (!nodeId || !pt) return p;
        return applyWallCmd(p, moveNode(p, nodeId, { x: fineMm(pt.x + dx), y: fineMm(pt.y + dy) }));
      }
      // PHASE 2C3A — arrows use the SAME topology-safe command as the mouse.
      // The previous per-node loop translated shared T-junction nodes directly,
      // so keyboard movement could still bend hosts after the mouse path had
      // been made safe. A fail-closed result leaves the plan (and therefore
      // history and autosave) untouched.
      const nudgeChain = resolveLogicalWallChain(p, wid);
      const moved = nudgeChain.segmentCount > 1
        ? moveLogicalWallChain(p, {
          wallId: wid,
          delta: { x: fineMm(dx), y: fineMm(dy) },
          expectedChainWallIds: nudgeChain.wallIds,
          makeId: uid,
        })
        : moveWallSegment(p, {
          wallId: wid,
          delta: { x: fineMm(dx), y: fineMm(dy) },
          expectedEndpointAttachments: classifyWallSegmentAttachments(p, wid),
          makeId: uid,
        });
      if (EXPOSE_PLANNER_E2E) {
        geomProbeRef.current.lastWallMoveResult = {
          input: "arrow",
          wallId: wid,
          changed: !!moved.changed,
          reason: moved.reason || null,
          warnings: [...(moved.warnings || [])],
          effectiveDelta: moved.movement?.delta || null,
        };
      }
      if (!moved.changed) return p;
      return applyWallCmd(p, moved);
    });
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

  const railActiveToolId = resolveRailActiveToolId({
    tool,
    activeToolId,
    measureKind,
    activeCategoryId,
    activeSheetId,
  });

  const handleRailToolSelect = (toolKey) => {
    if (toolKey === "select") {
      handleTool("select");
      setDrawerOpen(false);
      return;
    }
    if (toolKey === "pan") {
      handleTool("pan");
      setDrawerOpen(false);
      return;
    }
    if (toolKey === "measure" || toolKey === "measure_linear") {
      setMeasureKind("linear");
      handleToolPick(resolveTool("measure"));
      setDrawerOpen(false);
      return;
    }
    if (toolKey === "measure_diagonal") {
      setMeasureKind("diagonal");
      handleToolPick(resolveTool("measure"));
      setDrawerOpen(false);
      return;
    }
    if (toolKey === "measure_angular") {
      setMeasureKind("angle");
      handleToolPick(resolveTool("measure"));
      setDrawerOpen(false);
      return;
    }
    if (toolKey === "wall") {
      applySheet(sheetById("base_plan"), "walls");
      handleToolPick(resolveTool("wall_draw"));
      setDrawerOpen(false);
      return;
    }
    if (toolKey === "door") {
      applySheet(sheetById("base_plan"), "openings");
      handleToolPick(resolveTool("door_std"));
      setDrawerOpen(false);
      return;
    }
    if (toolKey === "window") {
      applySheet(sheetById("base_plan"), "openings");
      handleToolPick(resolveTool("window_std"));
      setDrawerOpen(false);
      return;
    }
    if (toolKey === "zones") {
      applySheet(sheetById("farm_zones"), "zones");
      setDrawerOpen(false);
      return;
    }
    if (toolKey === "objects" || toolKey === "engineering") {
      // Group parent click only opens popover in rail — no tool change.
      return;
    }
    const def = resolveTool(toolKey);
    if (def) {
      if (def.categories?.includes("racks") || def.kind === "rack" || def.kind === "seed_rack") {
        applySheet(sheetById("racks"), "racks");
      } else if (["power", "water", "drain", "light", "vent", "climate", "ac"].some((c) => def.categories?.includes(c))) {
        applySheet(sheetById("electrical"), "power");
      }
      handleToolPick(def);
      setDrawerOpen(false);
    }
  };

  const handleRailEscape = () => {
    handleTool("select");
    setDrawerOpen(false);
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
    if (st.tool === "wall") clearSelection();
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
    clearAngleMagnet();
    if (t === "select") setActiveToolId("select");
    else if (t === "measure") setActiveToolId("measure");
    else if (t === "pan") setActiveToolId("pan");
    else if (t === "wall") setActiveToolId((id) => (String(id || "").startsWith("wall") ? id : "wall_draw"));
    else if (t === "erase") setActiveToolId("erase");
    else if (t === "label") setActiveToolId("label");
    if (t === "wall" || t === "line") clearWallChain();
    // Wall drawing owns the pointer — drop any leftover select highlight/drag target.
    if (t === "wall") clearSelection();
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

  const markViewportManual = () => {
    viewportManualRef.current = true;
  };

  const fitView = (reason = "fit-button") => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || r.width < 40 || r.height < 40) return null;
    // SVG is already inset by topbar/rail/inspector on the left/top/right,
    // but the bottom toolbar (.planner-bottom-bar) and floating zoom
    // controls (.planner-viewport-controls-wrap) are positioned OVER the
    // canvas rather than shrinking it, so the SVG's own bounding rect still
    // reports the full height underneath them. Measure their actual overlap
    // with the SVG's bottom edge and inset Fit by that amount (plus a small
    // safety margin) so wall geometry and promoted dimensions never land
    // under the bottom panel.
    const root = svgRef.current?.closest(".planner-app");
    let bottomInset = 0;
    if (root) {
      const overlays = root.querySelectorAll(".planner-bottom-bar, .planner-viewport-controls-wrap");
      overlays.forEach((el) => {
        const er = el.getBoundingClientRect();
        if (er.height <= 0) return;
        const overlap = r.bottom - er.top;
        if (overlap > bottomInset) bottomInset = overlap;
      });
      if (bottomInset > 0) bottomInset += 12;
    }
    // Include the auto-generated runtime dimensions (external_overall,
    // wall_length, internal_clear, ...) in the framed bounds so their
    // labels -- offset outside the raw wall geometry -- land inside the
    // viewport on Fit instead of rendering off-canvas.
    let bounds = computePlanContentBounds(plan, { extraDimensions: runtimeDimensions });
    // An empty plan has no content, and computePlanContentBounds answers with a
    // 1000x1000mm placeholder. Fitting THAT to the viewport lands on zoom ~0.76,
    // where the whole canvas spans about 1.5m: the user then draws a rectangle
    // that looks room-sized but is really ~400mm, and its dimensions correctly
    // read "389 мм" instead of "3.89 м". Frame the sheet instead, which is the
    // scale PLANNER_DEFAULT_ZOOM already assumes.
    if (!bounds || bounds.empty || !bounds.count) {
      const rw = Number(plan?.room?.w) || 12000;
      const rh = Number(plan?.room?.h) || 8000;
      bounds = {
        minX: 0, minY: 0, x: 0, y: 0, maxX: rw, maxY: rh,
        width: rw, height: rh, count: 1, empty: false,
      };
    }
    const next = computeFitTransform({
      plan,
      bounds,
      width: r.width,
      height: r.height,
      insets: { top: 0, right: 0, bottom: bottomInset, left: 0 },
      padding: Math.min(48, Math.min(r.width, r.height) * 0.05),
      reason,
    });
    setView({ zoom: next.zoom, panX: next.panX, panY: next.panY });
    if (reason === "fit-button" || reason === "reset" || reason === "import" || reason === "open") {
      viewportManualRef.current = false;
      viewportFittedRef.current = true;
    }
    return next;
  };

  const fitActiveLayer = () => {
    const b = boundsForActiveLayer(plan, active);
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    if (!b) {
      fitView("fit-button");
      return;
    }
    const m = 120;
    const z = clamp(Math.min((r.width - m) / b.w, (r.height - m) / b.h), 0.015, 3);
    setView({
      zoom: z,
      panX: (r.width - b.w * z) / 2 - b.x * z,
      panY: (r.height - b.h * z) / 2 - b.y * z,
    });
    viewportManualRef.current = false;
  };

  const centerView = () => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    setView((v) => ({
      ...v,
      panX: (r.width - plan.room.w * v.zoom) / 2,
      panY: (r.height - plan.room.h * v.zoom) / 2,
    }));
    markViewportManual();
  };

  const plannerIdentity = useMemo(
    () => ({ mode: standalone ? "standalone" : "project", id: standalone ? draftId : id }),
    [standalone, draftId, id],
  );
  const planHasGeometry = useMemo(() => !computePlanContentBounds(plan).empty, [plan]);

  useEffect(() => {
    if (saveUiStatus === "hydrating") return;
    const previous = viewportAutoStateRef.current;
    const nextState = {
      identity: plannerIdentity,
      hasGeometry: planHasGeometry,
      manual: viewportManualRef.current,
      fitted: viewportFittedRef.current,
    };
    if (!shouldAutoFitPlan(previous, nextState, "open")) {
      viewportAutoStateRef.current = nextState;
      return undefined;
    }
    let cancelled = false;
    const run = () => {
      if (cancelled || viewportManualRef.current) return;
      fitView("open");
      viewportAutoStateRef.current = {
        identity: plannerIdentity,
        hasGeometry: planHasGeometry,
        manual: false,
        fitted: true,
      };
    };
    const id1 = requestAnimationFrame(() => requestAnimationFrame(run));
    const t1 = setTimeout(run, 80);
    const t2 = setTimeout(run, 240);
    return () => {
      cancelled = true;
      cancelAnimationFrame(id1);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [plannerIdentity, saveUiStatus, planHasGeometry]); // eslint-disable-line react-hooks/exhaustive-deps

  const setZoomTo = (nz) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const cx = r.width / 2;
    const cy = r.height / 2;
    const mmx = (cx - view.panX) / view.zoom;
    const mmy = (cy - view.panY) / view.zoom;
    const z = clamp(nz, 0.015, 3);
    setView({ zoom: z, panX: cx - mmx * z, panY: cy - mmy * z });
    markViewportManual();
  };

  const clearSheet = () => {
    const name = layerById(active).name;
    if (!window.confirm(`Очистить объекты листа «${name}»?`)) return;
    setPlan((p) => {
      const next = { ...p };
      if (active === "partitions") next.walls = p.walls.filter((w) => w.role === "outer");
      else if (active === "room") next.items = p.items.filter((i) => i.layer !== "room");
      else if (LINE_LAYER_IDS.includes(active)) next.lines = p.lines.filter((l) => l.layer !== active && migrateLayerId(l.layer) !== active);
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
          let r1 = moveNode(p, obj.a, nw.pts[0]);
          let r2 = moveNode(r1.plan, obj.b, nw.pts[1]);
          return applyWallCmd(p, {
            plan: r2.plan,
            changed: r1.changed || r2.changed,
            affectedNodeIds: [...r1.affectedNodeIds, ...r2.affectedNodeIds],
            affectedWallIds: [...new Set([...r1.affectedWallIds, ...r2.affectedWallIds])],
            warnings: [...r1.warnings, ...r2.warnings],
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
          const r1 = moveNode(p, obj.a, nw.pts[0]);
          const r2 = moveNode(r1.plan, obj.b, nw.pts[1]);
          return applyWallCmd(p, {
            plan: r2.plan,
            changed: r1.changed || r2.changed,
            affectedNodeIds: [...r1.affectedNodeIds, ...r2.affectedNodeIds],
            affectedWallIds: [...new Set([...r1.affectedWallIds, ...r2.affectedWallIds])],
            warnings: [...r1.warnings, ...r2.warnings],
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
      setPlan((p) => {
        const next = straightenWallEdge(p, obj.id, "h");
        const resolved = resolvePlanWalls(next);
        return syncAutoZones({
          ...next,
          items: refreshWallMountedItems(p.items, resolved, p.room, obj.id),
        });
      });
    }
    else if (actionId === "wall-straight-v" && sel.coll === "walls") {
      setPlan((p) => {
        const next = straightenWallEdge(p, obj.id, "v");
        const resolved = resolvePlanWalls(next);
        return syncAutoZones({
          ...next,
          items: refreshWallMountedItems(p.items, resolved, p.room, obj.id),
        });
      });
    }
    else if (actionId === "wall-align" && sel.coll === "walls") {
      setPlan((p) => {
        const next = alignWallEdgeToNeighbor(p, obj.id);
        if (!next) {
          window.alert("Нет соседней стены с общим узлом для выравнивания.");
          return p;
        }
        const resolved = resolvePlanWalls(next);
        return syncAutoZones({
          ...next,
          items: refreshWallMountedItems(p.items, resolved, p.room, obj.id),
        });
      });
    }
    else if (actionId === "wall-merge" && sel.coll === "walls") {
      setPlan((p) => {
        const res = tryMergeWallEdge(p, obj.id);
        if (!res) {
          window.alert("Не найдена соседняя стена с общим узлом для объединения.");
          return p;
        }
        const resolved = resolvePlanWalls(res.plan);
        return syncAutoZones({
          ...res.plan,
          items: refreshWallMountedItems(p.items, resolved, p.room),
        });
      });
      setSel({ coll: "walls", id: obj.id });
    }
    else if (actionId === "wall-break" && sel.coll === "walls") {
      const mm = ctxMenuRef.current?.mm;
      if (!mm) return;
      setPlan((p) => {
        const r = splitWall(p, obj.id, mm, uid);
        if (!r.changed) {
          window.alert(r.warnings?.[0]?.message || "Не удалось разорвать стену — кликните ближе к сегменту.");
          return p;
        }
        const newId = r.affectedWallIds.find((id) => id !== obj.id) || r.affectedWallIds[0];
        if (newId) setSel({ coll: "walls", id: newId });
        return applyWallCmd(p, r, { refreshMounted: false });
      });
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
    // PHASE 2F1 — first RMB cancels any non-neutral state; no menu opens.
    const contextAction = contextMenuActionFor(tool, active, plannerRmbState());
    if (contextAction === CONTEXT_MENU_ACTION.NONE) return;
    if (contextAction === CONTEXT_MENU_ACTION.CANCEL_AND_SELECT) {
      e.preventDefault();
      cancelWallDrawingAndSelect();
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
      if (isEditableTarget(e.target)) return;
      if (e.key === "Shift") shiftRef.current = true;
      if (e.key === "Control") { ctrlRef.current = true; setCtrlSnapFine(true); }
      if (e.key === "Alt") { altSnapRef.current = true; setAltSnapOff(true); }
      if (e.key === " " && document.activeElement === document.body) { e.preventDefault(); setSpacePan(true); }
      if (e.key === "Escape") {
        // V2 drawing: drop the rubber band, keep the wall tool active and the
        // committed plan/history/autosave untouched.
        if (WALL_DRAW_V2 && wallDrawV2.isActive()) {
          e.preventDefault();
          // LIVE3: first Escape cancels numeric entry; second cancels the draft.
          if (typedLengthRef.current) {
            setTypedLength("");
            setDrawTypedSeed(null);
            return;
          }
          cancelWallDrawV2();
          return;
        }
        // An in-flight wall/node drag is the most immediate modal state: drop
        // the transient preview, committed plan/history/autosave untouched.
        if (wallEdit.isActive()) {
          e.preventDefault();
          wallEdit.cancel();
          dragRef.current = null;
          setHoverWallNode(null);
          setGuides([]);
          clearAngleMagnet();
          return;
        }
        if (labelDraft) { cancelLabelDraft(); return; }
        // PHASE 2D: Escape closes the wall editor first and keeps the wall
        // selected. Transient UI only — no plan, history or autosave change.
        if (floatEditorOpen) {
          e.preventDefault();
          closeFloatEditor();
          return;
        }
        if (wallInspectorOpen) {
          e.preventDefault();
          closeWallInspector();
          return;
        }
        // Drawer first: Esc closes inspector without cancelling canvas tool.
        if (drawerOpen) {
          e.preventDefault();
          setDrawerOpen(false);
          return;
        }
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
          setTool("select");
          setActiveToolId("select");
          return;
        }
        clearWallChain(); setMeasure([]); clearSelection(); setGuides([]);
        setTool("select"); setActiveToolId("select"); setPending(null); setTypedLength(""); setDraftSnap(null);
        setMarquee(null);
      }
      if (e.key === "Enter") {
        // Floating length editor focus when a wall is selected (not while typing in an input).
        if (
          tool === "select"
          && selection?.coll === "walls"
          && selection.ids?.[0]
          && document.activeElement === document.body
        ) {
          e.preventDefault();
          setFloatEditorOpen(true);
          setFloatFocusReq((n) => n + 1);
          return;
        }
        // V2: Enter applies typed preview length; release still commits the wall.
        if (WALL_DRAW_V2 && tool === "wall") {
          if (typedLengthRef.current) {
            e.preventDefault();
            applyTypedLength();
          }
          return;
        }
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
          commitDimension(measure[0], measure[1], measureOffsetPt, measureKind);
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
      if (
        (/^\d$/.test(e.key) || e.key === "." || e.key === ",")
        && tool === "select"
        && selection?.coll === "walls"
        && selection.ids?.[0]
        && document.activeElement === document.body
      ) {
        e.preventDefault();
        setFloatEditorOpen(true);
        setFloatFocusReq((n) => n + 1);
        return;
      }
      if (
        (/^\d$/.test(e.key) || e.key === "." || e.key === ",")
        && (tool === "wall" || tool === "line")
        && (draft.length >= 1 || (WALL_DRAW_V2 && tool === "wall" && wallDrawV2?.isActive?.()))
      ) {
        e.preventDefault();
        const ch = e.key === "," ? "." : e.key;
        setTypedLength((s) => {
          const next = s + ch;
          setDrawTypedSeed(next);
          if (WALL_DRAW_V2 && tool === "wall" && wallDrawV2?.isActive?.()) {
            // Immediate preview along current direction (bare mm).
            queueMicrotask(() => applyDrawTypedPreview(next, { commit: false }));
          }
          return next;
        });
      }
      // Allow typing unit suffix letters for metres while drafting.
      if ((e.key === "m" || e.key === "M" || e.key === "м" || e.key === "М")
        && (tool === "wall" || tool === "line") && typedLengthRef.current) {
        e.preventDefault();
        setTypedLength((s) => {
          const next = `${s} м`;
          setDrawTypedSeed(next);
          if (WALL_DRAW_V2 && tool === "wall" && wallDrawV2?.isActive?.()) {
            queueMicrotask(() => applyDrawTypedPreview(next, { commit: false }));
          }
          return next;
        });
      }
      if (e.key === "Backspace" && typedLengthRef.current && (tool === "wall" || tool === "line")) {
        e.preventDefault();
        setTypedLength((s) => {
          const next = s.slice(0, -1);
          setDrawTypedSeed(next || null);
          if (next && WALL_DRAW_V2 && tool === "wall" && wallDrawV2?.isActive?.()) {
            queueMicrotask(() => applyDrawTypedPreview(next, { commit: false }));
          }
          return next;
        });
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
      // Undo/Redo match the PHYSICAL key, so the shortcuts work on any layout.
      // Both branches call the same actions the toolbar buttons use, and each
      // keydown performs exactly one history operation.
      const historyAction = matchHistoryShortcut(e);
      if (historyAction) {
        e.preventDefault();
        if (historyAction === "undo") undo(); else redo();
      }
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
    const onWindowBlur = () => {
      // PHASE 2F2.2 — magnets/sectors are interaction-only; never survive blur.
      clearAngleMagnet();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
    };
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
      const { plan: normalized, diagnostics } = normalizePlanResult(imported);
      resetHistory(normalized);
      setRoomDetectionDiagnostic(diagnostics[0] || null);
      setRoomDiagnosticDismissed(false);
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
    // PHASE 2D — double click is the ONLY way to open wall properties.
    //
    // Handled here, at the canvas level, rather than inside the wall element:
    // once a wall is selected its move hit-area covers the whole body, so the
    // second press of a double click is delivered there and never reaches
    // selectWall's e.detail check. The dblclick event still bubbles to the
    // svg from whichever child received it, which is also why this works
    // uniformly over the outline, the hatch and the transparent hit area.
    const dblHit = tool === "select" ? pickPlanHit(toMM(e.clientX, e.clientY)) : null;
    if (wallDoubleClickOpensInspector({ tool, hitColl: dblHit?.coll })) {
      setSel({ coll: "walls", id: dblHit.id });
      openWallInspector();
      return;
    }
    // V2 has no chain to complete: a double click must never add a wall.
    if (WALL_DRAW_V2 && tool === "wall") return;
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
      e.stopPropagation();
      e.preventDefault();
      try { svgRef.current.setPointerCapture(e.pointerId); } catch (_) {}
      if (WALL_DRAW_V2) {
        // Primary button only; a new press always starts a brand-new wall.
        if (!e.isPrimary) return;
        const resolved = resolveWallDrawPoint(mm, { role: "start" });
        wallDrawV2MovedRef.current = false;
        wallDrawV2.begin({
          point: resolved.point,
          snap: wallDrawV2Meta(mm, resolved),
          pointerId: e.pointerId,
          now: Date.now(),
        });
        setDraftSnap(wallDrawV2SnapView(resolved));
        setDraftAngleSnap(null);
        setCursor(resolved.point);
        return;
      }
      if (EXPOSE_PLANNER_E2E) {
        geomProbeRef.current.wallGestureLog.push({
          tag: "ENTER", t: Date.now(),
          ptsLen: wallDraftStateRef.current?.pts?.length ?? -1,
          gesturePhase: wallGestureRef.current?.phase,
          pointerId: e.pointerId,
        });
      }

      const wallsNow = resolvePlanWalls(plan);
      const bodyHit = pickWallBodyHit(mm, wallsNow, plan.room);
      const hostWallId = bodyHit?.wall?.id || null;

      // Read the chain tip from the ref, not the `draft` React state array.
      // wallDraftStateRef.current is updated synchronously by
      // addWallDraftSegment/clearWallChain; `draft` is only updated by the
      // matching setDraft call, which React may not have committed yet by the
      // time the NEXT pointerdown fires under rapid clicking. Reading the
      // stale state array then made this click look like the very first of a
      // brand new chain (chainFrom wrongly null) even mid-rectangle, dropping
      // segments and — worse — leaving the previous, unfinished draft to be
      // silently picked up again by a LATER click, producing a false diagonal
      // between two otherwise-unrelated rectangles.
      const draftPts = wallDraftStateRef.current?.pts || [];
      const chainFrom = draftPts.length >= 1 ? draftPts[draftPts.length - 1] : null;
      // Seed gesture from existing chain tip so second click can commit.
      if (chainFrom && wallGestureRef.current.phase === "idle") {
        wallGestureRef.current = {
          ...createWallGestureState(),
          phase: "pending",
          start: chainFrom,
          end: chainFrom,
          hostWallId: null,
          screenX: e.clientX,
          screenY: e.clientY,
          startedAt: Date.now(),
          buttonDown: false,
        };
      }

      const gesture = wallGesturePointerDown(wallGestureRef.current, {
        point: mm,
        screenX: e.clientX,
        screenY: e.clientY,
        now: Date.now(),
        hostWallId,
      });
      wallGestureRef.current = gesture.state;
      if (EXPOSE_PLANNER_E2E) {
        geomProbeRef.current.wallGestureLog.push({
          t: Date.now(), action: gesture.action, point: mm, hostWallId, chainFrom,
        });
      }

      if (gesture.action === "suppress") {
        return;
      }

      if (gesture.action === "open-properties" && gesture.wallId) {
        clearWallChain();
        setSel({ coll: "walls", id: gesture.wallId });
        setPropsTab("props");
        return;
      }

      if (gesture.action === "commit" && gesture.start && gesture.end) {
        // Every corner placed by a discrete click (not a real-time drag
        // preview) shares the freshChainOrigin tight vertex radius: a
        // rectangle's later corners can land just as close (~700mm at a
        // whole-plan zoom) to an unrelated, already-closed shape's node as
        // its first corner can — see the freshChainOrigin comment in
        // snapEngine.js.
        const { pt, snap, fromAdjust } = computeWallSnap(gesture.end, gesture.start, { freshChainOrigin: true });
        const start = fromAdjust || gesture.start;
        // Closing a chain by clicking back on its own start point (no drag —
        // this is the pure click-click-click drawing flow) must close the
        // chain exactly like the drag-release path below already does. This
        // check was missing here: computeWallSnap correctly recognised the
        // click as snap.kind === "close", but this branch only ever tested
        // endsOnWall/!chainFrom, neither of which is true for a closing click
        // on a chain's own start point (no host wall exists yet on a plan's
        // first chain, and chainFrom is always truthy at that point). The
        // chain therefore never closed: draft kept accumulating forever,
        // walls were never committed, and the next rectangle's first click
        // was silently absorbed as a continuation of the still-open chain —
        // producing the false diagonal between consecutive shapes.
        if (snap?.kind === "close" && wallChainStartRef.current) {
          const closeEnd = { x: wallChainStartRef.current.x, y: wallChainStartRef.current.y };
          addWallDraftSegment(start, closeEnd, fromAdjust);
          wallDraftStateRef.current = { ...wallDraftStateRef.current, closedLoop: true };
          finishWallChain();
          return;
        }
        if (Math.hypot(pt.x - start.x, pt.y - start.y) >= WALL_DRAW_MIN_LEN_MM) {
          addWallDraftSegment(start, pt, fromAdjust);
          setDraftSnap(snap);
          const hitKind = snap?.kind || snap?.type;
          const endsOnWall = hitKind === "wall-first-hit"
            || hitKind === "wall-t-end"
            || hitKind === "wall-end"
            || hitKind === "WALL_LINE"
            || hitKind === "WALL_MID"
            || hitKind === "WALL_END"
            || snap?.firstIntersection
            || snap?.kind === "wall-first-hit"
            || !!hostWallId;
          if (endsOnWall || !chainFrom) {
            finishWallChain();
          } else {
            wallDrawRef.current = null;
            wallGestureRef.current = {
              ...createWallGestureState(),
              phase: "pending",
              start: pt,
              end: pt,
              screenX: e.clientX,
              screenY: e.clientY,
              startedAt: Date.now(),
            };
            setDraft((d) => (d.length ? d : [pt, pt]));
          }
        }
        return;
      }

      // start-pending / restart-pending
      let from;
      if (chainFrom && gesture.action !== "restart-pending") {
        from = chainFrom;
        wallDraftStateRef.current = wallDraftContinueFrom(wallDraftStateRef.current, from);
      } else {
        // A brand-new, unconnected chain origin (no draft continuation
        // context yet) must not use the generous, screen-invariant vertex
        // magnet meant for actively continuing a draft — see the
        // freshChainOrigin comment in snapEngine.js.
        const computed = computeWallSnap(mm, null, { freshChainOrigin: true });
        from = computed.pt;
        wallChainStartRef.current = from;
        wallDraftStateRef.current = wallDraftStart(createWallDraftState(), from);
        setDraftSnap(computed.snap);
        wallGestureRef.current = {
          ...wallGestureRef.current,
          start: from,
          end: from,
          hostWallId,
        };
      }
      wallDrawRef.current = { from };
      setDraft((d) => (chainFrom && gesture.action !== "restart-pending" ? d : [from, from]));
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
      if (measureKind === "angle") {
        if (!st) {
          const { pt, snap, guides: snapGuides = [] } = computeRulerPt(mm);
          measureDrawRef.current = { stage: 1, vertex: pt };
          setMeasure([pt]);
          setMeasureOffsetPt(null);
          setRulerSnap(snap);
          setGuides(snapGuides);
          return;
        }
        if (st.stage === 1) {
          const { pt, snap, guides: snapGuides = [] } = computeRulerPt(mm, st.vertex);
          if (Math.hypot(pt.x - st.vertex.x, pt.y - st.vertex.y) < 20) return;
          measureDrawRef.current = { stage: 2, vertex: st.vertex, ray1: pt };
          setMeasure([st.vertex, pt]);
          setRulerSnap(snap);
          setGuides(snapGuides);
          return;
        }
        if (st.stage === 2) {
          const { pt, snap, guides: snapGuides = [] } = computeRulerPt(mm, st.vertex);
          if (Math.hypot(pt.x - st.vertex.x, pt.y - st.vertex.y) < 20) return;
          commitAngleDimension(st.vertex, st.ray1, pt);
          measureDrawRef.current = null;
          setMeasure([]);
          setMeasureOffsetPt(null);
          setRulerSnap(snap);
          setGuides(snapGuides);
        }
        return;
      }
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
        commitDimension(st.p1, st.p2, pt, measureKind);
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
      const dims = resolvePlanDimensions(plan, { dimensionDisplayMode }).dimensions;
      const dimHit = pickDimensionHit(dims, mm, { zoom: view.zoom });
      const wallHit = pickWallBodyHit(mm, resolvePlanWalls(plan), plan.room);
      if (dimHit && (!wallHit || dimHit.screenDistancePx <= 12)) {
        setSelection({ coll: "dimensions", ids: [dimHit.id] });
        return;
      }
      if (wallHit) { selectWall(e, wallHit.wall); return; }
    }
    if (tool === "select" && bgClick && e.button === 0) {
      // Outside click closes the floating length editor but keeps wall selection.
      if (floatEditorOpen) {
        closeFloatEditor();
      }
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
    if (WALL_DRAW_V2 && tool === "wall" && wallDrawV2.isActive()) {
      // Transient preview only: no setPlan/replacePlan/commitPlan/commitFrom,
      // no room sync, no autosave. Derived rooms and automatic dimensions
      // refresh on release, not on pointermove.
      const txId = wallDrawV2.getTxId();
      // The end is resolved against the session's own resolved start, with the
      // same bounded eligibility the start used — start/end parity by
      // construction. Modifiers are re-read every move, so Alt/Ctrl/Shift take
      // effect on the next preview.
      const start = wallDrawV2.getPreview()?.start || raw;
      // PHASE 2D: clip before previewing, so the band the user sees is the
      // wall the release will build.
      let resolved = clipWallDrawV2End(start, resolveWallDrawPoint(raw, { role: "end", from: start }));
      // PHASE 2F2.2 MODE A — relative magnets while drawing from a real node.
      const magnetCtx = resolveDraftMagnetContext(plan, start);
      if (magnetCtx && !altSnapRef.current && !resolved.clip?.clipped) {
        const magnet = resolveAngleMagnet({
          pivot: magnetCtx.pivot,
          rawPoint: resolved.point,
          referenceAngleDeg: magnetCtx.referenceAngleDeg,
          previousSnapAngleDeg: angleMagnetSnapRef.current,
        });
        angleMagnetSnapRef.current = magnet.previousSnapAngleDeg;
        resolved = {
          ...resolved,
          point: magnet.point,
          kind: magnet.snapped ? "angle" : resolved.kind,
          guides: [],
        };
        setAngleMagnetPreview({
          ...buildAngleMagnetPreview({ context: magnetCtx, magnet, plan: null }),
          angles: buildDraftMovementAngles(plan, magnetCtx.pivotNodeId, magnet.point),
        });
      } else {
        clearAngleMagnet();
      }
      wallDrawV2MovedRef.current = true;
      wallDrawV2.preview(txId, {
        point: resolved.point,
        snap: wallDrawV2Meta(raw, resolved),
        pointerId: e.pointerId,
      });
      setDraftSnap(wallDrawV2SnapView(resolved));
      setDraftAngleSnap(
        resolved.kind === "angle" || angleMagnetSnapRef.current != null
          ? { isSnapped: true, snappedAngle: angleMagnetSnapRef.current }
          : null,
      );
      setCursor(resolved.point);
      return;
    }
    if ((wallDrawRef.current || (tool === "wall" && wallGestureRef.current.phase !== "idle")) && tool === "wall") {
      const from = wallDrawRef.current?.from
        || wallGestureRef.current.start
        || (draft.length ? draft[draft.length - 1] : null);
      if (!from) {
        // fall through
      } else {
      const { pt, snap, angleSnap, fromAdjust } = computeWallSnap(raw, from);
      const start = fromAdjust || from;
      if (fromAdjust) {
        if (wallDrawRef.current) wallDrawRef.current = { from: start };
        wallGestureRef.current = { ...wallGestureRef.current, start };
      }
      const moved = wallGesturePointerMove(wallGestureRef.current, pt);
      wallGestureRef.current = moved.state;
      setDraftSnap(snap);
      setDraftAngleSnap(angleSnap);
      const base = wallDraftStateRef.current.pts.length
        ? wallDraftStateRef.current.pts
        : [start];
      setDraft([...base.slice(0, -1), base[base.length - 1] || start, pt]);
      mm = pt;
      }
    } else if (structuralDrawRef.current && tool === "structural") {
      const { from } = structuralDrawRef.current;
      const { pt, snap, angleSnap } = computeDraftPt(raw, from);
      setDraftSnap(snap);
      setDraftAngleSnap(angleSnap);
      setDraft([from, pt]);
      mm = pt;
    } else if (measureDrawRef.current && tool === "measure") {
      const st = measureDrawRef.current;
      if (measureKind === "angle") {
        if (st.stage === 1 && st.vertex) {
          const { pt, snap, guides: snapGuides = [] } = computeRulerPt(raw, st.vertex);
          setMeasure([st.vertex, pt]);
          setRulerSnap(snap);
          setGuides(snapGuides);
          mm = pt;
        } else if (st.stage === 2 && st.vertex && st.ray1) {
          const { pt, snap, guides: snapGuides = [] } = computeRulerPt(raw, st.vertex);
          setMeasure([st.vertex, st.ray1, pt]);
          setRulerSnap(snap);
          setGuides(snapGuides);
          mm = pt;
        }
      } else if (st.stage === 1) {
        const { p1 } = st;
        const { pt, snap, guides: snapGuides = [] } = computeRulerPt(raw, p1);
        setMeasure([p1, pt]);
        setRulerSnap(snap);
        setGuides(snapGuides);
        mm = pt;
      } else if (st.stage === 2) {
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
    if (
      shouldBlockWallGeometryDrag(tool)
      && (
        d.mode === "move-wall-seg"
        || d.mode === "move-wall-seg-pending"
        || (d.mode === "node" && d.coll === "walls")
      )
    ) {
      dragRef.current = null;
      return;
    }
    if (d.mode === "pan") {
      markViewportManual();
      setView((v) => ({ ...v, panX: d.px + (e.clientX - d.sx), panY: d.py + (e.clientY - d.sy) }));
    }
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
      // PHASE 1A: preview only — committed plan, history and autosave are
      // untouched until pointerup commits the transaction.
      const dragPlan = wallEditDragPlan(d);
      const wall = resolvePlanWalls(dragPlan).find((w) => w.id === d.id);
      if (!wall || wall.pts.length !== 2 || !d.origPts?.length || !d.txId) return;
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
      wallEdit.preview(d.txId, wallSegMovePreviewPlan(
        d.basePlan,
        d.id,
        newA,
        newB,
        d.endpointAttachments,
      ));
    } else if (d.mode === "node") {
      if (d.coll === "walls") {
        // PHASE 1A: preview only — see move-wall-seg above.
        const dragPlan = wallEditDragPlan(d);
        const wall = resolvePlanWalls(dragPlan).find((w) => w.id === d.id);
        let pt = { x: mm.x, y: mm.y };
        if (wall?.pts?.length >= 2) {
          const anchorIdx = d.idx > 0 ? d.idx - 1 : 1;
          const anchor = wall.pts[anchorIdx];
          pt = constrainAxisPoint(anchor, pt, dragShiftOn(shiftRef.current, altSnapRef.current));
        }
        const resolved = resolvePlanWalls(dragPlan);
        let snapped = snapWallPoint(pt, resolved, dragPlan.room, view.zoom, snapOn && display.snapWalls !== false && !altSnapRef.current, snapStep);
        // PHASE 2F2.2 MODE A — relative 45°/90° magnets about the fixed pivot.
        const magnetCtx = resolveEndpointMagnetContext(dragPlan, d.id, d.idx);
        if (magnetCtx && !altSnapRef.current) {
          const magnet = resolveAngleMagnet({
            pivot: magnetCtx.pivot,
            rawPoint: snapped,
            referenceAngleDeg: magnetCtx.referenceAngleDeg,
            previousSnapAngleDeg: angleMagnetSnapRef.current,
          });
          angleMagnetSnapRef.current = magnet.previousSnapAngleDeg;
          snapped = magnet.point;
          if (!d.txId) return;
          const previewPlan = wallNodeMovePreviewPlan(d.basePlan, d, snapped);
          wallEdit.preview(d.txId, previewPlan);
          const angles = buildAngleMagnetPreview({
            context: magnetCtx,
            magnet,
            plan: previewPlan,
            movingWallId: d.id,
          });
          // Prefer live sectors from the snapped preview geometry.
          if (!angles.angles?.length) {
            angles.angles = buildDraftMovementAngles(
              previewPlan,
              magnetCtx.pivotNodeId,
              snapped,
            );
          }
          setAngleMagnetPreview(angles);
          return;
        }
        clearAngleMagnet();
        if (!d.txId) return;
        wallEdit.preview(d.txId, wallNodeMovePreviewPlan(d.basePlan, d, snapped));
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
    if (WALL_DRAW_V2 && tool === "wall" && wallDrawV2.isActive()) {
      // One release → at most one wall → idle. The wall tool stays active and
      // nothing is left pending, so the next pointerdown starts a fresh wall.
      const txId = wallDrawV2.getTxId();
      // A press released without any pointermove never previewed an endpoint.
      // Resolve the release point once, through the same resolver — an endpoint
      // the user already saw is never re-resolved here.
      if (!wallDrawV2MovedRef.current) {
        const raw = toMM(e.clientX, e.clientY);
        const start = wallDrawV2.getPreview()?.start || null;
        const resolved = clipWallDrawV2End(start, resolveWallDrawPoint(raw, { role: "end", from: start }));
        wallDrawV2.preview(txId, {
          point: resolved.point,
          snap: wallDrawV2Meta(raw, resolved),
          pointerId: e.pointerId,
        });
        wallDrawV2MovedRef.current = true;
      }
      wallDrawV2.commit(txId);
      wallDrawV2MovedRef.current = false;
      setDraftSnap(null);
      setDraftAngleSnap(null);
      clearAngleMagnet();
      try { svgRef.current.releasePointerCapture(e.pointerId); } catch (_) {}
      return;
    }
    if (EXPOSE_PLANNER_E2E && tool === "wall") {
      geomProbeRef.current.wallGestureLog.push({
        tag: "UP-ENTER", t: Date.now(),
        ptsLen: wallDraftStateRef.current?.pts?.length ?? -1,
        gesturePhase: wallGestureRef.current?.phase,
        buttonDown: wallGestureRef.current?.buttonDown,
        hasWallDrawRef: !!wallDrawRef.current,
        pointerId: e.pointerId,
      });
    }
    if (tool === "wall" && (wallDrawRef.current || wallGestureRef.current.phase !== "idle")) {
      const from = wallDrawRef.current?.from || wallGestureRef.current.start;
      wallDrawRef.current = null;
      if (from) {
        const raw = toMM(e.clientX, e.clientY);
        const { pt, snap, fromAdjust } = computeWallSnap(raw, from);
        const start = fromAdjust || from;
        const len = Math.hypot(pt.x - start.x, pt.y - start.y);
        const endsOnWall = (() => {
          const hitKind = snap?.kind || snap?.type;
          return hitKind === "wall-first-hit"
            || hitKind === "wall-t-end"
            || hitKind === "wall-end"
            || hitKind === "WALL_LINE"
            || hitKind === "WALL_MID"
            || hitKind === "WALL_END"
            || !!snap?.firstIntersection
            || snap?.kind === "wall-first-hit";
        })();
        // Whether the user actually dragged must be measured from the RAW
        // (unsnapped) pointer movement, never from `len` (the post-snap
        // distance). The snap engine can project a near-zero release onto a
        // "wall-end"/minimum-length candidate — e.g. a plain click, no real
        // movement at all, still snapped to len === WALL_DRAW_MIN_LEN_MM — so
        // gating on the snapped length turned every ordinary click starting a
        // NEW chain into a false drag-release: onUp fired a premature
        // finishWallChain() with only that single point, which silently reset
        // the chain via clearWallChain(), swallowing the click the user meant
        // to register.
        const rawLen = Math.hypot(raw.x - from.x, raw.y - from.y);
        const wasDragging = !!wallGestureRef.current.buttonDown && rawLen >= WALL_DRAW_MIN_LEN_MM;
        const up = wallGesturePointerUp(wallGestureRef.current, {
          point: pt,
          commitOnRelease: wasDragging,
        });
        wallGestureRef.current = up.state;
        if (EXPOSE_PLANNER_E2E) {
          geomProbeRef.current.wallGestureLog.push({
            tag: "UP-RESULT", t: Date.now(), action: up.action,
            wasDragging, len, rawLen, endsOnWall, snapKind: snap?.kind || snap?.type || null,
            resultPhase: up.state?.phase, raw, from, buttonDown: wallGestureRef.current?.buttonDown,
          });
        }

        if (up.action === "commit" && up.start && up.end) {
          const endPt = up.end;
          if (snap?.kind === "close" && wallChainStartRef.current) {
            const end = { x: wallChainStartRef.current.x, y: wallChainStartRef.current.y };
            addWallDraftSegment(start, end, fromAdjust);
            wallDraftStateRef.current = { ...wallDraftStateRef.current, closedLoop: true };
            finishWallChain();
          } else if (Math.hypot(endPt.x - start.x, endPt.y - start.y) >= WALL_DRAW_MIN_LEN_MM) {
            addWallDraftSegment(start, endPt, fromAdjust);
            setDraftSnap(snap);
            if (endsOnWall) {
              finishWallChain();
            } else {
              wallGestureRef.current = {
                ...createWallGestureState(),
                phase: "pending",
                start: endPt,
                end: endPt,
                screenX: e.clientX,
                screenY: e.clientY,
                startedAt: Date.now(),
              };
              setDraft(wallDraftStateRef.current.pts.length
                ? wallDraftStateRef.current.pts
                : [endPt, endPt]);
            }
          }
        } else if (up.action === "keep-pending") {
          setDraftSnap(snap);
          const base = wallDraftStateRef.current.pts.length
            ? wallDraftStateRef.current.pts
            : [start];
          setDraft([...base.slice(0, -1), base[base.length - 1] || start, pt]);
        }
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
    } else if (
      d?.mode === "move-wall-seg"
      || d?.mode === "move-wall-seg-pending"
      || (d?.mode === "node" && d.coll === "walls")
    ) {
      // One transaction → one room sync → one history step → one autosave.
      // A press that never moved has no preview and commits nothing.
      if (d.txId) wallEdit.commit(d.txId);
    }
    // Safety net: never leave a transaction open behind a released pointer.
    if (wallEdit.isActive()) wallEdit.cancel();
    dragRef.current = null;
    rackSnapStickyRef.current = { x: null, y: null, atX: null, atY: null };
    objectSnapStickyRef.current = { x: null, y: null, atX: null, atY: null };
    setMarquee(null);
    setGuides([]);
    clearAngleMagnet();
    setHoverWallNode(null);
    setActiveGripKey(null);
    try { svgRef.current.releasePointerCapture(e.pointerId); } catch (_) {}
  };

  /**
   * PHASE 1A — a drag that dies without pointerup (browser cancel, capture
   * stolen by another element) must drop its preview, never half-commit it.
   * Fires after onUp's releasePointerCapture too, where the transaction is
   * already closed and this is a no-op.
   */
  const onPointerAbort = () => {
    // A V2 gesture aborted before release must drop its preview. After a
    // commit the session is already idle, so the trailing lostpointercapture
    // that follows every pointerup cannot undo the wall just created.
    cancelWallDrawV2();
    clearAngleMagnet();
    if (!wallEdit.isActive()) return;
    wallEdit.cancel();
    dragRef.current = null;
    setHoverWallNode(null);
    setActiveGripKey(null);
    setGuides([]);
  };

  const onWheel = (e) => {
    e.preventDefault();
    markViewportManual();
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    // LIVE4 camera fast path: coalesce wheel bursts to one setView per frame.
    // Latest cursor wins; factors multiply within the same animation frame.
    const prev = wheelPendingRef.current;
    const factor = (e.deltaY < 0 ? 1.12 : 0.89) * (prev?.factor || 1);
    wheelPendingRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      left: r.left,
      top: r.top,
      factor,
    };
    if (wheelRafRef.current) return;
    wheelRafRef.current = requestAnimationFrame(() => {
      wheelRafRef.current = 0;
      const p = wheelPendingRef.current;
      wheelPendingRef.current = null;
      if (!p) return;
      setView((v) => {
        const mx = p.clientX - p.left;
        const my = p.clientY - p.top;
        const next = cursorCenteredZoomView(v, {
          screenX: mx,
          screenY: my,
          nextZoom: v.zoom * p.factor,
        });
        return { zoom: next.zoom, panX: next.panX, panY: next.panY };
      });
    });
  };

  const z = view.zoom;
  const k = 1 / z;
  // Wall geometry and room validation follow the effective plan so a drag
  // preview is visible and the hatch never lags behind moved walls.
  // Finalized auto-dimensions deliberately stay on the committed plan (LIVE3) —
  // see runtimeDimensionData below. Auto dims are never written into
  // plan.dimensions; committed plan + history stay unchanged until release.
  const resolvedWalls = useMemo(
    () => resolvePlanWalls(effectivePlan),
    [effectivePlan.walls, effectivePlan.nodes],
  );
  const weldedWalls = useMemo(() => weldWallNodes(resolvedWalls), [resolvedWalls]);
  // LIVE3: finalized dimensions from committed plan only — never rebuild the
  // full inventory from wallEditPreview / length-preview each pointer frame.
  const runtimeDimensionData = useMemo(
    () => resolvePlanDimensions(plan, { dimensionDisplayMode }),
    [
      plan.walls,
      plan.nodes,
      plan.items,
      plan.zones,
      plan.room,
      plan.dimensions,
      plan.rooms,
      dimensionDisplayMode,
    ],
  );
  const runtimeRoomWarnings = useMemo(
    () => validateRooms(effectivePlan, renderRooms),
    [renderRooms, effectivePlan.items, effectivePlan.links, effectivePlan.walls],
  );
  const runtimeDimensions = runtimeDimensionData.dimensions;
  // Read-only: auto dimensions are runtime-derived, never stored in plan, so the
  // acceptance run needs them published alongside the plan snapshot.
  useEffect(() => {
    if (!EXPOSE_PLANNER_E2E || typeof window === "undefined" || !window.__dgPlanner) return;
    window.__dgPlanner.runtimeDimensions = runtimeDimensions;
    window.__dgPlanner.runtimeDimensionWarnings = runtimeDimensionData.validationWarnings || [];
    // Room polygons the dimension pipeline actually measured — lets the
    // acceptance run assert inside/outside lane placement without re-deriving.
    window.__dgPlanner.runtimeRoomContours = (runtimeDimensionData.contours?.roomContours || [])
      .map((rc) => ({
        roomId: rc.roomId || null,
        polygon: (rc.roomPolygon || []).map((p) => ({ x: p.x, y: p.y })),
        segmentAxes: (rc.segments || []).map((s) => s.axis),
      }));
    // During a wall transaction `plan` remains the committed snapshot while
    // `effectivePlan` is the topology actually rendered by the preview.
    window.__dgPlanner.effectivePlan = effectivePlan;
    // plan.walls[].pts is legacy/derived and absent on a freshly loaded plan;
    // publish the resolved walls the canvas actually renders.
    window.__dgPlanner.resolvedWalls = resolvedWalls;
  }, [runtimeDimensions, runtimeDimensionData, effectivePlan, resolvedWalls]);
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
    if (shouldBlockWallGeometryDrag(tool)) {
      if (EXPOSE_PLANNER_E2E) geomProbeRef.current.moveWallBlocked += 1;
      return;
    }
    if (EXPOSE_PLANNER_E2E) geomProbeRef.current.moveWallCalls += 1;
    if (!wall?.pts || wall.pts.length !== 2) return;
    e.stopPropagation();
    // NB (PHASE 2D): the second press of a double click lands here, not on the
    // wall body — once a wall is selected its move hit-area covers it — and it
    // arrives with detail 0, so the double click cannot be recognised from
    // this press. It is recognised in onDblClick, which still fires on the
    // <svg>. Starting a pending drag here is harmless: without pointer motion
    // it never becomes a move.
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
      endpointAttachments: classifyWallSegmentAttachments(plan, wall.id),
      txId: wallEdit.begin(plan, "wall-seg", { wallId: wall.id }),
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
    if (shouldBlockWallGeometryDrag(tool)) {
      // Wall tool owns pointer sequence — do not select/drag host geometry.
      if (EXPOSE_PLANNER_E2E) geomProbeRef.current.selectWallBlocked += 1;
      return;
    }
    if (EXPOSE_PLANNER_E2E) geomProbeRef.current.selectWallCalls += 1;
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
      // LIVE4: double-click opens the compact editor (not the large inspector).
      closeWallInspector();
      setSelection({
        coll: "walls",
        ids: wallContourIdsFor(wall, walls),
        nodeIdx: hit.kind === "node" ? hit.idx : -1,
      });
      setFloatEditorOpen(true);
      setFloatFocusReq((n) => n + 1);
      setExactLengthPreview(null);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setSelection({ coll: "walls", ids: wallChainIdsFor(wall, walls) });
      return;
    }
    // LIVE4: single click selects the wall and shows faces/grips/arrows.
    // Compact editor opens via Enter / double-click / explicit action only.
    closeWallInspector();
    setFloatEditorOpen(false);
    setSel({
      coll: "walls",
      id: wall.id,
      nodeIdx: hit.kind === "node" ? hit.idx : (hit.kind === "segment" ? -1 : undefined),
    });
    setExactLengthPreview(null);
  };

  const startNode = (e, coll, oid, idx) => {
    if (shouldBlockWallGeometryDrag(tool)) {
      if (EXPOSE_PLANNER_E2E) geomProbeRef.current.moveNodeBlocked += 1;
      return;
    }
    if (EXPOSE_PLANNER_E2E) geomProbeRef.current.moveNodeCalls += 1;
    e.stopPropagation();
    if (tool === "erase") {
      deleteHit({ coll, id: oid });
      return;
    }
    svgRef.current.setPointerCapture(e.pointerId);
    setSelection({ coll, ids: [oid], nodeIdx: idx });
    dragRef.current = {
      mode: "node",
      coll,
      id: oid,
      idx,
      basePlan: plan,
      txId: coll === "walls" ? wallEdit.begin(plan, "wall-node", { wallId: oid, idx }) : null,
    };
    if (coll === "walls") {
      setHoverWallNode({ wallId: oid, idx });
      setActiveGripKey(gripKey(oid, idx));
    }
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
  const viewportLod = resolveViewportLod(view.zoom);
  const canvasDisplay = useMemo(() => ({
    ...display,
    sheet: activeSheet,
    wallsForEmphasis: weldedWalls,
    // LIVE4 hatch LOD: coarser pattern at overview (same shared defs).
    hatchSpacing: viewportLod === "overview"
      ? Math.max(display.hatchSpacing || 14, 28)
      : (display.hatchSpacing || 14),
  }), [display, activeSheet, weldedWalls, viewportLod]);
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
    // Derived diagnostics — never a user-undoable step.
    replacePlan((p) => {
      const prevAll = p.validationWarnings || [];
      const prevDims = prevAll.filter((w) => w.source === "dimensions");
      const same = prevDims.length === nextWarn.length
        && prevDims.every((w, i) => w.id === nextWarn[i].id && w.text === nextWarn[i].text);
      if (same) return p;
      const withoutDims = prevAll.filter((w) => w.source !== "dimensions");
      return { ...p, validationWarnings: [...withoutDims, ...nextWarn] };
    });
  }, [runtimeDimensionData.validationWarnings, replacePlan]);

  useEffect(() => {
    const nextWarn = runtimeRoomWarnings || [];
    // Derived diagnostics — never a user-undoable step.
    replacePlan((p) => {
      const prevAll = p.validationWarnings || [];
      const prevRooms = prevAll.filter((w) => w.source === "rooms");
      const same = prevRooms.length === nextWarn.length
        && prevRooms.every((w, i) => w.id === nextWarn[i].id && (w.message || w.text) === (nextWarn[i].message || nextWarn[i].text));
      if (same) return p;
      const withoutRooms = prevAll.filter((w) => w.source !== "rooms");
      return { ...p, validationWarnings: [...withoutRooms, ...nextWarn] };
    });
  }, [runtimeRoomWarnings, replacePlan]);

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

  // PHASE 2E FOLLOW-UP (M3) — movement-handle eligibility.
  //
  // The handle used to be gated on the wall's layer being the ACTIVE one,
  // while the selection hit area was not. Any wall could therefore be selected
  // from any layer but only same-layer walls got a handle, so the rest looked
  // broken. Eligibility now comes from wallMoveHandleEligibility, which asks
  // the same classifier moveWallSegment uses. Only the wall under the cursor
  // or under the selection can show a handle, so this stays O(1) per render
  // rather than classifying every wall in the plan.
  const moveHandleWallIds = useMemo(() => {
    const ids = new Set();
    if (tool !== "select") return ids;
    for (const id of [selection?.coll === "walls" ? selection.ids[0] : null, hoverHit?.coll === "walls" ? hoverHit.id : null]) {
      if (!id) continue;
      // PHASE 2F1 — a T-split host must show ONE handle at the midpoint of the
      // complete logical wall, not one per half. Per-segment handles are
      // withheld for such a wall; WallChainMoveHandleLayer draws the single one.
      if (resolveLogicalWallChain(plan, id).segmentCount > 1) continue;
      if (wallMoveHandleEligibility(plan, id, { tool }).eligible) ids.add(id);
    }
    return ids;
  }, [plan, tool, selection, hoverHit]);

  /**
   * PHASE 2F1 — the LOGICAL wall behind the current selection / hover.
   *
   * Derived from the plan rather than stored in `selection`, so it stays
   * correct across Undo/Redo, reload and any command that re-splits or heals
   * the host: the identity is always recomputed from current topology.
   */
  const selectedWallChain = useMemo(() => {
    const id = selection?.coll === "walls" ? selection.ids[0] : null;
    if (!id) return null;
    const chain = resolveLogicalWallChain(plan, id);
    return chain.ok ? chain : null;
  }, [plan, selection]);

  const hoveredWallChain = useMemo(() => {
    const id = hoverHit?.coll === "walls" ? hoverHit.id : null;
    if (!id) return null;
    const chain = resolveLogicalWallChain(plan, id);
    return chain.ok ? chain : null;
  }, [plan, hoverHit]);

  const selectedChainWallIds = useMemo(
    () => new Set(selectedWallChain?.wallIds || []),
    [selectedWallChain],
  );
  const hoveredChainWallIds = useMemo(
    () => new Set(hoveredWallChain?.wallIds || []),
    [hoveredWallChain],
  );

  /**
   * The single central handle of a multi-segment logical wall, if any.
   * Read from the EFFECTIVE plan so the handle follows its chain during a
   * drag preview instead of staying at the committed midpoint.
   */
  const chainMoveHandle = useMemo(() => {
    if (tool !== "select") return null;
    const id = (selection?.coll === "walls" ? selection.ids[0] : null)
      || (hoverHit?.coll === "walls" ? hoverHit.id : null);
    if (!id) return null;
    const decision = logicalChainMoveHandleEligibility(effectivePlan, id, { tool });
    if (!decision.eligible || decision.segmentCount < 2 || !decision.point) return null;
    return { ...decision, anchorWallId: id };
  }, [effectivePlan, tool, selection, hoverHit]);

  // PHASE 2E.1 (B) — the same treatment for the ENDPOINT grips, which M3 left
  // behind on the active-layer gate: WallEl rendered them behind `editable`
  // (= `active === "<layer>" && tool === "select"`), so a selected partition
  // could be dragged as a whole from the room layer but had no endpoint grips.
  // Decided by endpointGripEligibility, which asks the same moveNode command
  // the drag runs, and — like the handle above — computed only for the wall
  // under the cursor or under the selection, so this stays O(1) per render.
  // A wall this decision does not cover (legacy pts-only) yields null and keeps
  // WallEl's previous behaviour.
  const endpointGripsByWallId = useMemo(() => {
    const map = new Map();
    if (tool !== "select") return map;
    for (const id of [selection?.coll === "walls" ? selection.ids[0] : null, hoverHit?.coll === "walls" ? hoverHit.id : null]) {
      if (!id || map.has(id)) continue;
      const grips = wallEndpointGrips(plan, id, { tool });
      if (grips) map.set(id, grips);
    }
    return map;
  }, [plan, tool, selection, hoverHit]);

  /**
   * PHASE 2F1 — endpoint grips belong to the LOGICAL wall.
   *
   * A T junction inside a host is a topology node the branch needs, never an
   * end of the wall the user selected: offering a red grip there is what made a
   * split host read as two walls. Only the two OUTER ends get a grip; each
   * entry keeps the terminal segment id + endpoint the existing moveNode drag
   * starts from, so the drag path itself is unchanged.
   */
  const logicalGripsByWallId = useMemo(() => {
    const map = new Map();
    if (tool !== "select") return map;
    for (const id of [selection?.coll === "walls" ? selection.ids[0] : null, hoverHit?.coll === "walls" ? hoverHit.id : null]) {
      if (!id || map.has(id)) continue;
      const entries = logicalChainEndpointGrips(plan, id, { tool });
      if (entries) map.set(id, entries);
    }
    return map;
  }, [plan, tool, selection, hoverHit]);

  /**
   * PHASE 2E.1 REWORK — the controls the dedicated top layer draws.
   *
   * Positions come from the EFFECTIVE plan so the grip follows its node during a
   * drag preview. One control per topology node: two selected/hovered endpoints
   * can resolve to the same node (a shared corner, a T), and stacking identical
   * circles there is exactly the "several overlapping duplicates" the contract
   * forbids. No node coordinate is touched — the control is drawn AT the node.
   */
  const endpointGripEntries = useMemo(() => {
    if (!logicalGripsByWallId.size) return [];
    const selectedId = selection?.coll === "walls" ? selection.ids[0] : null;
    const entries = [];
    for (const [anchorId, chainEntries] of logicalGripsByWallId) {
      for (const { wallId, endpoint, grip } of chainEntries) {
        if (!grip?.visible) continue;
        const wall = resolvedWalls.find((w) => w.id === wallId);
        if (!wall?.pts || wall.pts.length !== 2) continue;
        entries.push({
          wallId,
          endpoint,
          grip,
          point: wall.pts[endpoint],
          selected: anchorId === selectedId,
        });
      }
    }
    return dedupeGripsByNode(entries);
  }, [logicalGripsByWallId, resolvedWalls, selection]);

  // Read-only snapshot for automated acceptance runs (dev-only + opt-in, see
  // EXPOSE_PLANNER_E2E). Never written back into the plan.
  useEffect(() => {
    if (!EXPOSE_PLANNER_E2E || typeof window === "undefined" || !window.__dgPlanner) return;
    window.__dgPlanner.activeLayer = active;
    window.__dgPlanner.undoDepth = undoDepth;
    window.__dgPlanner.redoDepth = redoDepth;
    window.__dgPlanner.moveHandleWallIds = [...moveHandleWallIds];
    window.__dgPlanner.endpointGrips = Object.fromEntries(endpointGripsByWallId);
    window.__dgPlanner.endpointGripEntries = endpointGripEntries.map((entry) => ({
      wallId: entry.wallId,
      endpoint: entry.endpoint,
      nodeId: entry.grip.nodeId,
      topology: entry.grip.topology?.kind || null,
      point: { ...entry.point },
    }));
    // PHASE 2F1 — logical host wall, for browser acceptance evidence.
    window.__dgPlanner.selectedWallChain = selectedWallChain
      ? {
        logicalId: selectedWallChain.logicalId,
        chainId: selectedWallChain.chainId,
        wallIds: [...selectedWallChain.wallIds],
        nodeIds: [...selectedWallChain.nodeIds],
        outerNodeIds: [...selectedWallChain.outerNodeIds],
        internalNodeIds: [...selectedWallChain.internalNodeIds],
        segmentCount: selectedWallChain.segmentCount,
        totalLengthMm: selectedWallChain.totalLengthMm,
        midpoint: selectedWallChain.midpoint ? { ...selectedWallChain.midpoint } : null,
        branchWallIdsByNode: { ...selectedWallChain.branchWallIdsByNode },
      }
      : null;
    window.__dgPlanner.chainMoveHandle = chainMoveHandle
      ? {
        anchorWallId: chainMoveHandle.anchorWallId,
        logicalId: chainMoveHandle.logicalId,
        segmentCount: chainMoveHandle.segmentCount,
        point: { ...chainMoveHandle.point },
      }
      : null;
    window.__dgPlanner.resolveLogicalChain = (wallId) => {
      const chain = resolveLogicalWallChain(plan, wallId);
      return {
        ok: chain.ok,
        logicalId: chain.logicalId,
        wallIds: [...chain.wallIds],
        outerNodeIds: [...chain.outerNodeIds],
        internalNodeIds: [...chain.internalNodeIds],
        segmentCount: chain.segmentCount,
        totalLengthMm: chain.totalLengthMm,
        midpoint: chain.midpoint ? { ...chain.midpoint } : null,
      };
    };
    window.__dgPlanner.e2eMoveLogicalWallChain = (wallId, delta) => {
      let outcome = { changed: false, reason: "E2E_NO_PLAN" };
      setPlan((p) => {
        const chain = resolveLogicalWallChain(p, wallId);
        const moved = moveLogicalWallChain(p, {
          wallId,
          delta: { x: Number(delta?.x) || 0, y: Number(delta?.y) || 0 },
          expectedChainWallIds: chain.wallIds,
          makeId: uid,
        });
        outcome = {
          changed: !!moved.changed,
          reason: moved.reason || null,
          chainWallIds: moved.movement?.chainWallIds || chain.wallIds,
          effectiveDelta: moved.movement?.delta || null,
        };
        if (geomProbeRef.current) {
          geomProbeRef.current.lastWallMoveResult = {
            input: "e2e-chain",
            wallId,
            ...outcome,
            warnings: [...(moved.warnings || [])],
          };
        }
        if (!moved.changed) return p;
        return applyWallCmd(p, moved);
      });
      return outcome;
    };
    // PHASE 2F1 — deterministic host-branch move for browser acceptance.
    // Uses the same moveWallSegment + applyWallCmd path as mouse/arrows.
    window.__dgPlanner.e2eMoveWallSegment = (wallId, delta) => {
      let outcome = { changed: false, reason: "E2E_NO_PLAN" };
      setPlan((p) => {
        const attachments = classifyWallSegmentAttachments(p, wallId);
        const moved = moveWallSegment(p, {
          wallId,
          delta: { x: Number(delta?.x) || 0, y: Number(delta?.y) || 0 },
          expectedEndpointAttachments: attachments,
          makeId: uid,
        });
        outcome = {
          changed: !!moved.changed,
          reason: moved.reason || null,
          healedHosts: moved.movement?.healedHosts || [],
          createdSplitNodes: moved.movement?.createdSplitNodes || [],
        };
        if (geomProbeRef.current) {
          geomProbeRef.current.lastWallMoveResult = {
            input: "e2e",
            wallId,
            ...outcome,
            warnings: [...(moved.warnings || [])],
            effectiveDelta: moved.movement?.delta || null,
          };
        }
        if (!moved.changed) return p;
        return applyWallCmd(p, moved);
      });
      return outcome;
    };
    // PHASE 2F1 — deterministic endpoint (node) move for the multi-move gate.
    // Same moveNode + applyWallCmd path the grip drag commits.
    window.__dgPlanner.e2eMoveWallNode = (wallId, endpoint, delta) => {
      let outcome = { changed: false, reason: "E2E_NO_PLAN" };
      setPlan((p) => {
        const wall = (p.walls || []).find((w) => w.id === wallId);
        const nodeId = endpoint === "b" ? wall?.b : wall?.a;
        const node = nodeId ? p.nodes?.[nodeId] : null;
        if (!node) {
          outcome = { changed: false, reason: "NODE_NOT_FOUND" };
          return p;
        }
        const moved = moveNode(p, nodeId, {
          x: node.x + (Number(delta?.x) || 0),
          y: node.y + (Number(delta?.y) || 0),
        });
        outcome = { changed: !!moved.changed, reason: moved.reason || null, nodeId };
        if (!moved.changed) return p;
        return applyWallCmd(p, moved);
      });
      return outcome;
    };
    // PHASE 2F1 rebuilt fixtures — delete via the same deleteWall + applyWallCmd
    // path the Delete key uses (required for host-heal acceptance).
    window.__dgPlanner.e2eDeleteWall = (wallId) => {
      let outcome = { changed: false, reason: "E2E_NO_PLAN" };
      setPlan((p) => {
        if (!(p.walls || []).some((w) => w.id === wallId)) {
          outcome = { changed: false, reason: "WALL_NOT_FOUND" };
          return p;
        }
        const deleted = deleteWall(p, wallId);
        outcome = {
          changed: !!deleted.changed,
          reason: deleted.reason || null,
          healedHosts: deleted.movement?.healedHosts || deleted.healedHosts || [],
        };
        if (!deleted.changed) return p;
        return applyWallCmd(p, deleted);
      });
      return outcome;
    };
    window.__dgPlanner.e2eSelectWall = (wallId, opts = {}) => {
      // LIVE4: single-select shows faces/grips; float only when opts.openFloat.
      closeWallInspector();
      if (tool === "wall" && wallDrawV2?.isActive?.()) {
        try { wallDrawV2.cancel?.(); } catch { /* ignore */ }
      }
      setSel({ coll: "walls", id: wallId, nodeIdx: -1 });
      setFloatEditorOpen(!!opts.openFloat);
      if (opts.openFloat) setFloatFocusReq((n) => n + 1);
      setExactLengthPreview(null);
      setTypedLength("");
      setDrawTypedSeed(null);
      return { ok: true, wallId, float: !!opts.openFloat };
    };
    window.__dgPlanner.e2eSetTool = (toolName) => {
      handleTool(String(toolName || "select"));
      return { ok: true, tool: String(toolName || "select") };
    };
    window.__dgPlanner.e2eSetActiveLayer = (layerId) => {
      setActive(String(layerId || "room"));
      return { ok: true, active: String(layerId || "room") };
    };
    window.__dgPlanner.e2ePatchDisplay = (patch) => {
      patchDisplay(patch && typeof patch === "object" ? patch : {});
      return { ok: true };
    };
    window.__dgPlanner.e2eUndo = () => {
      const before = { undo: undoDepth, redo: redoDepth };
      undo();
      return { ok: true, before };
    };
    window.__dgPlanner.e2eRedo = () => {
      const before = { undo: undoDepth, redo: redoDepth };
      redo();
      return { ok: true, before };
    };
    // PHASE 2F1 — centre the viewport on a plan-mm point for mouse acceptance.
    window.__dgPlanner.e2eCenterOn = (x, y, zoom = 0.15) => {
      const r = svgRef.current?.getBoundingClientRect();
      if (!r) return { ok: false, reason: "NO_SVG" };
      const z = Math.max(0.02, Number(zoom) || 0.15);
      const cx = Number(x) || 0;
      const cy = Number(y) || 0;
      // Prevent delayed autofit from overwriting E2E / handoff camera.
      markViewportManual();
      setView({
        zoom: z,
        panX: r.width / 2 - cx * z,
        panY: r.height / 2 - cy * z,
      });
      return { ok: true, x: cx, y: cy, zoom: z };
    };
  }, [
    active, undoDepth, redoDepth, moveHandleWallIds, endpointGripsByWallId, endpointGripEntries,
    plan, selectedWallChain, chainMoveHandle, undo, redo, handleTool, setActive, patchDisplay,
  ]);

  // V2 draws its rubber band from the session, not from the legacy `draft`
  // chain array — which stays empty, so no legacy chain/Enter/double-click
  // path can see a pending draft while V2 is active.
  const wallDrawV2Band = WALL_DRAW_V2 ? wallDrawV2Preview : null;
  // PHASE 2F1-LIVE2 — paint DraftLine as start→end. Never [start,end]+cursor
  // (that made last≈end and cursor≈end → "0 мм · 0.0°").
  const draftRenderPts = wallDrawV2Band?.start
    ? [wallDrawV2Band.start]
    : draft;
  const draftCursor = wallDrawV2Band?.end
    ? wallDrawV2Band.end
    : (orthoTools && draft.length > 0 ? cursor : null);

  /**
   * PHASE 2F1-LIVE2 — transient measurements from the authoritative interaction
   * geometry (V2 preview / draft→cursor / effectivePlan). Never plan.dimensions.
   *
   * LIVE4.4: cursor/draftCursor are draw-path inputs only. Selected / edit-hold
   * semantic models must not recompute when the pointer moves.
   */
  const liveWallMeasurements = useMemo(() => {
    const room = effectivePlan?.room || plan.room;
    const drawSeg = tool === "wall"
      ? resolveLiveDrawSegment({
        v2Preview: wallDrawV2Band,
        draft,
        cursor: draftCursor || cursor,
      })
      : null;
    if (drawSeg?.valid) {
      const hostWallId = drawSeg.hostWallId
        || wallGestureRef.current?.hostWallId
        || null;
      const model = buildLiveWallDrawMeasurements({
        start: drawSeg.start,
        end: drawSeg.end,
        thk: wallThk,
        thicknessSide: "center",
        room,
        prevPoint: drawSeg.prevPoint,
        hostWallId,
        plan: effectivePlan,
        snap: draftSnap || drawSeg.endSnap,
        angleSnap: draftAngleSnap,
      });
      if (import.meta.env.DEV) {
        const check = assertLiveMeasurementModel(model);
        if (!check.ok) console.warn("[liveWall]", check.bad, drawSeg);
      }
      return model;
    }
    // In-flight wall edit (endpoint / segment / chain move) — effectivePlan only
    if (wallEditPreview && selection?.coll === "walls" && selection.ids?.[0]) {
      const kind = wallEdit?.getKind?.() || "endpoint";
      const editKind = kind === "wall-seg" || kind === "chain-move"
        ? "wall_move"
        : (kind === "wall-node" ? "rotate" : "t_slide");
      return buildLiveWallEditMeasurements({
        previewPlan: wallEditPreview,
        basePlan: plan,
        wallId: selection.ids[0],
        editKind,
        selectedEndpoint: selection.nodeIdx,
        room,
      });
    }
    // Selected committed wall — interactive face lengths / angles (LIVE4).
    if (
      selection?.coll === "walls"
      && selection.ids?.[0]
      && !(tool === "wall" && (wallDrawV2Band?.moved || wallDrawV2?.isActive?.()))
    ) {
      return buildLiveWallEditMeasurements({
        previewPlan: exactLengthPreview || plan,
        wallId: selection.ids[0],
        editKind: "endpoint",
        selectedEndpoint: selection.nodeIdx,
        room,
      });
    }
    return null;
  }, [
    tool, wallDrawV2Band, draft, draftCursor, cursor, wallThk, draftSnap, draftAngleSnap,
    wallEditPreview, selection, plan, effectivePlan, exactLengthPreview,
  ]);

  const liveWallActive = !!(liveWallMeasurements?.labels?.length && liveWallMeasurements?.valid !== false);

  const activeWallMaterial = useMemo(
    () => wallMaterialForTool(activeToolId).id,
    [activeToolId],
  );

  const wallDraftFrom = wallDrawV2Band
    ? wallDrawV2Band.start
    : (draft.length > 0 ? draft[draft.length - 1] : null);

  const selectedWallId = selection?.coll === "walls" ? selection.ids?.[0] : null;
  const selectedWallEntity = useMemo(() => {
    if (!selectedWallId) return null;
    return resolvePlanWalls(effectivePlan).find((w) => w.id === selectedWallId) || null;
  }, [selectedWallId, effectivePlan]);
  const selectedWallLengthMm = useMemo(() => {
    const pts = selectedWallEntity?.pts;
    if (!pts || pts.length < 2) return null;
    return Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y);
  }, [selectedWallEntity]);
  // LIVE3: draw float only while an active wall draft/gesture is in progress.
  // Selected-wall live labels must not flip the editor into draw mode.
  const floatIsDrawMode = !!(
    tool === "wall"
    && (
      !!drawTypedSeed
      || !!(WALL_DRAW_V2 && wallDrawV2?.isActive?.())
      || draft.length >= 1
      || !!(wallDrawV2Band?.moved)
    )
  );
  const floatLengthAnchor = useMemo(() => {
    if (floatIsDrawMode) {
      return liveWallMeasurements?.end
        || wallDrawV2Band?.end
        || draftCursor
        || cursor
        || null;
    }
    if (liveWallMeasurements?.a && liveWallMeasurements?.b) {
      return {
        x: (liveWallMeasurements.a.x + liveWallMeasurements.b.x) / 2,
        y: (liveWallMeasurements.a.y + liveWallMeasurements.b.y) / 2,
      };
    }
    const pts = selectedWallEntity?.pts;
    if (pts?.length >= 2) {
      return {
        x: (pts[0].x + pts[pts.length - 1].x) / 2,
        y: (pts[0].y + pts[pts.length - 1].y) / 2,
      };
    }
    return null;
  }, [floatIsDrawMode, liveWallMeasurements, wallDrawV2Band, draftCursor, cursor, selectedWallEntity]);
  const floatDisabledReason = useMemo(() => {
    if (!selectedWallId || floatIsDrawMode) return null;
    const anchor = resolveLengthEditAnchor(plan, selectedWallId, {
      selectedEndpoint: selection?.nodeIdx === 0 ? 0 : selection?.nodeIdx === 1 ? 1 : null,
    });
    return anchor.ok ? null : (anchor.message || "Длина недоступна");
  }, [selectedWallId, floatIsDrawMode, plan, selection?.nodeIdx]);

  /**
   * LIVE4.4 Stage A — immutable semantic visibility set for the selected wall.
   * No cursor, hover, occupancy, LOD, or collision packing.
   */
  const selectedDimensionSemantics = useMemo(() => {
    if (!selectedWallId || floatIsDrawMode) return null;
    return resolveSelectedDimensionSemantics({
      plan: exactLengthPreview || wallEditPreview || effectivePlan || plan,
      wallId: selectedWallId,
      room: effectivePlan?.room || plan.room,
      measurements: liveWallMeasurements,
      overview: false,
      allowOverviewCollapse: false,
    });
  }, [
    selectedWallId, floatIsDrawMode, liveWallMeasurements,
    exactLengthPreview, wallEditPreview, effectivePlan, plan,
  ]);

  const visibleRuntimeDimensions = useMemo(() => {
    // LIVE4 / LIVE4.3 / LIVE4.4: Stage A semantics drive suppression. Pointer,
    // float open-state and overlay LOD must never change liveFaceSpans here.
    const mode = floatIsDrawMode
      ? "draw"
      : (wallEditPreview && selectedWallId
        ? "edit_hold"
        : (selectedWallId && (floatEditorOpen || tool === "select" || !floatIsDrawMode)
          ? "select_editor"
          : null));
    const span = selectedDimensionSemantics?.centerline
      || (liveWallMeasurements?.start && liveWallMeasurements?.end
        ? { a: liveWallMeasurements.start, b: liveWallMeasurements.end }
        : (liveWallMeasurements?.a && liveWallMeasurements?.b
          ? { a: liveWallMeasurements.a, b: liveWallMeasurements.b }
          : null));
    const liveFaceSpans = (selectedDimensionSemantics?.suppressSpans?.length
      ? selectedDimensionSemantics.suppressSpans
      : (liveWallMeasurements?.labels || [])
        .filter((l) => l?.kind === "face" && l.a && l.b)
        .map((l) => ({ a: l.a, b: l.b })));
    const lineageIds = selectedDimensionSemantics?.lineageIds?.length
      ? selectedDimensionSemantics.lineageIds
      : (selectedChainWallIds.size
        ? [...selectedChainWallIds]
        : (selectedWallId ? [selectedWallId] : []));
    return filterDimensionsForActiveInteraction(runtimeDimensions, {
      mode: selectedWallId && mode == null ? "select_editor" : mode,
      wallId: selectedWallId,
      wallIds: lineageIds,
      span,
      liveFaceSpans,
      hideAllFinalized: mode === "draw",
    });
  }, [
    runtimeDimensions, floatIsDrawMode, wallEditPreview,
    selectedWallId, selectedChainWallIds, floatEditorOpen, tool,
    selectedDimensionSemantics, liveWallMeasurements,
  ]);

  // LIVE4.1: keep face dims in a narrow near-wall lane (screen px → world mm).
  // Grip/arrow collisions use SegDim labelT + knockout, not perpendicular dodge.
  const livePrimaryOffsetMm = useMemo(
    () => nearWallLaneOffsetMm(view.zoom || 1),
    [view.zoom],
  );

  useEffect(() => {
    if (!EXPOSE_PLANNER_E2E || typeof window === "undefined" || !window.__dgPlanner) return;
    window.__dgPlanner.liveWall = liveWallMeasurements
      ? {
        centerlineMm: liveWallMeasurements.centerlineMm,
        cornerDeg: liveWallMeasurements.cornerDeg ?? null,
        valid: liveWallMeasurements.valid !== false,
        kind: liveWallMeasurements.kind,
        start: liveWallMeasurements.start || liveWallMeasurements.a || null,
        end: liveWallMeasurements.end || liveWallMeasurements.b || null,
        labels: (liveWallMeasurements.labels || []).map((l) => ({
          id: l.id,
          text: l.text,
          role: l.role,
          kind: l.kind || null,
          face: l.face || null,
          mm: l.mm ?? null,
          deg: l.deg ?? null,
          a: l.a || null,
          b: l.b || null,
        })),
      }
      : null;
    window.__dgPlanner.floatEditorOpen = !!floatEditorOpen;
    window.__dgPlanner.wallInspectorOpen = !!wallInspectorOpen;
    window.__dgPlanner.typedLength = typedLengthRef.current || "";
    window.__dgPlanner.visibleRuntimeDimCount = visibleRuntimeDimensions.length;
    window.__dgPlanner.visibleRuntimeDimensions = visibleRuntimeDimensions.map((d) => ({
      id: d.id,
      kind: d.kind,
      wallId: d.wallId || d.reference?.wallId || null,
      p1: d.p1,
      p2: d.p2,
      measurementValue: d.measurementValue ?? d.valueMm ?? null,
    }));
    window.__dgPlanner.selectedDimensionSemantics = selectedDimensionSemantics
      ? {
        wallId: selectedDimensionSemantics.wallId,
        lineageIds: selectedDimensionSemantics.lineageIds,
        fingerprint: selectedDimensionSemantics.fingerprint,
        facesDiffer: selectedDimensionSemantics.facesDiffer,
        faces: (selectedDimensionSemantics.faces || []).map((f) => ({
          id: f.id,
          face: f.face,
          mm: f.mm,
          text: f.text,
          a: f.a,
          b: f.b,
          exterior: !!f.exterior,
        })),
        suppressSpans: selectedDimensionSemantics.suppressSpans,
      }
      : null;
  }, [
    liveWallMeasurements, floatEditorOpen, wallInspectorOpen, visibleRuntimeDimensions,
    typedLength, selectedDimensionSemantics,
  ]);

  /**
   * PHASE 2D1 — active guides only.
   *
   * While a V2 wall is being drawn the resolver already picked ONE winning
   * constraint. Rendering the alignment fallback as well drew a guide for every
   * nearby aligned node and wall, which is the dense dashed "grid" users saw.
   * Show the winner's guide and nothing else; each pointermove replaces the
   * whole set, so nothing accumulates.
   */
  const wallDrawV2ActiveGuides = useMemo(() => {
    if (!WALL_DRAW_V2 || !wallDrawV2Preview) return [];
    const g = wallDrawV2Preview.endSnap?.guides || wallDrawV2Preview.startSnap?.guides;
    if (!g) return [];
    const list = Array.isArray(g) ? g : (Array.isArray(g.items) ? g.items : [g]);
    const seen = new Set();
    return list.filter((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const key = JSON.stringify([entry.type, entry.angleDeg ?? entry.angle ?? null, entry.at ?? null]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 1);
  }, [wallDrawV2Preview]);

  const wallDraftGuides = useMemo(() => {
    if (tool !== "wall" || !cursor || display.snapGuides === false || altSnapRef.current) return [];
    // PHASE 2F2.2: magnetic rays own the local guide story during MODE A.
    if (angleMagnetPreview?.active) return [];
    // V2 renders the winning constraint only — never the alignment fallback,
    // which emitted a guide per nearby aligned node/wall (the dashed "grid").
    if (WALL_DRAW_V2) return wallDrawV2ActiveGuides;
    if (draftSnap?.guides?.length) {
      const projected = draftSnap.guides
        .filter((g) => g.type === "V" || g.type === "H")
        .map((g) => ({ ...g }));
      if (projected.length) return projected;
    }
    const from = wallDraftFrom || (draft.length === 1 ? draft[0] : null);
    if (!from && !wallDraftFrom) return [];
    return alignmentGuides(plan.nodes, resolvedWalls, cursor, plan.room, wallDraftFrom || from);
  }, [tool, cursor, draft, wallDraftFrom, plan.nodes, resolvedWalls, plan.room, display.snapGuides, draftSnap, wallDrawV2ActiveGuides, angleMagnetPreview]);

  const wallDraftArea = useMemo(() => {
    if (tool !== "wall" || draftSnap?.kind !== "close") return null;
    const start = draft[0] || wallChainStartRef.current;
    if (!start || !cursor) return null;
    const pts = draft.length >= 2 ? [...draft, cursor] : [start, draft[0] || cursor, cursor];
    return draftChainArea(pts);
  }, [tool, draft, cursor, draftSnap]);

  const wallDraftNodeAngles = useMemo(() => {
    // V2: angleAt() labels EVERY wall incident at the start node (the 180°/87°
    // arcs users saw stacked on the canvas). The winning constraint is already
    // shown by the snap indicator and the single active guide.
    if (WALL_DRAW_V2) return [];
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
  const runPlanCheck = () => {
    setDiagnosticsChecking(true);
    const result = validatePlanIntegrity(plan);
    setPlanDiagnostics({ result, planRef: plan });
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
  const showProperties = true;

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
        <span className="planner-coords__hint planner-coords__hint--measure">
          <span className="planner-measure-kinds" role="group" aria-label="Тип размера">
            {[
              ["linear", "Линейный"],
              ["diagonal", "Диагональ"],
              ["angle", "Угол"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={"planner-measure-kind" + (measureKind === id ? " is-active" : "")}
                title={label}
                onClick={() => {
                  setMeasureKind(id);
                  measureDrawRef.current = null;
                  setMeasure([]);
                  setMeasureOffsetPt(null);
                }}
              >
                {label}
              </button>
            ))}
          </span>
          {measureKind === "angle"
            ? "1 — вершина · 2 — луч A · 3 — луч B · Esc — отмена"
            : "1 — точка A · 2 — точка B · 3 — отступ · Esc — отмена"}
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

  const inspectorModel = useMemo(
    () => buildInspectorModel(selection, plan, selObj),
    [selection, plan, selObj],
  );

  const applyFloatingWallLength = (mm) => {
    if (!selectedWallId || !(mm > 0)) return;
    const opts = {
      selectedEndpoint: selection?.nodeIdx === 0 ? 0 : selection?.nodeIdx === 1 ? 1 : null,
    };
    setPlan((p) => {
      const applied = applyExactWallLength(p, selectedWallId, mm, opts);
      if (!applied.ok || !applied.plan) return p;
      return syncAutoZones(applied.plan);
    });
    setExactLengthPreview(null);
  };

  const previewFloatingWallLength = (mm) => {
    if (!selectedWallId) return;
    if (!(mm > 0)) {
      setExactLengthPreview(null);
      return;
    }
    const preview = applyExactWallLength(plan, selectedWallId, mm, {
      selectedEndpoint: selection?.nodeIdx === 0 ? 0 : selection?.nodeIdx === 1 ? 1 : null,
      previewOnly: true,
    });
    if (!preview.ok || !preview.preview?.point) {
      setExactLengthPreview(null);
      return;
    }
    const moveId = preview.preview.moveNodeId;
    const node = plan.nodes?.[moveId];
    if (!moveId || !node) {
      setExactLengthPreview(null);
      return;
    }
    setExactLengthPreview({
      ...plan,
      nodes: {
        ...plan.nodes,
        [moveId]: { ...node, ...preview.preview.point },
      },
    });
  };

  const handleInspectorChange = (payload) => {
    // PHASE 2F1-LIVE — exact wall length via inspector (Enter applies).
    if (payload?.type === "wall" && payload?.field === "length") {
      const parsed = parseLengthInput(payload.value);
      if (!parsed.ok) return;
      setPlan((p) => {
        const applied = applyExactWallLength(p, payload.id, parsed.mm, {
          selectedEndpoint: selection?.nodeIdx === 0 ? 0 : selection?.nodeIdx === 1 ? 1 : null,
        });
        if (!applied.ok || !applied.plan) return p;
        return syncAutoZones(applied.plan);
      });
      return;
    }
    const mapped = inspectorChangeToPatch(payload);
    if (!mapped) return;
    if (mapped.coll === "nodes") {
      const node = plan.nodes?.[mapped.id];
      if (!node) return;
      const nextPt = { x: mapped.patch.x ?? node.x, y: mapped.patch.y ?? node.y };
      setPlan((p) => movePlanNode(p, mapped.id, nextPt));
      return;
    }
    updateObj(mapped.coll, mapped.id, mapped.patch);
  };

  const handleInspectorCommand = (cmd, payload = {}) => {
    if (cmd === "delete") {
      delSel();
      return;
    }
    if (cmd === "split" && payload?.id) {
      const wall = resolvePlanWalls(plan).find((w) => w.id === payload.id);
      if (!wall?.pts?.length) return;
      const mid = wall.pts[Math.floor(wall.pts.length / 2)] || wall.pts[0];
      setPlan((p) => {
        const r = splitWall(p, payload.id, mid, uid);
        return r?.plan || p;
      });
      clearSelection();
      return;
    }
    if (cmd === "merge") {
      // Merge requires two node ids; skip until dual selection is available.
      return;
    }
  };

  return (
    <>
      <PlannerLayout
        topBarProps={{
          mode: standalone ? "standalone" : "project",
          title: planTitle,
          saved,
          saveFailed,
          saveStatus: saveUiStatus,
          busy,
          onPdf: exportPDF,
          onSync: syncSpec,
          onExportJson: handleExportJson,
          onImportJson: (file) => {
            viewportFittedRef.current = false;
            viewportManualRef.current = false;
            handleImportJson(file);
          },
          onRename: handleRenameDraft,
          onAttach: standalone ? () => setAttachOpen(true) : undefined,
          onCheckPlan: runPlanCheck,
          onFit: () => fitView("fit-button"),
          onUndo: undo,
          onRedo: redo,
          projectId: project?.id,
        }}
        toolRailProps={{
          activeToolId: railActiveToolId,
          tools: PLANNER_TOOL_RAIL,
          onToolSelect: handleRailToolSelect,
          onEscape: handleRailEscape,
        }}
        inspectorProps={{
          selection: inspectorModel.selection,
          entity: inspectorModel.entity,
          warnings: inspectorModel.warnings,
          // PHASE 2D: selecting a wall must not reveal its editor; every other
          // entity keeps the existing select-to-reveal behaviour.
          autoOpenOnSelect: selection?.coll !== "walls",
          openRequestId: inspectorOpenReq,
          closeRequestId: inspectorCloseReq,
          context: {
            layer: activeSheet?.name || active,
            level: planLevel,
            scale: Math.round(1 / Math.max(z, 0.001)),
          },
          onChange: handleInspectorChange,
          onCommand: handleInspectorCommand,
          onClearSelection: clearSelection,
          onFitPlan: () => fitView("fit-button"),
        }}
        activeSheetId={activeSheetId}
        onSheetPick={handleSheetPick}
        viewMode={viewMode}
        onViewModePick={handleViewModePick}
        planLevel={planLevel}
        planVariant={planVariant}
        onPlanLevel={setPlanLevel}
        onPlanVariant={setPlanVariant}
        sheetFilters={activeSheet.filters}
        activeFilterId={activeFilterId}
        onFilterPick={handleFilterPick}
        bottomBarProps={{
          zoom: z,
          display,
          unit,
          onUnitChange: (uid_) => patchDisplay({ coordUnit: uid_ }),
          onZoomPreset: setZoomTo,
          onToggle: toggleDisplay,
          onSetDisplay: patchDisplay,
          onFit: () => fitView("fit-button"),
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
          onFit: () => fitView("fit-button"),
          onReset: () => {
            viewportManualRef.current = false;
            fitView("reset");
          },
        }}
        statusBar={statusBar}
        footerLeft={(
          <>
            <button type="button" className="planner-bottom-btn" onClick={() => window.open("https://daogreen.ru", "_blank")}>Помощь</button>
            <button type="button" className="planner-bottom-btn" disabled title="Скоро">По картинке</button>
          </>
        )}
        canvas={(
          <svg
            ref={svgRef}
            className="plan-svg"
            onPointerDownCapture={onCanvasPointerDownCapture}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onPointerAbort}
            onLostPointerCapture={onPointerAbort}
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
                  {renderZones.map((zn) => (
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
                    editable={tool === "select"}
                    eraseMode={tool === "erase"}
                    onDown={(e) => selectWall(e, w)}
                  />
                ))}
                {roomWalls.map((w) => (
                  <WallEl
                    key={w.id}
                    wall={w}
                    k={k}
                    editable={active === "room" && tool === "select"}
                    movable={moveHandleWallIds.has(w.id)}
                    endpointGrips={endpointGripsByWallId.get(w.id) || null}
                    eraseMode={tool === "erase"}
                    selected={selection?.coll === "walls" && selectedChainWallIds.has(w.id)}
                    selectionAnchor={selection?.ids?.[0] === w.id}
                    hovered={hoverHit?.coll === "walls" && hoveredChainWallIds.has(w.id)}
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
                    editable={active === "partitions" && tool === "select"}
                    eraseMode={tool === "erase"}
                    onDown={(e) => selectWall(e, w)}
                  />
                ))}
                {partitionWalls.map((w) => (
                  <WallEl
                    key={`pt-${w.id}`}
                    wall={w}
                    k={k}
                    editable={active === "partitions" && tool === "select"}
                    movable={moveHandleWallIds.has(w.id)}
                    endpointGrips={endpointGripsByWallId.get(w.id) || null}
                    eraseMode={tool === "erase"}
                    selected={selection?.coll === "walls" && selectedChainWallIds.has(w.id)}
                    selectionAnchor={selection?.ids?.[0] === w.id}
                    hovered={hoverHit?.coll === "walls" && hoveredChainWallIds.has(w.id)}
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
                  {renderZones.map((zn) => (
                    <ZoneEl
                      key={`lbl-${zn.id}`}
                      zn={zn}
                      k={k}
                      room={plan.room}
                      interactive={false}
                      showRoomLabels={display.showZoneNames === true}
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
              <PlannerOverlayBoundary resetKey={`wall-mass-${weldedWalls.length}`}>
              {canvasDisplay?.unifiedWallMass !== false && (
                <WallMassLayer walls={weldedWalls} room={plan.room} k={k} display={canvasDisplay} />
              )}
              </PlannerOverlayBoundary>
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
                selectedWallIds={selectedChainWallIds.size ? selectedChainWallIds : null}
                hoveredWallIds={hoveredChainWallIds.size ? hoveredChainWallIds : null}
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
                {/* PHASE 2F1: wall selection must not generate dimension geometry.
                    Canonical dims are emphasized via DimensionsLayer.emphasizeWallId. */}
              </g>
              </PlannerOverlayBoundary>
              {/* PHASE 2F1-LIVE3: finalized dims filtered so the active span
                  has exactly one interactive representation. */}
              {/*
                PHASE 2F2.5 paint stack (world SVG, DOM order = paint order):
                DimensionsLayer → wall-live linear dims → corner angles
                (arcs/chips/text) → endpoint grips / chain handle.
                Angles must never paint under black linear dim strokes.
              */}
              {display.showDims && visibleRuntimeDimensions.length > 0 && (
                <PlannerOverlayBoundary resetKey={`runtime-dims-${visibleRuntimeDimensions.length}`}>
                <g data-ui="runtime-linear-dimensions">
                <DimensionsLayer
                  dimensions={visibleRuntimeDimensions}
                  k={k}
                  fmtDim={fmtU}
                  display={canvasDisplay}
                  zoom={view.zoom}
                  emphasizeWallId={null}
                  emphasizeWall={null}
                  selectedId={selection?.coll === "dimensions" ? selection.ids[0] : null}
                  hoveredId={hoverDimensionId}
                  onHover={(id) => setHoverDimensionId(id || null)}
                  onSelect={(e, dim) => {
                    if (tool === "erase") {
                      if (dim.auto) return;
                      deleteHit({ coll: "dimensions", id: dim.id });
                      return;
                    }
                    setSelection({ coll: "dimensions", ids: [dim.id] });
                  }}
                  onDoubleClick={(e, dim, pos) => {
                    if (dim.auto || dim.locked) return;
                    setSelection({ coll: "dimensions", ids: [dim.id] });
                    setDimensionEdit({
                      id: dim.id,
                      value: dim.labelOverride || "",
                      x: pos.x,
                      y: pos.y,
                    });
                  }}
                />
                </g>
                </PlannerOverlayBoundary>
              )}
              {liveWallActive && !angleMagnetPreview?.active && (
                <PlannerOverlayBoundary resetKey="wall-live-measurements">
                  <WallLiveMeasurementOverlay
                    measurements={liveWallMeasurements}
                    k={k}
                    zoom={z}
                    hideContext={false}
                    hidePrimaryLabel={
                      // LIVE4.4: draw float owns the command length only.
                      // Selected physical-face dims stay visible even when the
                      // compact editor is open (overlay never strips kind=face).
                      !!floatIsDrawMode
                    }
                    hideThicknessMarks
                    primaryOffsetMm={livePrimaryOffsetMm}
                  />
                </PlannerOverlayBoundary>
              )}
              {angleMagnetPreview?.active && (
                <PlannerOverlayBoundary resetKey="angle-magnets">
                  <AngleMagnetOverlay preview={angleMagnetPreview} k={k} zoom={z} />
                </PlannerOverlayBoundary>
              )}
              {/*
                PHASE 2E.1 REWORK — endpoint controls live HERE, after the wall
                mass, the exterior outlines and the dimensions. Emitted inside
                WallEl (i.e. inside the wall layer groups) they were painted over
                by WallMassLayer/WallsTopOverlay below, which is why the manual
                run found them only by guessing. Positions are the real topology
                nodes; nothing is offset.
                PHASE 2F2.5 — grips remain above angle annotations.
              */}
              <PlannerOverlayBoundary resetKey={`endpoint-grips-${endpointGripEntries.length}`}>
                <WallEndpointGripLayer
                  entries={endpointGripEntries}
                  k={k}
                  zoom={z}
                  activeKey={activeGripKey}
                  hoverKey={hoverGripKey}
                  onGripDown={(e, wallId, endpoint) => startNode(e, "walls", wallId, endpoint)}
                  onGripHover={setHoverGripKey}
                />
              </PlannerOverlayBoundary>
              {/* PHASE 2F1 — ONE central handle for a T-split logical wall. */}
              <PlannerOverlayBoundary resetKey={`chain-handle-${chainMoveHandle?.logicalId || ""}`}>
                <WallChainMoveHandleLayer
                  point={chainMoveHandle?.point || null}
                  wallId={chainMoveHandle?.anchorWallId || null}
                  logicalId={chainMoveHandle?.logicalId || null}
                  segmentCount={chainMoveHandle?.segmentCount || 0}
                  k={k}
                  active={hoverWallNode?.idx === -1}
                  onHandleDown={(e) => {
                    const wall = resolvedWalls.find((w) => w.id === chainMoveHandle?.anchorWallId);
                    if (wall) startWallMidNode(e, wall);
                  }}
                  onHandleHover={(on) => setHoverWallNode(
                    on && chainMoveHandle ? { wallId: chainMoveHandle.anchorWallId, idx: -1 } : null,
                  )}
                />
              </PlannerOverlayBoundary>
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
                {tool === "wall" && draftRenderPts.length === 0 && cursor && (
                  <WallCursorPreview cursor={cursor} materialId={activeWallMaterial} thk={wallThk} k={k} />
                )}
                {tool === "wall" && (
                  <WallSnapIndicator cursor={cursor} snapPt={draftSnap} k={k} angleSnapOn={draftAngleSnap?.isSnapped} />
                )}
                {tool === "wall" && wallDraftFrom && wallDraftNodeAngles.length > 0 && (
                  <WallAngleLabels nodePt={wallDraftFrom} angles={wallDraftNodeAngles} k={k} />
                )}
                {draftRenderPts.length > 0 && (
                  <DraftLine
                    pts={draftRenderPts}
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
                    hideHud={tool === "wall"}
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
                {(measure.length === 2 || (measureKind === "angle" && measure.length >= 2)) && (
                  measureKind === "angle" && measure.length >= 3 ? (
                    <g data-ui="angle-draft" pointerEvents="none">
                      <line x1={measure[0].x} y1={measure[0].y} x2={measure[1].x} y2={measure[1].y} stroke="#8f9a94" strokeWidth={1.2 * k} />
                      <line x1={measure[0].x} y1={measure[0].y} x2={measure[2].x} y2={measure[2].y} stroke="#8f9a94" strokeWidth={1.2 * k} />
                      <circle cx={measure[0].x} cy={measure[0].y} r={4 * k} fill="#116355" />
                    </g>
                  ) : (
                  <DimensionDraftEl
                    p1={measure[0]}
                    p2={measure[1]}
                    offsetPoint={measureKind === "angle" ? null : measureOffsetPt}
                    k={k}
                    fmtDim={fmtU}
                    display={canvasDisplay}
                    snapPt={rulerSnap}
                  />
                  )
                )}
                {dimensionEdit && (
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
                    zoom={z}
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
              {!(tool === "wall" && liveWallActive) && (
                <TypedLengthHint value={typedLength} k={k} />
              )}
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
      {!diagnosticsOpen && roomDetectionDiagnostic && !roomDiagnosticDismissed && (
        <PlanDiagnosticsPanel
          result={{ diagnostics: [roomDetectionDiagnostic] }}
          onRerun={() => setPlan((p) => syncAutoZones(p))}
          onClose={() => setRoomDiagnosticDismissed(true)}
          propertiesOpen={showProperties}
        />
      )}
      <WallFloatingLengthEditor
        open={
          !!(floatLengthAnchor && (
            (floatIsDrawMode && (liveWallMeasurements?.centerlineMm > 0 || drawTypedSeed))
            || (!floatIsDrawMode && floatEditorOpen && selectedWallId
              && (liveWallMeasurements?.centerlineMm > 0 || selectedWallLengthMm > 0))
          ))
        }
        mode={floatIsDrawMode ? "draw" : "select"}
        bareAsMm={floatIsDrawMode}
        seedText={floatIsDrawMode ? drawTypedSeed : null}
        showExtendedFields={!floatIsDrawMode}
        anchorWorld={floatLengthAnchor}
        view={view}
        getSvgRect={() => svgRef.current?.getBoundingClientRect?.() || null}
        lengthMm={
          floatIsDrawMode
            ? (liveWallMeasurements?.centerlineMm || null)
            : (selectedWallLengthMm || liveWallMeasurements?.centerlineMm || null)
        }
        angleDeg={liveWallMeasurements?.cornerDeg ?? null}
        thkMm={selectedWallEntity?.thk ?? liveWallMeasurements?.thkMm ?? wallThk}
        heightMm={selectedWallEntity?.height ?? plan.room?.height ?? 3000}
        materialId={selectedWallEntity?.material || "drywall"}
        disabledReason={!floatIsDrawMode ? floatDisabledReason : null}
        focusRequest={floatFocusReq}
        inputRef={floatInputRef}
        onApplyLength={
          !floatIsDrawMode
            ? applyFloatingWallLength
            : (mm) => {
              setTypedLength(String(Math.round(mm)));
              typedLengthRef.current = String(Math.round(mm));
              applyDrawTypedPreview(String(Math.round(mm)), { commit: true });
            }
        }
        onPreviewLength={
          !floatIsDrawMode
            ? previewFloatingWallLength
            : (mm, raw) => {
              if (raw != null) {
                setDrawTypedSeed(raw);
                setTypedLength(raw);
              }
              if (mm != null) applyDrawTypedPreview(String(Math.round(mm)), { commit: false });
            }
        }
        onChangeThickness={(thk) => {
          if (!selectedWallId) return;
          updateObj("walls", selectedWallId, { thk });
        }}
        onChangeHeight={(height) => {
          if (!selectedWallId) return;
          updateObj("walls", selectedWallId, { height });
        }}
        onChangeMaterial={(material) => {
          if (!selectedWallId) return;
          updateObj("walls", selectedWallId, { material });
        }}
        onCancel={() => {
          setExactLengthPreview(null);
          if (floatIsDrawMode) {
            setTypedLength("");
            setDrawTypedSeed(null);
          }
        }}
        onClose={closeFloatEditor}
        onOpenProperties={!floatIsDrawMode && selectedWallId ? () => openWallInspector() : null}
      />
    </>
  );
}
