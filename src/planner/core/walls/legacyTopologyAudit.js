/**
 * PHASE 2F1 — classify STORED wall topology before changing any behaviour.
 *
 * The reported defects are fixture-specific, not universal: in the same project
 * most rooms move, tee and heal correctly while a few old ones do not. Treating
 * that as one interaction bug would mean changing behaviour for the rooms that
 * already work. So the stored structure is classified first, and each class
 * gets its own defensible answer.
 *
 * Two collinear walls that touch are NOT evidence of a split host. The
 * discriminator is lineage provenance, which the canonical model already
 * records: wallNetwork normalises `chainId` to the wall's own id, so
 *
 *   - a wall drawn on its own has          chainId === id      (self-rooted)
 *   - splitting a host copies its chainId, so the pair shares one chainId and
 *     EXACTLY ONE of them is self-rooted (the surviving original record)
 *   - two independently drawn collinear walls are BOTH self-rooted with
 *     DIFFERENT chainIds
 *
 * That distinction is what separates "heal this" from "leave this alone".
 *
 * Pure: no plan mutation, no React, no DOM.
 */

export const TOPOLOGY_CLASS = Object.freeze({
  /** A. one original host currently split by a real, attached branch */
  LEGITIMATE_LIVE_T_SPLIT: "LEGITIMATE_LIVE_T_SPLIT",
  /** B. compatible halves of one original host, branch long gone */
  ORPHAN_HOST_SPLIT: "ORPHAN_HOST_SPLIT",
  /** C. separately drawn walls that merely look like one wall */
  INDEPENDENT_COLLINEAR_WALLS: "INDEPENDENT_COLLINEAR_WALLS",
  /** D. same coordinates, different node ids */
  COINCIDENT_BUT_DISTINCT_NODES: "COINCIDENT_BUT_DISTINCT_NODES",
  /** E. walls meet on screen with no topology node */
  UNNODED_CROSSING: "UNNODED_CROSSING",
  /** F. collinear pair that may not merge — properties differ */
  PROPERTY_MISMATCH: "PROPERTY_MISMATCH",
  /** G. collinear pair with no evidence of one original host */
  LINEAGE_MISMATCH: "LINEAGE_MISMATCH",
  /** H. persisted data predating current invariants */
  STALE_LEGACY_PLAN_STRUCTURE: "STALE_LEGACY_PLAN_STRUCTURE",
  /** I. several of the above on the same structure */
  MIXED_LEGACY_STRUCTURE: "MIXED_LEGACY_STRUCTURE",
});

/**
 * Is this class a DEFECT, or a structure that is simply worth naming?
 *
 * A live T split and two separately drawn collinear walls are both correct
 * states — reporting them as faults would push exactly the global "fix" this
 * phase exists to avoid. Property and lineage differences are legitimate user
 * data: reported, never "corrected".
 */
export const CLASS_SEVERITY = Object.freeze({
  [TOPOLOGY_CLASS.LEGITIMATE_LIVE_T_SPLIT]: "by_design",
  [TOPOLOGY_CLASS.INDEPENDENT_COLLINEAR_WALLS]: "by_design",
  [TOPOLOGY_CLASS.PROPERTY_MISMATCH]: "informational",
  [TOPOLOGY_CLASS.LINEAGE_MISMATCH]: "informational",
  [TOPOLOGY_CLASS.ORPHAN_HOST_SPLIT]: "defect",
  [TOPOLOGY_CLASS.UNNODED_CROSSING]: "defect",
  [TOPOLOGY_CLASS.COINCIDENT_BUT_DISTINCT_NODES]: "defect",
  [TOPOLOGY_CLASS.STALE_LEGACY_PLAN_STRUCTURE]: "defect",
  [TOPOLOGY_CLASS.MIXED_LEGACY_STRUCTURE]: "informational",
});

export function severityOf(topologyClass) {
  return CLASS_SEVERITY[topologyClass] || "informational";
}

/** Fields that must agree before two segments could ever be one wall. */
export const IDENTITY_FIELDS = Object.freeze([
  "thk", "role", "kind", "thicknessSide", "height", "material", "locked",
]);

const COLLINEAR_CROSS_EPS = 0.02;
const OPPOSITE_DOT_MAX = -0.98;
const COINCIDENT_NODE_MM = 1.5;
const ON_BODY_MM = 1.5;
const MIN_ARM_MM = 1;
/** Distance from a body end within which "on the body" is really "at the end". */
const BODY_END_MARGIN_MM = 2;

