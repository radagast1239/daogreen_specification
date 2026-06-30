/** Стыки стен: T-перекрёстки, углы, вырезы под примыкающие сегменты. */
import { dist, near, projectOnSegment } from "./wallGeometry.js";

/** Сколько других стен сходится в точку (для L / T / торец). */
export function otherWallsAtPoint(walls, pt, excludeWallId, thr = 85) {
  if (!pt) return 0;
  const ids = new Set();
  for (const w of walls || []) {
    if (w.id === excludeWallId || !w?.pts?.length) continue;
    for (const p of w.pts) {
      if (near(p, pt, thr)) ids.add(w.id);
    }
  }
  return ids.size;
}

/** T-стык: точка на середине другой стены (не в её конце и не общий узел L). */
export function teeHostAtPoint(pt, walls, excludeWallId, thr = 55) {
  if (!pt) return null;
  if (otherWallsAtPoint(walls, pt, excludeWallId, Math.max(thr, 70)) >= 2) return null;
  for (const w of walls || []) {
    if (w.id === excludeWallId || !w?.pts?.length) continue;
    for (let i = 1; i < w.pts.length; i++) {
      const a = w.pts[i - 1];
      const b = w.pts[i];
      if (near(pt, a, thr) || near(pt, b, thr)) continue;
      const proj = projectOnSegment(pt, a, b);
      if (dist(pt, proj) <= thr && dist(a, b) > thr * 2) {
        return { wall: w, thk: w.thk || 100 };
      }
    }
  }
  return null;
}

export function wallAtPoint(walls, pt, thr = 85) {
  if (!pt) return null;
  for (const w of walls || []) {
    if (!w?.pts?.length) continue;
    for (const p of w.pts) {
      if (near(p, pt, thr)) return w;
    }
  }
  return null;
}

function mergeRanges(ranges) {
  if (!ranges.length) return [];
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = out[out.length - 1];
    const cur = sorted[i];
    if (cur[0] <= prev[1] + 0.002) {
      prev[1] = Math.max(prev[1], cur[1]);
    } else {
      out.push(cur);
    }
  }
  return out;
}

/** Вырезы на хост-стене, куда упирается торец другой стены (T-стык). */
export function stemTeeGapsOnSegment(a, b, wallId, walls, thr = 55) {
  const segLen = dist(a, b);
  if (segLen < 80) return [];
  const gaps = [];
  for (const w of walls || []) {
    if (w.id === wallId || !w?.pts || w.pts.length !== 2) continue;
    const [p0, p1] = w.pts;
    for (const ep of [p0, p1]) {
      if (near(ep, a, thr) || near(ep, b, thr)) continue;
      const proj = projectOnSegment(ep, a, b);
      if (dist(ep, proj) > thr) continue;
      const t = dist(a, proj) / segLen;
      if (t <= 0.03 || t >= 0.97) continue;
      const half = ((w.thk || 100) * 0.55) / segLen;
      gaps.push([Math.max(0, t - half), Math.min(1, t + half)]);
    }
  }
  return mergeRanges(gaps);
}

/** Обрезка контура торца стены у T-стыка (не рисовать «шапку» на хосте). */
export function teeOutlineTrimAtPoint(a, b, pt, walls, wallId) {
  const tee = teeHostAtPoint(pt, walls, wallId);
  if (!tee) return null;
  const segLen = dist(a, b) || 1;
  const trim = Math.min(0.22, ((tee.thk || 100) * 0.5) / segLen);
  if (near(pt, a, 2)) return { t0: trim, t1: 1 };
  if (near(pt, b, 2)) return { t0: 0, t1: 1 - trim };
  return null;
}

export function combineOpeningAndTeeGaps(openingRanges, teeGaps) {
  if (!teeGaps.length) return openingRanges;
  return mergeRanges([...(openingRanges || []), ...teeGaps]);
}
