/**
 * Граф стен: plan.nodes + plan.walls (рёбра a/b).
 * pts вычисляются при рендере через resolvePlanWalls().
 */
import { dist, near, NODE_LINK_THR, breakWallAt, alignWallToNeighbor, straightenWall } from "./wallGeometry.js";

export const NODE_MERGE_MM = 1;

export function isNetworkPlan(plan) {
  return plan?.nodes && typeof plan.nodes === "object" && (plan.walls || []).some((w) => w.a && w.b);
}

function pickWallMeta(w) {
  const {
    id, thk, role, kind, thicknessSide, height, material, type, chainId, locked, createdAt, updatedAt,
  } = w;
  return {
    thk: thk ?? 100,
    role: role || "partition",
    kind: kind || "new",
    thicknessSide: thicknessSide || "center",
    height: height ?? 3000,
    material: material || "",
    chainId: chainId || id,
    locked: locked ?? false,
    createdAt: createdAt || Date.now(),
    updatedAt: updatedAt || Date.now(),
    ...(type ? { type } : {}),
  };
}

export function findNodeIdAt(nodes, pt, thr = NODE_MERGE_MM) {
  for (const [id, n] of Object.entries(nodes || {})) {
    if (near(n, pt, thr)) return id;
  }
  return null;
}

export function findOrCreateNode(nodes, pt, makeId, thr = NODE_MERGE_MM) {
  const existing = findNodeIdAt(nodes, pt, thr);
  if (existing) return { nodes, id: existing };
  const id = makeId("n");
  return { nodes: { ...nodes, [id]: { x: pt.x, y: pt.y } }, id };
}

export function pruneOrphanNodes(nodes, walls) {
  const used = new Set();
  (walls || []).forEach((w) => {
    if (w.a) used.add(w.a);
    if (w.b) used.add(w.b);
  });
  const next = {};
  for (const id of used) {
    if (nodes?.[id]) next[id] = { ...nodes[id] };
  }
  return next;
}

/** pts-стены → nodes + рёбра (дедуп узлов ~1 мм). */
export function migratePtsWallsToNetwork(walls, makeId, existingNodes = {}) {
  let nodes = { ...existingNodes };
  const edges = [];

  for (const w of walls || []) {
    if (w.a && w.b && nodes[w.a] && nodes[w.b]) {
      edges.push({ id: w.id, a: w.a, b: w.b, ...pickWallMeta(w) });
      continue;
    }
    const pts = w.pts || [];
    if (pts.length < 2) continue;
    for (let i = 0; i < pts.length - 1; i++) {
      let rA = findOrCreateNode(nodes, pts[i], makeId);
      nodes = rA.nodes;
      let rB = findOrCreateNode(nodes, pts[i + 1], makeId);
      nodes = rB.nodes;
      if (rA.id === rB.id) continue;
      edges.push({
        id: pts.length === 2 ? w.id : `${w.id}_s${i}`,
        a: rA.id,
        b: rB.id,
        ...pickWallMeta(w),
      });
    }
  }
  return { nodes, walls: edges };
}

/** Рёбра → стены с pts для рендера и legacy-API. */
export function resolvePlanWalls(plan) {
  const nodes = plan?.nodes || {};
  const walls = plan?.walls || [];
  if (!Object.keys(nodes).length) {
    return walls.filter((w) => w.pts?.length >= 2).map((w) => ({ ...w }));
  }
  return walls
    .filter((w) => w.a && w.b && nodes[w.a] && nodes[w.b])
    .map((w) => ({
      ...w,
      nodeA: w.a,
      nodeB: w.b,
      pts: [{ x: nodes[w.a].x, y: nodes[w.a].y }, { x: nodes[w.b].x, y: nodes[w.b].y }],
    }));
}

export function ensureWallNetwork(plan, makeId) {
  if (isNetworkPlan(plan)) {
    return {
      ...plan,
      nodes: plan.nodes || {},
      walls: (plan.walls || []).filter((w) => w.a && w.b),
    };
  }
  const hasPts = (plan.walls || []).some((w) => w.pts?.length >= 2);
  if (!hasPts) return { ...plan, nodes: plan.nodes || {}, walls: plan.walls || [] };
  const { nodes, walls } = migratePtsWallsToNetwork(plan.walls, makeId, plan.nodes || {});
  return { ...plan, nodes, walls };
}

