import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useStore } from "../../store/StoreContext.jsx";
import { uid } from "../../store/helpers.js";
import {
  LAYERS, LINE_STYLE, PDF_SHEETS, catalogByKind, catalogForLayer, layerById,
  clamp, snap, fmt, DEFAULT_PLAN, DEFAULT_DISPLAY, migrateLayerId,
} from "../../planner/catalog.js";
import { exportLayeredPDF } from "../../planner/exportPdf.js";
import { createPlannerSpecItems, defaultObjectSpecSettings, plannerSpecSummary } from "../../planner/specSync.js";
import { orthogonalPoint, collectPlannerWarnings, wallsForLayer } from "../../planner/geometry.js";
import {
  snapWallPoint, pointAtLength, placeOnWall, findClosedLoops, polygonBounds, pointInPolygon, breakWallAt,
} from "../../planner/wallGeometry.js";
import { usePlanHistory } from "../../planner/usePlanHistory.js";
import {
  PlanGrid, RoomShell, RoomDims, WallEl, ItemEl, ZoneEl, LabelEl, LineEl,
  DraftLine, SelectionDims, MeasureEl, TypedLengthHint, LinkEl,
} from "../../planner/canvasPrimitives.jsx";
import {
  linkTypeForLayer, canCreateLink, normalizeLinkEnds, linkLengthMm,
} from "../../planner/linkGeometry.js";
import { PlannerTopBar } from "../../planner/ui/PlannerTopBar.jsx";
import { LayerTabs } from "../../planner/ui/LayerTabs.jsx";
import { ObjectPalette } from "../../planner/ui/ObjectPalette.jsx";
import { PropertiesPanel } from "../../planner/ui/PropertiesPanel.jsx";
import { PlannerBottomBar } from "../../planner/ui/PlannerBottomBar.jsx";
import { ContextMenu, buildObjectMenu } from "../../planner/ui/ContextMenu.jsx";
import "../../planner/planner.css";
import { Empty } from "../../components/ui.jsx";

const SNAP_STEP = 50;
const LINE_LAYER_IDS = ["drain", "irrigation", "supply", "power", "vent", "climate", "ac", "light", "staff"];
const ITEM_LAYER_IDS = LAYERS.map((l) => l.id).filter(
  (id) => !["room", "zones", "partitions", "client", "install", "spec"].includes(id)
);

function orthoPt(from, to, snapOn, shiftHeld) {
  if (shiftHeld && from) {
    const dx = Math.abs(to.x - from.x);
    const dy = Math.abs(to.y - from.y);
    if (dx > dy * 1.4) return orthogonalPoint(from, { x: to.x, y: from.y }, SNAP_STEP, snapOn);
    if (dy > dx * 1.4) return orthogonalPoint(from, { x: from.x, y: to.y }, SNAP_STEP, snapOn);
  }
  return orthogonalPoint(from, to, SNAP_STEP, snapOn);
}

