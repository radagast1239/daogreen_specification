/**
 * PHASE 2F1-LIVE4.4 — selected-wall SEMANTIC dimension set.
 *
 * Stage A of the selected-dimension pipeline. Computed from plan + selection
 * identity only. MUST NOT read:
 *   - pointer / cursor coordinates
 *   - hover state
 *   - control occupancy / grip hotspots
 *   - collision packing
 *   - viewport LOD (except an explicit overview flag passed by the caller)
 *
 * Stage B (placement: labelT, knockout, bounded lane) consumes this immutable
 * set and may never add/remove/replace faces or change measured values.
 */
import { resolveLogicalWallChain } from "../walls/logicalWallChain.js";
import { resolveLogicalSelectedWallPhysicalSpans } from "../walls/selectedWallPhysicalSpans.js";
import { formatLiveLength } from "../walls/liveWallMeasurements.js";

const FACE_EQ_EPS_MM = 0.5;

/**
 * @param {object} args
 * @param {object} args.plan
 * @param {string} args.wallId selected topology segment id
 * @param {object} [args.room]
 * @param {object} [args.measurements] optional already-built live edit model
 * @param {boolean} [args.allowOverviewCollapse=false] when true AND overview,
 *        a secondary equal-priority face may be omitted — never at normal zoom
 * @param {boolean} [args.overview=false]
 */
export function resolveSelectedDimensionSemantics({
  plan,
  wallId,
  room = null,
  measurements = null,
  allowOverviewCollapse = false,
  overview = false,
} = {}) {
  if (!plan || !wallId) {
    return {
      wallId: wallId || null,
      lineageIds: [],
      faces: [],
      suppressSpans: [],
      centerline: null,
      facesDiffer: false,
      overviewCollapsed: false,
    };
  }

  const chain = resolveLogicalWallChain(plan, wallId);
  const lineageIds = (chain?.wallIds?.length ? chain.wallIds : [wallId]).map(String);

  const physical = measurements?.physical
    || resolveLogicalSelectedWallPhysicalSpans(plan, wallId, {
      room: room || plan.room,
    });

  const faces = [];
  if (physical?.faceA && physical?.faceB) {
    const differ = Math.abs(physical.faceA.lengthMm - physical.faceB.lengthMm) > FACE_EQ_EPS_MM
      || physical.facesDiffer === true;
    if (differ) {
      faces.push(faceDesc("A", physical.faceA, measurements));
      faces.push(faceDesc("B", physical.faceB, measurements));
    } else {
      // Equal faces: keep the same single-face choice live edit already made,
      // but never invent a cursor-dependent side.
      const fromLive = (measurements?.labels || []).find((l) => l.kind === "face");
      if (fromLive?.a && fromLive?.b) {
        faces.push({
          id: fromLive.id || "live-edit-face",
          face: fromLive.face || "A",
          mm: fromLive.mm,
          text: fromLive.text || formatLiveLength(fromLive.mm),
          a: { ...fromLive.a },
          b: { ...fromLive.b },
          exterior: !!fromLive.exterior,
        });
      } else {
        faces.push(faceDesc("A", physical.faceA, measurements));
      }
    }
  } else if (Array.isArray(measurements?.labels)) {
    for (const l of measurements.labels) {
      if (l?.kind === "face" && l.a && l.b) {
        faces.push({
          id: l.id,
          face: l.face || null,
          mm: l.mm,
          text: l.text,
          a: { ...l.a },
          b: { ...l.b },
          exterior: !!l.exterior,
        });
      }
    }
  }

  let overviewCollapsed = false;
  let visibleFaces = faces;
  if (overview && allowOverviewCollapse && faces.length > 1) {
    const keep = faces.find((f) => f.exterior) || faces[0];
    visibleFaces = [keep];
    overviewCollapsed = true;
  }

  const suppressSpans = visibleFaces
    .filter((f) => f.a && f.b)
    .map((f) => ({ a: { ...f.a }, b: { ...bCopy(f.b) } }));

  // Always suppress using the FULL physical face pair when both exist, so a
  // later overview collapse of the painted set cannot re-admit a background
  // dim for the hidden face.
  const suppressFromPhysical = [];
  if (physical?.faceA?.a && physical?.faceA?.b) {
    suppressFromPhysical.push({ a: { ...physical.faceA.a }, b: { ...physical.faceA.b } });
  }
  if (physical?.faceB?.a && physical?.faceB?.b) {
    suppressFromPhysical.push({ a: { ...physical.faceB.a }, b: { ...physical.faceB.b } });
  }

  return {
    wallId: String(wallId),
    logicalId: physical?.logicalId || chain?.logicalId || wallId,
    lineageIds,
    faces: visibleFaces,
    allFaces: faces,
    suppressSpans: suppressFromPhysical.length ? suppressFromPhysical : suppressSpans,
    centerline: physical?.centerline
      ? {
        a: { ...physical.centerline.a },
        b: { ...physical.centerline.b },
        lengthMm: physical.centerline.lengthMm,
      }
      : null,
    facesDiffer: faces.length > 1,
    overviewCollapsed,
    fingerprint: fingerprintOf(visibleFaces, lineageIds),
  };
}

function bCopy(p) {
  return { x: p.x, y: p.y };
}

function faceDesc(key, span, measurements) {
  const fromLive = (measurements?.labels || []).find(
    (l) => l.kind === "face" && (l.face === key || l.id === `live-edit-face-${key}`),
  );
  const mm = fromLive?.mm ?? span.lengthMm;
  return {
    id: fromLive?.id || `live-edit-face-${key}`,
    face: key,
    mm,
    text: fromLive?.text || formatLiveLength(mm),
    a: { ...span.a },
    b: { ...span.b },
    exterior: !!fromLive?.exterior,
  };
}

function fingerprintOf(faces, lineageIds) {
  const facePart = (faces || [])
    .map((f) => `${f.id}|${f.face}|${Math.round(f.mm || 0)}|${q(f.a)}>${q(f.b)}`)
    .sort()
    .join(";");
  return `${[...lineageIds].sort().join(",")}|${facePart}`;
}

function q(p) {
  if (!p) return "-";
  return `${Math.round(p.x)},${Math.round(p.y)}`;
}

/**
 * True when two semantic fingerprints describe the same measured set.
 * Pointer/hover/placement must never change this.
 */
export function semanticsEqual(a, b) {
  return !!a && !!b && a.fingerprint === b.fingerprint;
}
