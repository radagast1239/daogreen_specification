import {
  dist,
  planHasDrawnWalls,
  pointInPolygon,
  polygonArea,
  polygonBounds,
  polygonCentroid,
  projectOnSegment,
  resolveWallPtsList,
  wallSegments,
  weldWallNodes,
  findClosedLoops,
  filterRoomLoops,
  innerRoomPolygonFromLoop,
} from "../walls/wallOps.js";
import { isDoorKind } from "../../doorTypes.js";

export const MIN_ROOM_AREA_MM2 = 500000;

function bbox(poly) {
  return polygonBounds(poly || []);
}

function pointInBox(p, b) {
  if (!b) return false;
  return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
}

function roomIdFromDetected(det, index) {
  const c = det.centroid || { x: 0, y: 0 };
  return `rm-${Math.round(c.x / 10)}-${Math.round(c.y / 10)}-${Math.round(det.areaMm2 / 1000)}-${index + 1}`;
}

function normalizeLegacyRoom(room = {}, index = 0) {
  const poly = room.polygon || [];
  const areaMm2 = room.areaMm2 || polygonArea(poly);
  const bounds = room.bounds || bbox(poly);
  const centroid = room.centroid || polygonCentroid(poly);
  return {
    ...room,
    id: room.id || roomIdFromDetected({ areaMm2, centroid }, index),
    polygon: poly,
    areaMm2,
    areaM2: room.areaM2 != null ? room.areaM2 : +(areaMm2 / 1_000_000).toFixed(2),
    bounds,
    centroid,
  };
}

function pointNearWalls(p, walls, minDist = 130) {
  const segs = wallSegments(walls || []);
  for (const seg of segs) {
    const proj = projectOnSegment(p, seg.a, seg.b);
    if (dist(p, proj) < minDist) return true;
  }
  return false;
}

function isRackLikeItem(it) {
  return it?.category === "rack" || it?.layer === "racks" || it?.kind === "rack" || it?.kind === "seed_rack";
}

function pointInObstacle(p, items = [], pad = 80) {
  for (const it of items) {
    if (!isDoorKind(it.kind) && !isRackLikeItem(it)) continue;
    const x0 = it.x - pad;
    const y0 = it.y - pad;
    const x1 = it.x + it.w + pad;
    const y1 = it.y + it.h + pad;
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) return true;
  }
  return false;
}

function labelPointCandidates(center) {
  const out = [{ ...center, external: false }];
  const radii = [140, 240, 360, 500, 650];
  const angles = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
  radii.forEach((r) => {
    angles.forEach((deg) => {
      const rad = (deg * Math.PI) / 180;
      out.push({
        x: center.x + Math.cos(rad) * r,
        y: center.y + Math.sin(rad) * r,
        external: r >= 360,
      });
    });
  });
  return out;
}

export function resolveRoomLabelPosition(poly, walls, items = [], prev = null) {
  const center = polygonCentroid(poly);
  const keepPrev = prev
    && pointInPolygon(prev, poly)
    && !pointNearWalls(prev, walls)
    && !pointInObstacle(prev, items);
  if (keepPrev) return { x: prev.x, y: prev.y, external: !!prev.external };

  const candidates = labelPointCandidates(center);
  for (const c of candidates) {
    if (!pointInPolygon(c, poly)) continue;
    if (pointNearWalls(c, walls)) continue;
    if (pointInObstacle(c, items)) continue;
    return c;
  }
  return { ...center, external: true };
}

export function detectRooms(plan) {
  const walls = weldWallNodes(resolveWallPtsList(plan?.walls, plan?.nodes));
  if (!planHasDrawnWalls(walls)) return [];
  const loops = filterRoomLoops(findClosedLoops(walls), walls);
  return loops
    .map((poly, i) => {
      const innerPoly = innerRoomPolygonFromLoop(poly, walls, plan?.room, (plan?.room?.wallThk || 100) * 0.5);
      const roomPoly = innerPoly?.length >= 3 ? innerPoly : poly;
      const areaMm2 = polygonArea(roomPoly);
      const bounds = bbox(roomPoly);
      const centroid = polygonCentroid(roomPoly);
      return {
        contourId: `contour-${i + 1}`,
        polygon: roomPoly,
        centerlinePolygon: poly,
        areaMm2,
        areaM2: +(areaMm2 / 1_000_000).toFixed(2),
        bounds,
        centroid,
      };
    })
    .filter((r) => r.areaMm2 >= MIN_ROOM_AREA_MM2);
}