const num = (v) => (Number.isFinite(v) ? v : null);

function otherNodeId(wall, nodeId) {
  if (wall?.a === nodeId) return wall.b;
  if (wall?.b === nodeId) return wall.a;
  return null;
}

function mismatchedFields(a, b) {
  return IDENTITY_FIELDS.filter((f) => (a?.[f] ?? null) !== (b?.[f] ?? null));
}

/** Do the two walls run straight THROUGH the shared node (never a corner)? */
export function runsStraightThrough(nodes, nodeId, wallA, wallB) {
  const S = nodes?.[nodeId];
  const A = nodes?.[otherNodeId(wallA, nodeId)];
  const B = nodes?.[otherNodeId(wallB, nodeId)];
  if (!S || !A || !B) return false;
  const ux = A.x - S.x;
  const uy = A.y - S.y;
  const vx = B.x - S.x;
  const vy = B.y - S.y;
  const lu = Math.hypot(ux, uy);
  const lv = Math.hypot(vx, vy);
  if (lu < MIN_ARM_MM || lv < MIN_ARM_MM) return false;
  const cross = Math.abs((ux / lu) * (vy / lv) - (uy / lu) * (vx / lv));
  const dot = (ux / lu) * (vx / lv) + (uy / lu) * (vy / lv);
  return cross <= COLLINEAR_CROSS_EPS && dot <= OPPOSITE_DOT_MAX;
}

/**
 * Lineage verdict for a collinear, contiguous pair.
 * @returns {{provenance:"split"|"independent"|"unknown", reason:string,
 *            chainId:string|null, selfRooted:string[]}}
 */
export function classifyPairProvenance(wallA, wallB) {
  const ca = wallA?.chainId ?? null;
  const cb = wallB?.chainId ?? null;
  const selfRooted = [];
  if (ca != null && ca === wallA.id) selfRooted.push(wallA.id);
  if (cb != null && cb === wallB.id) selfRooted.push(wallB.id);

  if (ca == null || cb == null) {
    return { provenance: "unknown", reason: "missing_chain_lineage", chainId: null, selfRooted };
  }
  if (ca !== cb) {
    // Both are their own root: each was drawn as its own wall.
    if (selfRooted.length === 2) {
      return {
        provenance: "independent",
        reason: "both_walls_are_their_own_chain_root",
        chainId: null,
        selfRooted,
      };
    }
    return { provenance: "unknown", reason: "different_chain_lineage", chainId: null, selfRooted };
  }
  // Shared lineage. A split keeps the original record self-rooted and mints the
  // other; a polyline chain shares a chainId that roots on neither.
  return {
    provenance: "split",
    reason: selfRooted.length === 1
      ? "shared_chain_with_one_surviving_original_record"
      : "shared_chain_lineage",
    chainId: ca,
    selfRooted,
  };
}

function segmentPoints(plan, wall) {
  const a = plan.nodes?.[wall.a];
  const b = plan.nodes?.[wall.b];
  if (a && b) return [a, b];
  const pts = wall.pts;
  if (pts?.length >= 2) return [pts[0], pts[pts.length - 1]];
  return null;
}

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-9) return { d: Math.hypot(p.x - a.x, p.y - a.y), t: 0 };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return { d: Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)), t, len: Math.sqrt(l2) };
}

/**
 * Every classified anomaly in a stored plan.
 *
 * @param {object} plan canonical plan (nodes + walls[].a/b)
 * @returns {{anomalies:Array, byWallId:Object, stats:Object}}
 */