export default function PlanPage() {
  const { id } = useParams();
  const { state, actions } = useStore();
  const project = state.projects.find((p) => p.id === id);

  const { plan, setPlan, undo, redo, resetHistory } = usePlanHistory(() => withDefaults(project?.plan));
  const [active, setActive] = useState("room");
  const [tool, setTool] = useState("select");
  const [pending, setPending] = useState(null);
  const [sel, setSel] = useState(null);
  const [view, setView] = useState({ panX: 60, panY: 70, zoom: 0.1 });
  const [display, setDisplay] = useState(DEFAULT_DISPLAY);
  const [unit] = useState("mm");
  const [vis, setVis] = useState(Object.fromEntries(LAYERS.map((l) => [l.id, true])));
  const [draft, setDraft] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [measure, setMeasure] = useState([]);
  const [guides, setGuides] = useState([]);
  const [wallThk, setWallThk] = useState(100);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(true);
  const [spacePan, setSpacePan] = useState(false);
  const [linkFrom, setLinkFrom] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null);
  const ctxMenuRef = useRef(null);
  ctxMenuRef.current = ctxMenu;
  const [typedLength, setTypedLength] = useState("");
  const [draftSnap, setDraftSnap] = useState(null);

  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const clipboardRef = useRef(null);
  const shiftRef = useRef(false);
  const altSnapRef = useRef(false);
  const typedLengthRef = useRef("");
  typedLengthRef.current = typedLength;

  useEffect(() => {
    actions.ensureMaterials().catch(() => {});
    actions.ensureModules().catch(() => {});
  }, [actions]);

  useEffect(() => {
    let cancelled = false;
    actions.loadProject(id).then((p) => {
      if (!cancelled && p?.plan && Object.keys(p.plan).length) resetHistory(withDefaults(p.plan));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [id, actions, resetHistory]);

  useEffect(() => {
    if (!project?.id) return;
    setSaved(false);
    const t = window.setTimeout(() => {
      actions.projectUpdate(project.id, { plan })
        .then(() => setSaved(true))
        .catch((e) => console.error("Planner autosave failed", e));
    }, 700);
    return () => window.clearTimeout(t);
  }, [plan, project?.id, actions]);

  const snapOn = display.snapOn && !altSnapRef.current;
  const fmtU = (mm) => fmt(mm, unit);
  const toMM = (cx, cy) => {
    const r = svgRef.current.getBoundingClientRect();
    return { x: (cx - r.left - view.panX) / view.zoom, y: (cy - r.top - view.panY) / view.zoom };
  };
  const sn = (v) => snap(v, SNAP_STEP, snapOn && display.snapGrid);

  const innerL = plan.room.wallThk / 2;
  const innerT = plan.room.wallThk / 2;
  const innerR = plan.room.w - plan.room.wallThk / 2;
  const innerB = plan.room.h - plan.room.wallThk / 2;

  const snapObj = useCallback((coll, obj, x, y) => {
    if (!snapOn) return { x: sn(x), y: sn(y), guides: [] };
    const thr = 10 / view.zoom;
    const V = [0, innerL, innerR, plan.room.w];
    const H = [0, innerT, innerB, plan.room.h];
    plan.walls.forEach((w) => w.pts.forEach((p, i) => {
      if (!i) return;
      const a = w.pts[i - 1];
      if (Math.abs(p.x - a.x) < 1) V.push(p.x);
      if (Math.abs(p.y - a.y) < 1) H.push(p.y);
    }));
    if (display.snapObjects) {
      plan.items.forEach((it) => {
        if (it.id === obj.id) return;
        V.push(it.x, it.x + it.w / 2, it.x + it.w);
        H.push(it.y, it.y + it.h / 2, it.y + it.h);
      });
    }
    const g = [];
    const fix = (lines, edges) => {
      let best = null;
      for (const e of edges) for (const L of lines) {
        const d = Math.abs(e.val - L);
        if (d < thr && (!best || d < best.d)) best = { d, off: L - e.val, at: L };
      }
      return best;
    };
    const vb = fix(V, [{ val: x }, { val: x + obj.w / 2 }, { val: x + obj.w }]);
    const hb = fix(H, [{ val: y }, { val: y + obj.h / 2 }, { val: y + obj.h }]);
    let nx = x;
    let ny = y;
    if (vb) { nx = x + vb.off; g.push({ type: "V", at: vb.at }); } else nx = sn(x);
    if (hb) { ny = y + hb.off; g.push({ type: "H", at: hb.at }); } else ny = sn(y);
    return { x: nx, y: ny, guides: g };
  }, [snapOn, view.zoom, plan.walls, plan.items, display.snapObjects, innerL, innerR, innerT, innerB, plan.room.w, plan.room.h]);

  const attachWall = (obj, x, y) => {
    const placed = placeOnWall(obj, { x, y }, plan.walls, plan.room);
    if (placed) return { x: placed.x, y: placed.y, angle: placed.angle };
    const cx = x + obj.w / 2;
    const cy = y + obj.h / 2;
    const d = [
      { k: "T", v: Math.abs(cy - innerT) },
      { k: "B", v: Math.abs(cy - innerB) },
      { k: "L", v: Math.abs(cx - innerL) },
      { k: "R", v: Math.abs(cx - innerR) },
    ].sort((a, b) => a.v - b.v)[0];
    if (d.k === "T") y = innerT;
    else if (d.k === "B") y = innerB - obj.h;
    else if (d.k === "L") x = innerL;
    else x = innerR - obj.w;
    return { x: sn(x), y: sn(y), angle: 0 };
  };

  const snapDraftPt = (raw, from) => {
    let pt = from ? orthoPt(from, raw, snapOn, shiftRef.current) : { x: sn(raw.x), y: sn(raw.y) };
    if (tool === "wall" && display.snapOn) {
      const s = snapWallPoint(pt, plan.walls, plan.room, view.zoom, true, SNAP_STEP);
      if (s.snapped) { pt = { x: s.x, y: s.y }; setDraftSnap(s); }
      else setDraftSnap(null);
    }
    return pt;
  };

  const syncAutoZones = (p) => {
    const loops = findClosedLoops(p.walls.filter((w) => w.role !== "outer"));
    const manual = (p.zones || []).filter((z) => !z.auto);
    const auto = loops.map((poly, i) => {
      const b = polygonBounds(poly);
      return {
        id: uid("zn"),
        ...b,
        name: `Помещение ${manual.length + i + 1}`,
        height: p.room.height || 3000,
        polygon: poly,
        auto: true,
      };
    });
    return { ...p, zones: [...manual, ...auto] };
  };

  const applyTypedLength = () => {
    const len = parseInt(typedLengthRef.current, 10);
    if (!len || draft.length < 1 || !cursor) return false;
    const from = draft[draft.length - 1];
    const to = orthoPt(from, cursor, snapOn, shiftRef.current);
    let axis = null;
    if (Math.abs(to.x - from.x) > Math.abs(to.y - from.y)) axis = "h";
    else axis = "v";
    const pt = pointAtLength(from, to, len, axis);
    setDraft((d) => [...d, pt]);
    setTypedLength("");
    return true;
  };

  const updateObj = (coll, oid, patch) => setPlan((p) => ({ ...p, [coll]: p[coll].map((o) => (o.id === oid ? { ...o, ...patch } : o)) }));
  const delSel = () => {
    if (!sel) return;
    setPlan((p) => {
      const next = { ...p };
      if (sel.coll === "items") {
        next.items = p.items.filter((o) => o.id !== sel.id);
        next.links = (p.links || []).filter((l) => l.fromId !== sel.id && l.toId !== sel.id);
      } else if (sel.coll === "links") {
        next.links = (p.links || []).filter((l) => l.id !== sel.id);
      } else {
        next[sel.coll] = p[sel.coll].filter((o) => o.id !== sel.id);
      }
      return next;
    });
    setSel(null);
  };

  const createLink = (fromId, toId, type) => {
    const fromItem = plan.items.find((i) => i.id === fromId);
    const toItem = plan.items.find((i) => i.id === toId);
    const ends = normalizeLinkEnds(type, fromItem, toItem);
    const dup = (plan.links || []).some(
      (l) => l.type === type && l.fromId === ends.from.id && l.toId === ends.to.id,
    );
    if (dup) return;
    const link = {
      id: uid("lk"),
      type,
      fromId: ends.from.id,
      toId: ends.to.id,
      ortho: true,
      riseMm: null,
    };
    setPlan((p) => ({ ...p, links: [...(p.links || []), link] }));
    setSel({ coll: "links", id: link.id });
  };

  const addItemAt = (mm) => {
    const c = catalogByKind(pending);
    let x = mm.x - c.w / 2;
    let y = mm.y - c.h / 2;
    let angle = 0;
    if (c.wall) {
      const placed = attachWall({ w: c.w, h: c.h }, x, y);
      x = placed.x;
      y = placed.y;
      angle = placed.angle || 0;
    } else if (display.onlyInsideRooms && plan.zones.length > 0) {
      const inside = plan.zones.some((z) => pointInPolygon({ x: mm.x, y: mm.y }, z.polygon?.length >= 3 ? z.polygon : [
        { x: z.x, y: z.y }, { x: z.x + z.w, y: z.y },
        { x: z.x + z.w, y: z.y + z.h }, { x: z.x, y: z.y + z.h },
      ]));
      if (!inside) {
        alert("Объект можно ставить только внутри помещения");
        return;
      }
      const s = snapObj("items", { id: "_new", w: c.w, h: c.h }, x, y);
      x = clamp(s.x, innerL, innerR - c.w);
      y = clamp(s.y, innerT, innerB - c.h);
    } else {
      const s = snapObj("items", { id: "_new", w: c.w, h: c.h }, x, y);
      x = clamp(s.x, innerL, innerR - c.w);
      y = clamp(s.y, innerT, innerB - c.h);
    }
    const item = {
      id: uid("eq"), kind: c.kind, icon: c.icon, layer: c.layer, label: c.label, color: c.color,
      w: c.w, h: c.h, x, y, angle, wall: !!c.wall, params: c.params ? { ...c.params } : null,
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
    const z = { id: uid("zn"), x: sn(mm.x - zw / 2), y: sn(mm.y - zh / 2), w: zw, h: zh, name: "Зона", height: plan.room.height || 3000 };
    setPlan((p) => ({ ...p, zones: [...p.zones, z] }));
    setSel({ coll: "zones", id: z.id });
    setTool("select");
  };

  const addLabelAt = (mm, targetId) => {
    const l = {
      id: uid("lb"), x: sn(mm.x + 300), y: sn(mm.y - 300),
      text: targetId ? catalogByKind(plan.items.find((i) => i.id === targetId)?.kind)?.label || "Подпись" : "Подпись",
      targetId: targetId || null,
    };
    setPlan((p) => ({ ...p, labels: [...p.labels, l] }));
    setSel({ coll: "labels", id: l.id });
    setTool("select");
  };

  const finishDraft = () => {
    if (draft.length >= 2) {
      if (tool === "wall") {
        setPlan((p) => syncAutoZones({
          ...p,
          walls: [...p.walls, { id: uid("wl"), pts: draft, thk: wallThk, role: "partition" }],
        }));
      } else {
        const layer = migrateLayerId(active, null);
        setPlan((p) => ({ ...p, lines: [...p.lines, { id: uid("ln"), layer, pts: draft }] }));
      }
    }
    setDraft([]);
    setDraftSnap(null);
    setTypedLength("");
  };

  const rotateItem = (it, delta) => {
    const next = ((it.angle || 0) + delta) % 360;
    updateObj("items", it.id, { angle: next < 0 ? next + 360 : next });
  };

  const pickLayer = (lid) => {
    setActive(lid);
    setDraft([]);
    setSel(null);
    setGuides([]);
    if (lid === "client" || lid === "install" || lid === "spec") setTool("select");
    else if (lid === "zones") setTool("zone");
    else if (lid === "partitions") setTool("wall");
    else if (lid === "room") setTool("select");
    else if (catalogForLayer(lid).length) {
      setPending(catalogForLayer(lid)[0].kind);
      setTool("add");
    } else if (LINE_STYLE[lid]) setTool("line");
    else setTool("select");
  };

  const handleTool = (t) => {
    setTool(t);
    setLinkFrom(null);
    if (t === "wall" || t === "line") setDraft([]);
    if (t === "add" && !pending && catalogForLayer(active).length) setPending(catalogForLayer(active)[0].kind);
  };

  const handlePending = (kind) => { setPending(kind); setTool("add"); };

  const toggleDisplay = (key) => setDisplay((d) => ({ ...d, [key]: !d[key] }));

  const fitView = () => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const m = 160;
    const z = clamp(Math.min((r.width - m) / plan.room.w, (r.height - m) / plan.room.h), 0.015, 3);
    setView({ zoom: z, panX: (r.width - plan.room.w * z) / 2, panY: (r.height - plan.room.h * z) / 2 });
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
    if (!sel || sel.coll !== "items") return;
    const it = plan.items.find((o) => o.id === sel.id);
    if (it) clipboardRef.current = { ...it };
  };

  const pasteSel = () => {
    const src = clipboardRef.current;
    if (!src) return;
    const item = { ...src, id: uid("eq"), x: src.x + 200, y: src.y + 200 };
    setPlan((p) => ({ ...p, items: [...p.items, item] }));
    setSel({ coll: "items", id: item.id });
  };

  const moveSelByKeys = (e) => {
    if (!sel || !["items", "zones", "labels"].includes(sel.coll)) return;
    const step = e.shiftKey ? 500 : e.altKey ? 10 : 50;
    const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
    const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    const obj = plan[sel.coll].find((o) => o.id === sel.id);
    if (!obj) return;
    updateObj(sel.coll, sel.id, { x: (obj.x || 0) + dx, y: (obj.y || 0) + dy });
  };

  const mirrorItem = (it, axis) => {
    if (axis === "h") updateObj("items", it.id, { mirrorH: !it.mirrorH });
    else updateObj("items", it.id, { mirrorV: !it.mirrorV });
  };

  const duplicateItem = (it) => {
    const copy = { ...it, id: uid("eq"), x: it.x + 200, y: it.y + 200 };
    setPlan((p) => ({ ...p, items: [...p.items, copy] }));
    setSel({ coll: "items", id: copy.id });
  };

  const handleCtxAction = (actionId) => {
    if (!sel) return;
    const obj = plan[sel.coll]?.find((o) => o.id === sel.id);
    if (!obj) return;
    if (actionId === "delete") delSel();
    else if (actionId === "rotate90" && sel.coll === "items") rotateItem(obj, 90);
    else if (actionId === "mirror-h" && sel.coll === "items") mirrorItem(obj, "h");
    else if (actionId === "mirror-v" && sel.coll === "items") mirrorItem(obj, "v");
    else if (actionId === "duplicate" && sel.coll === "items") duplicateItem(obj);
    else if (actionId === "hide-client" && sel.coll === "items") {
      updateObj("items", obj.id, { visibleToClient: obj.visibleToClient === false });
    }
    else if (actionId === "spec" && sel.coll === "items") syncSpec();
    else if (actionId === "wall-thk" && sel.coll === "walls") {
      const thk = prompt("Толщина стены, мм:", String(obj.thk || 100));
      if (thk) updateObj("walls", obj.id, { thk: Math.max(40, +thk || 100) });
    }
    else if (actionId === "wall-height" && sel.coll === "walls") {
      const h = prompt("Высота стены, мм:", String(obj.height || 2700));
      if (h) updateObj("walls", obj.id, { height: Math.max(500, +h || 2700) });
    }
    else if (actionId === "wall-material" && sel.coll === "walls") {
      const mat = prompt("Материал стены:", obj.material || "ГКЛ / профиль");
      if (mat != null) updateObj("walls", obj.id, { material: mat });
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
      w2.id = uid("w");
      setPlan((p) => ({
        ...p,
        walls: p.walls.flatMap((w) => (w.id === obj.id ? [w1, w2] : [w])),
      }));
      setSel({ coll: "walls", id: w2.id });
    }
    else if (actionId === "rename" && sel.coll === "zones") {
      const name = prompt("Название помещения:", obj.name || "Помещение");
      if (name) updateObj("zones", obj.id, { name });
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
      for (const z of plan.zones) {
        if (mm.x >= z.x && mm.x <= z.x + z.w && mm.y >= z.y && mm.y <= z.y + z.h) {
          hit = { coll: "zones", id: z.id };
          break;
        }
      }
    }
    if (!hit && sel) hit = sel;
    if (!hit) return;
    e.preventDefault();
    setSel(hit);
    const obj = plan[hit.coll]?.find((o) => o.id === hit.id);
    setCtxMenu({ x: e.clientX, y: e.clientY, mm, items: buildObjectMenu(obj || {}, hit.coll) });
  };

  const orthoTools = tool === "line" || tool === "wall" || tool === "measure";

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "Shift") shiftRef.current = true;
      if (e.key === "Alt") altSnapRef.current = true;
      if (e.key === " " && document.activeElement === document.body) { e.preventDefault(); setSpacePan(true); }
      if (e.key === "Escape") {
        setDraft([]); setMeasure([]); setSel(null); setGuides([]);
        setTool("select"); setPending(null); setTypedLength(""); setDraftSnap(null);
      }
      if (e.key === "Enter") {
        if (typedLengthRef.current && (tool === "wall" || tool === "line") && draft.length >= 1) {
          e.preventDefault();
          applyTypedLength();
          return;
        }
        if (draft.length >= 2) finishDraft();
      }
      if ((e.key === "Delete" || e.key === "Backspace") && sel && document.activeElement === document.body && !typedLengthRef.current) delSel();
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
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && document.activeElement === document.body) moveSelByKeys(e);
    };
    const onKeyUp = (e) => {
      if (e.key === "Shift") shiftRef.current = false;
      if (e.key === "Alt") altSnapRef.current = false;
      if (e.key === " ") setSpacePan(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
  });

  if (!project) {
    return (
      <div className="content">
        <Empty title="Проект не найден">
          <Link className="btn btn-primary" to="/planner">К планировщику</Link>
        </Empty>
      </div>
    );
  }

  const specSummary = plannerSpecSummary(plan);

  const onDown = (e) => {
    svgRef.current.setPointerCapture(e.pointerId);
    const mm = toMM(e.clientX, e.clientY);
    const panTool = tool === "pan" || spacePan || e.button === 1;
    const bgClick = e.target === svgRef.current || e.target.getAttribute("data-canvas-bg") === "1";

    if (panTool || (tool === "select" && bgClick && e.button === 0)) {
      dragRef.current = { mode: "pan", sx: e.clientX, sy: e.clientY, px: view.panX, py: view.panY };
      return;
    }
    if (active === "spec") return;
    if (tool === "add" && pending) return addItemAt(mm);
    if (tool === "zone") return addZoneAt(mm);
    if (tool === "label") return addLabelAt(mm, null);
    if (tool === "line" || tool === "wall") {
      const last = draft[draft.length - 1];
      const pt = snapDraftPt(mm, last);
      setDraft((d) => [...d, pt]);
      return;
    }
    if (tool === "measure") {
      const pt = measure.length === 1 ? orthoPt(measure[0], mm, snapOn, shiftRef.current) : { x: sn(mm.x), y: sn(mm.y) };
      setMeasure((m) => (m.length >= 2 ? [pt] : [...m, pt]));
      return;
    }
    if (bgClick) setSel(null);
  };

  const onMove = (e) => {
    const raw = toMM(e.clientX, e.clientY);
    let mm = orthoTools && draft.length > 0
      ? snapDraftPt(raw, draft[draft.length - 1])
      : raw;
    if (orthoTools && draft.length > 0 && tool !== "wall") {
      mm = orthoPt(draft[draft.length - 1], raw, snapOn, shiftRef.current);
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
      if (!obj) return;
      let x = d.ox + (mm.x - d.dx);
      let y = d.oy + (mm.y - d.dy);
      if (d.coll === "items" && obj.wall) {
        const placed = attachWall(obj, x, y);
        x = placed.x;
        y = placed.y;
        updateObj(d.coll, d.id, { x, y, angle: placed.angle || obj.angle || 0 });
        setGuides([]);
      } else {
        const s = snapObj(d.coll, obj, x, y);
        x = s.x; y = s.y;
        setGuides(s.guides);
        updateObj(d.coll, d.id, { x, y });
      }
    } else if (d.mode === "wall-move") {
      const dx = mm.x - d.dx;
      const dy = mm.y - d.dy;
      setPlan((p) => ({
        ...p,
        walls: p.walls.map((w) => (w.id !== d.id ? w : {
          ...w,
          pts: d.origPts.map((pt) => ({ x: sn(pt.x + dx), y: sn(pt.y + dy) })),
        })),
      }));
    } else if (d.mode === "resize") {
      const obj = plan[d.coll].find((o) => o.id === d.id);
      if (!obj) return;
      updateObj(d.coll, d.id, { w: Math.max(50, sn(mm.x - obj.x)), h: Math.max(50, sn(mm.y - obj.y)) });
    } else if (d.mode === "node") {
      const snapped = d.coll === "walls"
        ? snapWallPoint({ x: mm.x, y: mm.y }, plan.walls, plan.room, view.zoom, snapOn, SNAP_STEP)
        : { x: sn(mm.x), y: sn(mm.y) };
      setPlan((p) => ({
        ...p,
        [d.coll]: p[d.coll].map((l) => (l.id !== d.id ? l : {
          ...l,
          pts: l.pts.map((pt, i) => (i === d.idx ? { x: snapped.x, y: snapped.y } : pt)),
        })),
      }));
    }
  };

  const onUp = (e) => { dragRef.current = null; setGuides([]); try { svgRef.current.releasePointerCapture(e.pointerId); } catch (_) {} };

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
  const selObj = sel ? plan[sel.coll]?.find((o) => o.id === sel.id) : null;

  const startMove = (e, coll, obj) => {
    e.stopPropagation();
    svgRef.current.setPointerCapture(e.pointerId);
    const mm = toMM(e.clientX, e.clientY);
    setSel({ coll, id: obj.id });
    dragRef.current = { mode: "move", coll, id: obj.id, ox: obj.x, oy: obj.y, dx: mm.x, dy: mm.y };
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
  const startResize = (e, coll, obj) => {
    e.stopPropagation();
    svgRef.current.setPointerCapture(e.pointerId);
    setSel({ coll, id: obj.id });
    dragRef.current = { mode: "resize", coll, id: obj.id };
  };
  const startNode = (e, coll, oid, idx) => {
    e.stopPropagation();
    svgRef.current.setPointerCapture(e.pointerId);
    setSel({ coll, id: oid });
    dragRef.current = { mode: "node", coll, id: oid, idx };
  };
  const startWallMove = (e, wall) => {
    e.stopPropagation();
    svgRef.current.setPointerCapture(e.pointerId);
    const mm = toMM(e.clientX, e.clientY);
    setSel({ coll: "walls", id: wall.id });
    dragRef.current = { mode: "wall-move", id: wall.id, dx: mm.x, dy: mm.y, origPts: wall.pts.map((p) => ({ ...p })) };
  };

  const onItemDown = (e, it) => {
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
    startMove(e, "items", it);
  };

  const exportPDF = async () => {
    setBusy(true);
    try {
      await exportLayeredPDF(
        svgRef.current,
        plan.room,
        PDF_SHEETS.map((l) => ({ id: l.id, sheet: l.sheet })),
        { projectName: project.name, projectId: project.id.replace(/\D/g, "").slice(0, 7), version: "1" }
      );
    } catch (e) { alert("Не удалось собрать PDF: " + e.message); }
    setBusy(false);
  };

  const syncSpec = async () => {
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

  const itemsByLayer = (lid) => {
    if (lid === "sockets") return plan.items.filter((it) => it.layer === "sockets" || (it.kind === "socket" && it.layer === "power"));
    return plan.items.filter((it) => it.layer === lid);
  };
  const linesByLayer = (lid) => plan.lines.filter((l) => l.layer === lid || migrateLayerId(l.layer) === lid);

  const visibleLinks = () => {
    if (!display.showLinks) return [];
    const links = plan.links || [];
    if (active === "install" || active === "client") return links;
    const t = linkTypeForLayer(active);
    if (t) return links.filter((l) => l.type === t);
    if (active === "racks") return links.filter((l) => l.type === "irrigation" || l.type === "power");
    return [];
  };

  const warnList = collectPlannerWarnings(plan, sel);
  const warnIds = new Set(warnList.flatMap((w) => w.objectIds || []));
  const clientItems = plan.items.filter((it) => it.visibleToClient !== false);
  const partitionWalls = wallsForLayer(plan.walls, "partitions");
  const roomWalls = wallsForLayer(plan.walls, "room");

  const draftCursor = orthoTools && draft.length > 0 && cursor
    ? (tool === "wall" ? snapDraftPt(cursor, draft[draft.length - 1]) : orthoPt(draft[draft.length - 1], cursor, snapOn, shiftRef.current))
    : cursor;

  const showLabelFor = (lid) => display.showLabels && (active === lid || active === "install" || active === "client");
  const itemProps = (it, lid, extra = {}) => (
    <ItemEl
      key={extra.key || it.id}
      it={it}
      k={k}
      selected={sel?.id === it.id}
      showDims={display.showDims}
      showLabel={showLabelFor(lid)}
      activeLayer={active}
      vis={vis}
      display={display}
      hasError={warnIds.has(it.id)}
      onDown={(e) => onItemDown(e, it)}
      onResize={(e) => startResize(e, "items", it)}
      onRotateStart={(e) => startRotate(e, it)}
    />
  );

  const cursorStyle = spacePan || tool === "pan" ? "grab" : tool === "add" || tool === "zone" || tool === "label" ? "copy" : tool === "link" ? "crosshair" : "default";

  return (
    <div className="planner-app">
      <PlannerTopBar projectName={project.name} saved={saved} busy={busy} onPdf={exportPDF} onSync={syncSpec} projectId={project.id} />
      <LayerTabs active={active} vis={vis} onPick={pickLayer} onToggleVis={(lid) => setVis((v) => ({ ...v, [lid]: !v[lid] }))} />
      <div className="planner-workspace">
        <ObjectPalette
          active={active}
          tool={tool}
          pending={pending}
          wallThk={wallThk}
          plan={plan}
          specSummary={specSummary}
          onTool={handleTool}
          onPending={handlePending}
          onWallThk={setWallThk}
          onRoomPatch={(patch) => setPlan((p) => ({ ...p, room: { ...p.room, ...patch } }))}
          onSync={syncSpec}
        />
        <div className="planner-canvas-wrap">
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
            <g data-main transform={`translate(${view.panX},${view.panY}) scale(${z})`}>
              <PlanGrid room={plan.room} zoom={z} showGrid={display.showGrid} showMinorGrid={display.showMinorGrid} />
              <g data-layer="room">
                <RoomShell room={plan.room} k={k} />
                {roomWalls.map((w) => (
                  <WallEl
                    key={w.id}
                    wall={w}
                    k={k}
                    editable={active === "room" && (tool === "select" || tool === "wall")}
                    selected={sel?.coll === "walls" && sel?.id === w.id}
                    fmtU={fmtU}
                    showDims={display.showDims && active === "room"}
                    onSel={() => setSel({ coll: "walls", id: w.id })}
                    onNode={startNode}
                    onDel={delSel}
                    onWallMove={startWallMove}
                  />
                ))}
                {display.showDims && active === "room" && <RoomDims room={plan.room} k={k} fmtU={fmtU} />}
                {itemsByLayer("room").map((it) => itemProps(it, "room"))}
              </g>
              <g data-layer="partitions">
                {partitionWalls.map((w) => (
                  <WallEl
                    key={`pt-${w.id}`}
                    wall={w}
                    k={k}
                    editable={active === "partitions" && (tool === "select" || tool === "wall")}
                    selected={sel?.coll === "walls" && sel?.id === w.id}
                    fmtU={fmtU}
                    showDims={display.showDims && active === "partitions"}
                    onSel={() => setSel({ coll: "walls", id: w.id })}
                    onNode={startNode}
                    onDel={delSel}
                    onWallMove={startWallMove}
                  />
                ))}
              </g>
              <g data-layer="zones">
                {plan.zones.map((zn) => (
                  <ZoneEl
                    key={zn.id}
                    zn={zn}
                    k={k}
                    selected={sel?.id === zn.id}
                    activeLayer={active}
                    showDetail={active === "zones" && display.showZoneNames}
                    onDown={(e) => startMove(e, "zones", zn)}
                    onResize={(e) => startResize(e, "zones", zn)}
                    fmtU={fmtU}
                  />
                ))}
              </g>
              {LINE_LAYER_IDS.map((lid) => (
                <g key={lid} data-layer={lid}>
                  {linesByLayer(lid).map((l) => (
                    <LineEl
                      key={l.id}
                      line={l}
                      k={k}
                      showDims={display.showDims}
                      editable={tool === "select" && active === lid}
                      selected={sel?.id === l.id}
                      activeLayer={active}
                      vis={vis}
                      display={display}
                      onSel={() => setSel({ coll: "lines", id: l.id })}
                      onNode={startNode}
                      onDel={delSel}
                      fmtU={fmtU}
                    />
                  ))}
                </g>
              ))}
              <g data-layer="links">
                {visibleLinks().map((link) => (
                  <LinkEl
                    key={link.id}
                    link={link}
                    items={plan.items}
                    room={plan.room}
                    k={k}
                    selected={sel?.coll === "links" && sel.id === link.id}
                    showLabel={display.showDims || display.showHints}
                    onDown={(e) => {
                      e.stopPropagation();
                      if (tool === "select" || tool === "link") setSel({ coll: "links", id: link.id });
                    }}
                    onDel={() => { setSel({ coll: "links", id: link.id }); delSel(); }}
                  />
                ))}
              </g>
              {ITEM_LAYER_IDS.map((lid) => (
                <g key={lid} data-layer={lid}>
                  {itemsByLayer(lid).map((it) => itemProps(it, lid))}
                </g>
              ))}
              {active === "client" && (
                <g data-layer="client">
                  {clientItems.map((it) => itemProps(it, "client", { key: `cl-${it.id}` }))}
                </g>
              )}
              <g data-layer="labels">
                {plan.labels.map((lb) => (
                  <LabelEl key={lb.id} lb={lb} items={plan.items} k={k} selected={sel?.id === lb.id} activeLayer={active} onDown={(e) => startMove(e, "labels", lb)} />
                ))}
              </g>
              <g data-ui="overlay">
                {guides.map((g, i) => (g.type === "V" ? (
                  <line key={i} x1={g.at} y1={-600} x2={g.at} y2={plan.room.h + 600} stroke="#116355" strokeWidth={1 * k} strokeDasharray={`${5 * k} ${4 * k}`} opacity={0.5} />
                ) : (
                  <line key={i} x1={-600} y1={g.at} x2={plan.room.w + 600} y2={g.at} stroke="#116355" strokeWidth={1 * k} strokeDasharray={`${5 * k} ${4 * k}`} opacity={0.5} />
                )))}
                {draft.length > 0 && (
                  <DraftLine
                    pts={draft}
                    cursor={draftCursor}
                    k={k}
                    wall={tool === "wall"}
                    thk={wallThk}
                    color={tool === "wall" ? "#2f3431" : (LINE_STYLE[active] || LINE_STYLE.irrigation)?.color || "#1f6f8b"}
                    fmtU={fmtU}
                    snapPt={draftSnap}
                  />
                )}
                {selObj && sel.coll === "items" && display.showDims && (
                  <SelectionDims it={selObj} room={plan.room} k={k} fmtU={fmtU} />
                )}
                {measure.length > 0 && (
                  <MeasureEl pts={measure} cursor={measure.length === 1 && cursor ? orthoPt(measure[0], cursor, snapOn, shiftRef.current) : cursor} k={k} fmtU={fmtU} />
                )}
              </g>
            </g>
            <g data-ui="screen-hud" transform={`translate(${view.panX},${view.panY})`}>
              <TypedLengthHint value={typedLength} k={k} />
            </g>
          </svg>
          <div className="planner-coords no-print">
            {cursor ? `${Math.round(cursor.x)}, ${Math.round(cursor.y)} мм` : "—"}
            {linkFrom && (
              <span style={{ marginLeft: 10, color: "#1f6f8b" }}>Связь: выберите второй объект</span>
            )}
            {measure.length === 2 && (
              <span style={{ marginLeft: 10, color: "#116355" }}>
                Δ {fmtU(Math.hypot(measure[1].x - measure[0].x, measure[1].y - measure[0].y))}
              </span>
            )}
          </div>
          <PlannerBottomBar
            zoom={z}
            display={display}
            activeLayerName={layerById(active).name}
            onZoomPreset={setZoomTo}
            onZoomSlider={setZoomTo}
            onToggle={toggleDisplay}
            onFit={fitView}
            onCenter={centerView}
            onClearSheet={clearSheet}
          />
        </div>
        <PropertiesPanel
          sel={sel}
          selObj={selObj}
          plan={plan}
          project={project}
          active={active}
          materials={state.materials}
          modules={state.modules}
          updateObj={updateObj}
          rotateItem={rotateItem}
          delSel={delSel}
          fmtU={fmtU}
          onSync={syncSpec}
          specSummary={specSummary}
        />
      </div>
      <ContextMenu menu={ctxMenu} onClose={() => setCtxMenu(null)} onAction={handleCtxAction} />
    </div>
  );
}

function withDefaults(plan) {
  const d = DEFAULT_PLAN();
  if (!plan) return d;
  return {
    ...d,
    ...plan,
    room: { ...d.room, height: 3000, ...plan.room },
    zones: plan.zones || [],
    labels: plan.labels || [],
    walls: (plan.walls || []).map((w) => ({ role: "partition", ...w })),
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
