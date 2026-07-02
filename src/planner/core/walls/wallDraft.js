/**
 * Черновик цепочки стен (wall-chain).
 * React хранит state; логика — здесь.
 */
import { dist, clonePoint, near } from "../geometry/point.js";
import { simplifyPolyline, closePolylineIfNear } from "../geometry/polyline.js";
import { MIN_SEGMENT_MM } from "./wallModel.js";

export const WALL_DRAFT_MIN_SEG = MIN_SEGMENT_MM;

export function createWallDraftState() {
  return {
    pts: [],
    chainStart: null,
    prevAngleDeg: null,
    dragging: false,
    dragFrom: null,
    closedLoop: false,
  };
}

export function wallDraftStart(state, startPt) {
  const pt = clonePoint(startPt);
  return {
    ...state,
    pts: [pt],
    chainStart: pt,
    dragging: true,
    dragFrom: pt,
  };
}

export function wallDraftContinueFrom(state, fromPt) {
  const pt = clonePoint(fromPt);
  return {
    ...state,
    dragging: true,
    dragFrom: pt,
  };
}

export function wallDraftPreviewPoint(state, cursorPt) {
  if (!state.pts.length) return state.pts;
  const from = state.dragFrom || state.pts[state.pts.length - 1];
  return [...state.pts.slice(0, -1), from, clonePoint(cursorPt)];
}

export function wallDraftAddSegment(state, endPt, minLen = WALL_DRAFT_MIN_SEG) {
  const from = state.dragFrom || state.pts[state.pts.length - 1];
  if (!from || dist(from, endPt) < minLen) {
    return { state, added: false };
  }
  const end = clonePoint(endPt);
  let pts;
  if (state.pts.length === 1 && state.pts[0] === from) {
    pts = [clonePoint(from), end];
  } else if (state.pts.length >= 2 && state.pts[state.pts.length - 1] === from) {
    pts = [...state.pts, end];
  } else {
    pts = [...state.pts, end];
  }
  pts = simplifyPolyline(pts, 5);
  return {
    state: {
      ...state,
      pts,
      dragging: false,
      dragFrom: end,
    },
    added: true,
    segment: { from: clonePoint(from), to: end },
  };
}

export function wallDraftCloseLoop(state, closePt) {
  if (!state.chainStart || state.pts.length < 2) return { state, closed: false };
  const { state: next, added } = wallDraftAddSegment(state, closePt, WALL_DRAFT_MIN_SEG);
  if (!added) return { state, closed: false };
  return { state: { ...next, closedLoop: true }, closed: true };
}

export function wallDraftBackspace(state) {
  if (state.pts.length <= 1) {
    return { state: createWallDraftState(), removed: "all" };
  }
  const pts = state.pts.slice(0, -1);
  return {
    state: {
      ...state,
      pts,
      dragFrom: pts[pts.length - 1],
      dragging: false,
    },
    removed: "point",
  };
}

export function wallDraftCancel() {
  return createWallDraftState();
}

export function wallDraftCanFinish(state) {
  return state.pts.length >= 2;
}

export function wallDraftFinishPts(state, closeThr = 200) {
  const meta = wallDraftFinishMeta(state, closeThr);
  return meta?.pts ?? null;
}

/** Точки и флаг замыкания для коммита цепочки. */
export function wallDraftFinishMeta(state, closeThr = 200) {
  if (!wallDraftCanFinish(state)) return null;
  let pts = simplifyPolyline(state.pts, 5);
  const snapClosed = state.closedLoop === true;
  const endsNear = pts.length >= 3 && near(pts[0], pts[pts.length - 1], closeThr);
  const closed = snapClosed || endsNear;
  if (closed && endsNear) {
    pts = pts.slice(0, -1);
  } else if (!snapClosed) {
    pts = closePolylineIfNear(pts, closeThr);
  }
  if (pts.length < 2) return null;
  return { pts, closed: closed && pts.length >= 3 };
}

export function wallDraftPtsForRender(state, cursor = null) {
  if (!state.pts.length) return [];
  if (state.dragging && cursor) {
    const from = state.dragFrom || state.pts[state.pts.length - 1];
    return [...state.pts, cursor];
  }
  return state.pts;
}