export function classifyPlanTopologyAnomalies(plan) {
  const nodes = plan?.nodes || {};
  const walls = (plan?.walls || []).filter(Boolean);
  const anomalies = [];

  const incident = new Map();
  for (const w of walls) {
    for (const n of [w.a, w.b]) {
      if (!n) continue;
      if (!incident.has(n)) incident.set(n, []);
      incident.get(n).push(w);
    }
  }

  // ---- H. stale legacy records -------------------------------------------
  for (const w of walls) {
    const issues = [];
    if (!w.a || !w.b) issues.push("no_network_endpoints");
    else if (!nodes[w.a] || !nodes[w.b]) issues.push("dangling_node_reference");
    if (w.chainId == null) issues.push("no_chain_lineage");
    if (!issues.length) continue;
    anomalies.push({
      class: TOPOLOGY_CLASS.STALE_LEGACY_PLAN_STRUCTURE,
      wallIds: [w.id],
      nodeIds: [w.a, w.b].filter(Boolean),
      issues,
      repairable: false,
      detail: "record predates the canonical nodes + a/b model",
    });
  }

  // ---- collinear contiguous pairs (the "divided wall" family) -------------
  for (const [nodeId, inc] of incident) {
    if (!nodes[nodeId]) continue;
    for (let i = 0; i < inc.length; i++) {
      for (let j = i + 1; j < inc.length; j++) {
        const A = inc[i];
        const B = inc[j];
        if (!runsStraightThrough(nodes, nodeId, A, B)) continue;

        const mismatch = mismatchedFields(A, B);
        const lineage = classifyPairProvenance(A, B);
        // Anything else at this node is a live branch.
        const branches = inc.filter((w) => w.id !== A.id && w.id !== B.id).map((w) => w.id).sort();

        const base = {
          wallIds: [A.id, B.id],
          nodeIds: [nodeId],
          junctionNodeId: nodeId,
          junctionDegree: inc.length,
          branchWallIds: branches,
          chainIds: [A.chainId ?? null, B.chainId ?? null],
          lineage,
          propertyMismatch: mismatch,
        };

        if (branches.length) {
          // A real branch is attached here.
          if (mismatch.length) {
            anomalies.push({
              ...base,
              class: TOPOLOGY_CLASS.PROPERTY_MISMATCH,
              repairable: false,
              detail: `live branch present, but halves differ on: ${mismatch.join(", ")}`,
            });
          } else if (lineage.provenance === "split") {
            anomalies.push({
              ...base,
              class: TOPOLOGY_CLASS.LEGITIMATE_LIVE_T_SPLIT,
              repairable: false,
              detail: "one original host currently split by an attached branch — leave as is",
            });
          } else if (lineage.provenance === "independent") {
            anomalies.push({
              ...base,
              class: TOPOLOGY_CLASS.INDEPENDENT_COLLINEAR_WALLS,
              repairable: false,
              detail: "a branch meets two walls that were drawn separately — never merge them",
            });
          } else {
            anomalies.push({
              ...base,
              class: TOPOLOGY_CLASS.LINEAGE_MISMATCH,
              repairable: false,
              detail: `no proof of one original host (${lineage.reason})`,
            });
          }
          continue;
        }

        // Degree 2: nothing else uses this node.
        if (mismatch.length) {
          anomalies.push({
            ...base,
            class: TOPOLOGY_CLASS.PROPERTY_MISMATCH,
            repairable: false,
            detail: `collinear pair kept apart by: ${mismatch.join(", ")}`,
          });
        } else if (lineage.provenance === "split") {
          anomalies.push({
            ...base,
            class: TOPOLOGY_CLASS.ORPHAN_HOST_SPLIT,
            repairable: true,
            detail: "one original host still split after its branch disappeared — safe to heal",
          });
        } else if (lineage.provenance === "independent") {
          anomalies.push({
            ...base,
            class: TOPOLOGY_CLASS.INDEPENDENT_COLLINEAR_WALLS,
            repairable: false,
            detail: "two separately drawn walls that merely look like one — leave separate",
          });
        } else {
          anomalies.push({
            ...base,
            class: TOPOLOGY_CLASS.LINEAGE_MISMATCH,
            repairable: false,
            detail: `collinear pair with no host provenance (${lineage.reason})`,
          });
        }
      }
    }
  }

  // ---- D. coincident but distinct nodes -----------------------------------
  const nodeIds = Object.keys(nodes);
  for (let i = 0; i < nodeIds.length; i++) {
    for (let j = i + 1; j < nodeIds.length; j++) {
      const p = nodes[nodeIds[i]];
      const q = nodes[nodeIds[j]];
      if (!p || !q) continue;
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d > COINCIDENT_NODE_MM) continue;
      anomalies.push({
        class: TOPOLOGY_CLASS.COINCIDENT_BUT_DISTINCT_NODES,
        nodeIds: [nodeIds[i], nodeIds[j]],
        wallIds: [
          ...(incident.get(nodeIds[i]) || []).map((w) => w.id),
          ...(incident.get(nodeIds[j]) || []).map((w) => w.id),
        ].sort(),
        distanceMm: num(d),
        repairable: false,
        detail: "one point on screen, two nodes in the model — weld only with proof",
      });
    }
  }

  // ---- E. an endpoint sitting on another wall's BODY with no node ---------
  // This is the structure behind "a wall passes through another wall": the
  // walls look joined, but the mover sees a free end and the host sees no
  // branch, so nothing constrains the motion and nothing heals on delete.
  for (const w of walls) {
    const seg = segmentPoints(plan, w);
    if (!seg) continue;
    for (const endpoint of ["a", "b"]) {
      const nodeId = w[endpoint];
      const p = nodes[nodeId];
      if (!p) continue;
      for (const host of walls) {
        if (host.id === w.id) continue;
        // Already a real connection?
        if (host.a === nodeId || host.b === nodeId) continue;
        const hs = segmentPoints(plan, host);
        if (!hs) continue;
        const { d, t, len } = distanceToSegment(p, hs[0], hs[1]);
        if (d > ON_BODY_MM) continue;
        const along = (t ?? 0) * (len ?? 0);
        // Ends are corners, not body hits — those are handled by node welding.
        if (along <= BODY_END_MARGIN_MM || along >= (len ?? 0) - BODY_END_MARGIN_MM) continue;
        anomalies.push({
          class: TOPOLOGY_CLASS.UNNODED_CROSSING,
          subtype: "endpoint_on_body",
          wallIds: [w.id, host.id],
          nodeIds: [nodeId],
          branchWallId: w.id,
          hostWallId: host.id,
          atMm: num(along),
          distanceMm: num(d),
          repairable: true,
          detail: "branch endpoint lies on the host body but shares no node — visual join only",
        });
      }
    }
  }

  // ---- E. two bodies crossing with no node at the intersection ------------
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const A = walls[i];
      const B = walls[j];
      if (A.a === B.a || A.a === B.b || A.b === B.a || A.b === B.b) continue;
      const pa = segmentPoints(plan, A);
      const pb = segmentPoints(plan, B);
      if (!pa || !pb) continue;
      const [p1, p2] = pa;
      const [p3, p4] = pb;
      const d1x = p2.x - p1.x;
      const d1y = p2.y - p1.y;
      const d2x = p4.x - p3.x;
      const d2y = p4.y - p3.y;
      const den = d1x * d2y - d1y * d2x;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / den;
      const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / den;
      const eps = 1e-6;
      if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) continue;
      const at = { x: p1.x + d1x * t, y: p1.y + d1y * t };
      // A node already there (under a different id) is case D, not E.
      const hasNode = Object.values(nodes).some(
        (n) => Math.hypot(n.x - at.x, n.y - at.y) <= COINCIDENT_NODE_MM,
      );
      if (hasNode) continue;
      anomalies.push({
        class: TOPOLOGY_CLASS.UNNODED_CROSSING,
        subtype: "body_crossing",
        wallIds: [A.id, B.id],
        nodeIds: [],
        at: { x: num(at.x), y: num(at.y) },
        repairable: true,
        detail: "two wall bodies cross with no shared node",
      });
    }
  }

  // ---- I. several classes on the same wall --------------------------------
  const byWallId = {};
  for (const a of anomalies) {
    for (const id of a.wallIds || []) {
      if (!byWallId[id]) byWallId[id] = [];
      byWallId[id].push(a.class);
    }
  }
  const mixed = Object.entries(byWallId)
    .filter(([, classes]) => new Set(classes).size > 1)
    .map(([id, classes]) => ({ wallId: id, classes: [...new Set(classes)] }));
  for (const m of mixed) {
    anomalies.push({
      class: TOPOLOGY_CLASS.MIXED_LEGACY_STRUCTURE,
      wallIds: [m.wallId],
      nodeIds: [],
      classes: m.classes,
      repairable: false,
      detail: "several legacy defects coexist on this wall — repair each by its own rule",
    });
  }

  for (const a of anomalies) a.severity = severityOf(a.class);

  const stats = {};
  for (const a of anomalies) stats[a.class] = (stats[a.class] || 0) + 1;
  const defects = anomalies.filter((a) => a.severity === "defect");
  return { anomalies, defects, byWallId, stats };
}

/** Only the anomalies a bounded, provable repair may touch. */
export function repairableAnomalies(audit) {
  return (audit?.anomalies || []).filter((a) => a.repairable);
}
