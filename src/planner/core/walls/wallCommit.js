/**
 * Коммит wall-chain в план.
 */
import {
  commitWallEdge, ensureWallNetwork,
} from "../../wallNetwork.js";

export function commitWallChain(plan, pts, wallProps, makeId, opts = {}) {
  if (!pts || pts.length < 2) return plan;

  const closed = opts.closed === true;
  let chainPts = pts.map((p) => ({ x: p.x, y: p.y }));
  if (closed && chainPts.length >= 3) {
    chainPts.push({ ...chainPts[0] });
  }

  const meta = {
    thk: wallProps.thk ?? 100,
    role: wallProps.role || "partition",
    kind: wallProps.kind || "new",
    thicknessSide: wallProps.thicknessSide || "center",
    height: wallProps.height ?? plan.room?.height ?? 3000,
    material: wallProps.material || "",
    chainId: wallProps.chainId || makeId("ch"),
    type: wallProps.type || "wall",
  };

  let next = ensureWallNetwork({ ...plan }, makeId);
  for (let i = 0; i < chainPts.length - 1; i++) {
    next = commitWallEdge(next, chainPts[i], chainPts[i + 1], meta, makeId);
  }
  return next;
}