/** Добавить ребро между двумя точками (узлы сливаются при совпадении). */
export function commitWallEdge(plan, fromPt, toPt, props, makeId) {
  let nodes = { ...(plan.nodes || {}) };
  let rA = findOrCreateNode(nodes, fromPt, makeId, NODE_LINK_THR);
  nodes = rA.nodes;
  let rB = findOrCreateNode(nodes, toPt, makeId, NODE_LINK_THR);
  nodes = rB.nodes;
  if (rA.id === rB.id) return plan;
  const walls = [
    ...(plan.walls || []),
    {
      id: makeId("wl"),
      a: rA.id,
      b: rB.id,
      thk: props.thk ?? 100,
      role: props.role || "partition",
      kind: props.kind || "new",
      thicknessSide: props.thicknessSide || "center",
      height: props.height ?? plan.room?.height ?? 3000,
      material: props.material || "",
    },
  ];
  return { ...plan, nodes, walls };
}

export function movePlanNode(plan, nodeId, pt) {
  if (!plan?.nodes?.[nodeId]) return plan;
  return {
    ...plan,
    nodes: { ...plan.nodes, [nodeId]: { x: pt.x, y: pt.y } },
  };
}

export function deleteWallEdge(plan, wallId) {
  const walls = (plan.walls || []).filter((w) => w.id !== wallId);
  const nodes = pruneOrphanNodes(plan.nodes || {}, walls);
  return { ...plan, walls, nodes };
}

export function wallNodeIdAt(wall, nodeIdx) {
  if (nodeIdx === 0) return wall.nodeA || wall.a;
  if (nodeIdx === 1) return wall.nodeB || wall.b;
  return null;
}

/** Все узлы для snap (координаты из plan.nodes). */
export function collectNetworkNodePoints(plan) {
  return Object.entries(plan?.nodes || {}).map(([id, n]) => ({ ...n, id }));
}

/** Сварить близкие узлы в один id (после импорта). */
export function mergeCloseNodes(plan, thr = NODE_LINK_THR) {
  const nodes = { ...(plan.nodes || {}) };
  const ids = Object.keys(nodes);
  const remap = {};
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i];
      const b = ids[j];
      if (remap[b]) continue;
      if (near(nodes[a], nodes[b], thr)) remap[b] = remap[a] || a;
    }
  }
  if (!Object.keys(remap).length) return plan;
  const nextNodes = {};
  for (const [id, n] of Object.entries(nodes)) {
    const target = remap[id] || id;
    if (!nextNodes[target]) nextNodes[target] = { ...n };
  }
  const walls = (plan.walls || []).map((w) => ({
    ...w,
    a: remap[w.a] || w.a,
    b: remap[w.b] || w.b,
  })).filter((w) => w.a && w.b && w.a !== w.b && nextNodes[w.a] && nextNodes[w.b]);
  return { ...plan, nodes: pruneOrphanNodes(nextNodes, walls), walls };
}

export function applyNetworkNodeAtWall(plan, wallId, nodeIdx, newPt) {
  const wall = (plan.walls || []).find((w) => w.id === wallId);
  if (!wall?.a) return plan;
  const nodeId = nodeIdx === 0 ? wall.a : nodeIdx === 1 ? wall.b : null;
  if (!nodeId) return plan;
  return movePlanNode(plan, nodeId, newPt);
}

export function applyNetworkWallSegMove(plan, wallId, newA, newB) {
  let p = applyNetworkNodeAtWall(plan, wallId, 0, newA);
  return applyNetworkNodeAtWall(p, wallId, 1, newB);
}

/** Сдвиг выделенной стены/узла (клавиши-стрелки). */
export function nudgeWallInPlan(plan, wallId, nodeIdx, dx, dy, round = (v) => v) {
  const rw = resolvePlanWalls(plan).find((w) => w.id === wallId);
  if (!rw?.pts?.length) return plan;
  if (nodeIdx != null && nodeIdx >= 0) {
    const pt = rw.pts[nodeIdx];
    const nodeId = wallNodeIdAt(rw, nodeIdx);
    if (!nodeId) return plan;
    return movePlanNode(plan, nodeId, { x: round(pt.x + dx), y: round(pt.y + dy) });
  }
  let p = plan;
  const limit = rw.pts.length === 2 ? 2 : rw.pts.length;
  for (let i = 0; i < limit; i++) {
    const nodeId = wallNodeIdAt(rw, i);
    const pt = rw.pts[i];
    if (nodeId) p = movePlanNode(p, nodeId, { x: round(pt.x + dx), y: round(pt.y + dy) });
  }
  return p;
}