function polygonOverlapRatioApprox(polyA, polyB, samples = 16) {
  const bA = bbox(polyA);
  const bB = bbox(polyB);
  if (!bA || !bB) return 0;
  const ix0 = Math.max(bA.x, bB.x);
  const iy0 = Math.max(bA.y, bB.y);
  const ix1 = Math.min(bA.x + bA.w, bB.x + bB.w);
  const iy1 = Math.min(bA.y + bA.h, bB.y + bB.h);
  if (ix1 <= ix0 || iy1 <= iy0) return 0;
  let insideA = 0;
  let insideB = 0;
  let overlap = 0;
  let total = 0;
  for (let yi = 0; yi < samples; yi++) {
    for (let xi = 0; xi < samples; xi++) {
      const x = ix0 + ((xi + 0.5) / samples) * (ix1 - ix0);
      const y = iy0 + ((yi + 0.5) / samples) * (iy1 - iy0);
      const p = { x, y };
      const inA = pointInPolygon(p, polyA);
      const inB = pointInPolygon(p, polyB);
      if (inA) insideA++;
      if (inB) insideB++;
      if (inA && inB) overlap++;
      total++;
    }
  }
  if (!total) return 0;
  const union = insideA + insideB - overlap;
  return union > 0 ? overlap / union : 0;
}

function roomMatchScore(oldRoom, detected) {
  const oldCentroid = oldRoom.centroid || polygonCentroid(oldRoom.polygon || []);
  const newCentroid = detected.centroid;
  const centerDistance = dist(oldCentroid, newCentroid);
  const centroidScore = Math.max(0, 1 - centerDistance / 1800);

  const areaA = oldRoom.areaMm2 || polygonArea(oldRoom.polygon || []);
  const areaB = detected.areaMm2;
  const areaDiff = Math.abs(areaA - areaB) / Math.max(areaA, areaB, 1);
  const areaScore = Math.max(0, 1 - areaDiff);

  const overlapScore = polygonOverlapRatioApprox(oldRoom.polygon || [], detected.polygon || []);
  return overlapScore * 0.55 + centroidScore * 0.25 + areaScore * 0.2;
}

export function matchRooms(oldRooms = [], detectedRooms = []) {
  const normalizedOld = (oldRooms || []).map((r, i) => normalizeLegacyRoom(r, i));
  const usedIds = new Set();
  return detectedRooms.map((det, idx) => {
    let best = null;
    let bestScore = 0;
    for (const oldRoom of normalizedOld) {
      if (usedIds.has(oldRoom.id)) continue;
      const score = roomMatchScore(oldRoom, det);
      if (score > bestScore) {
        bestScore = score;
        best = oldRoom;
      }
    }
    if (best && bestScore >= 0.7) usedIds.add(best.id);
    return {
      detected: det,
      previous: best && bestScore >= 0.7 ? best : null,
      score: bestScore,
      fallbackId: roomIdFromDetected(det, idx),
    };
  });
}

export function normalizeLegacyRoomsFromZones(zones = [], defaultHeightMm = 3000) {
  return (zones || [])
    .filter((z) => z?.polygon?.length >= 3 || (z?.w && z?.h))
    .map((z, i) => {
      const polygon = z.polygon?.length >= 3
        ? z.polygon
        : [
          { x: z.x, y: z.y },
          { x: z.x + z.w, y: z.y },
          { x: z.x + z.w, y: z.y + z.h },
          { x: z.x, y: z.y + z.h },
        ];
      const areaMm2 = polygonArea(polygon);
      const centroid = polygonCentroid(polygon);
      return {
        id: z.id || roomIdFromDetected({ areaMm2, centroid }, i),
        type: "room",
        name: z.name || `Помещение ${i + 1}`,
        category: z.category || "other",
        contourId: z.contourId || `legacy-${i + 1}`,
        polygon,
        areaMm2,
        areaM2: +(areaMm2 / 1_000_000).toFixed(2),
        heightMm: z.heightMm || z.height || defaultHeightMm,
        labelPosition: z.labelPosition || centroid,
        fillColor: z.fillColor || z.zoneColor || null,
        visible: z.visible !== false,
        locked: z.locked === true,
        climateZone: z.climateZone || null,
        sanitationZone: z.sanitationZone || null,
        productionZone: z.productionZone || null,
        targetTemperatureC: z.targetTemperatureC ?? null,
        targetRh: z.targetRh ?? null,
        targetCo2Ppm: z.targetCo2Ppm ?? null,
        targetAirChanges: z.targetAirChanges ?? null,
        targetAirVelocityMs: z.targetAirVelocityMs ?? null,
        notes: z.notes || "",
      };
    });
}

export function roomBounds(room) {
  return room?.polygon?.length ? bbox(room.polygon) : null;
}

export function roomContainsPoint(room, p) {
  if (!room?.polygon?.length) return false;
  if (!pointInBox(p, roomBounds(room))) return false;
  return pointInPolygon(p, room.polygon);
}