function collinear(A, S, C, eps = 8) {
  const cross = Math.abs((S.x - A.x) * (C.y - A.y) - (S.y - A.y) * (C.x - A.x));
  const len = Math.hypot(C.x - A.x, C.y - A.y);
  return len > 1 && cross / len < eps;
}

/** Объединить два смежных коллинеарных ребра. */
export function tryMergeWallEdge(plan, wallId) {
  const w = (plan.walls || []).find((x) => x.id === wallId);
  if (!w?.a || !w?.b) return null;
  const nodes = plan.nodes || {};
  for (const other of plan.walls || []) {
    if (other.id === wallId || !other.a || !other.b) continue;
    const tries = [
      { shared: w.b, freeA: w.a, freeC: other.b, match: w.b === other.a },
      { shared: w.b, freeA: w.a, freeC: other.a, match: w.b === other.b },
      { shared: w.a, freeA: w.b, freeC: other.a, match: w.a === other.b },
      { shared: w.a, freeA: w.b, freeC: other.b, match: w.a === other.a },
    ];
    for (const { shared, freeA, freeC, match } of tries) {
      if (!match) continue;
      const A = nodes[freeA];
      const S = nodes[shared];
      const C = nodes[freeC];
      if (!A || !S || !C || !collinear(A, S, C)) continue;
      const meta = pickWallMeta(w);
      const walls = (plan.walls || [])
        .filter((x) => x.id !== other.id && x.id !== wallId)
        .concat([{ id: wallId, a: freeA, b: freeC, ...meta }]);
      return {
        plan: { ...plan, nodes: pruneOrphanNodes(nodes, walls), walls },
        mergedId: wallId,
      };
    }
  }
  return null;
}

/** Разорвать ребро в точке клика — два ребра с общим узлом. */
export function breakWallEdgeAt(plan, wallId, clickPt, makeId) {
  const rw = resolvePlanWalls(plan).find((w) => w.id === wallId);
  const parts = breakWallAt(rw, clickPt);
  if (!parts) return null;
  const splitPt = parts[0].pts[parts[0].pts.length - 1];
  let nodes = { ...(plan.nodes || {}) };
  const rMid = findOrCreateNode(nodes, splitPt, makeId);
  nodes = rMid.nodes;
  const meta = pickWallMeta(rw);
  const walls = (plan.walls || [])
    .filter((w) => w.id !== wallId)
    .concat([
      { id: wallId, a: rw.a, b: rMid.id, ...meta },
      { id: makeId("wl"), a: rMid.id, b: rw.b, ...meta },
    ]);
  const newWallId = walls[walls.length - 1].id;
  return { plan: { ...plan, nodes, walls }, newWallId };
}

export function straightenWallEdge(plan, wallId, mode = "h") {
  const rw = resolvePlanWalls(plan).find((w) => w.id === wallId);
  if (!rw) return plan;
  const nw = straightenWall(rw, mode);
  let p = movePlanNode(plan, rw.a, nw.pts[0]);
  return movePlanNode(p, rw.b, nw.pts[1]);
}

export function alignWallEdgeToNeighbor(plan, wallId) {
  const resolved = resolvePlanWalls(plan);
  const next = alignWallToNeighbor(resolved, wallId);
  if (!next) return null;
  const nw = next.find((w) => w.id === wallId);
  const ow = resolved.find((w) => w.id === wallId);
  if (!nw || !ow) return null;
  let p = plan;
  if (!near(nw.pts[0], ow.pts[0], 0.5)) p = movePlanNode(p, ow.a, nw.pts[0]);
  if (!near(nw.pts[1], ow.pts[1], 0.5)) p = movePlanNode(p, ow.b, nw.pts[1]);
  return p;
}
