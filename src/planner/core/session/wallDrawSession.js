/**
 * Single-wall drag-release drawing session (PHASE 2A, B+ path).
 *
 * One pointerdown → one pointermove preview → one pointerup → one wall.
 * There is no chain, no pending draft and no carry-over between gestures:
 * every begin starts from its own start point, so two consecutive walls can
 * never be linked by an implicit diagonal.
 *
 * Pure state machine — no React, no DOM, and deliberately no plan reference at
 * all: this session cannot touch the committed plan, history or autosave even
 * by accident. The caller turns a committed segment into geometry.
 *
 * States: "idle" | "drawing".
 */

export const WALL_DRAW_IDLE = "idle";
export const WALL_DRAW_DRAWING = "drawing";

/** Matches the legacy click threshold so a plain click still draws nothing. */
export const WALL_DRAW_V2_MIN_LEN_MM = 50;

export function createWallDrawSession() {
  return {
    status: WALL_DRAW_IDLE,
    txId: 0,
    startPoint: null,
    currentPoint: null,
    startSnap: null,
    endSnap: null,
    pointerId: null,
    moved: false,
    startedAt: null,
  };
}

/** Idle state that keeps the counter, so a retired txId is never reissued. */
function idleAfter(state) {
  return { ...createWallDrawSession(), txId: state.txId };
}

function isPoint(p) {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function segmentLength(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Start a new wall. A begin while another gesture is open ALWAYS wins and
 * cancels the old one — a stranded gesture (lost capture, missed pointerup)
 * must never contribute its start point to the next wall.
 *
 * @returns {{state: object, ok: boolean, reason: string|null, txId: number|null, superseded: number|null}}
 */
export function beginWallDraw(state, { point, snap = null, pointerId = null, now = null } = {}) {
  const prev = state || createWallDrawSession();
  if (!isPoint(point)) {
    return { state: prev, ok: false, reason: "INVALID_POINT", txId: null, superseded: null };
  }
  const superseded = prev.status === WALL_DRAW_DRAWING ? prev.txId : null;
  const txId = prev.txId + 1;
  const start = { x: point.x, y: point.y };
  return {
    state: {
      status: WALL_DRAW_DRAWING,
      txId,
      startPoint: start,
      currentPoint: start,
      startSnap: snap,
      endSnap: null,
      pointerId,
      moved: false,
      startedAt: now ?? Date.now(),
    },
    ok: true,
    reason: null,
    txId,
    superseded,
  };
}

/**
 * Update the rubber-band end. Rejects a foreign pointerId so a second finger
 * or a stale pointer stream cannot steer someone else's wall.
 */
export function previewWallDraw(state, txId, {
  point,
  snap = null,
  pointerId = null,
  minLenMm = WALL_DRAW_V2_MIN_LEN_MM,
} = {}) {
  const prev = state || createWallDrawSession();
  if (prev.status !== WALL_DRAW_DRAWING) return { state: prev, ok: false, reason: "NOT_ACTIVE" };
  if (txId !== prev.txId) return { state: prev, ok: false, reason: "STALE_TRANSACTION" };
  if (pointerId != null && prev.pointerId != null && pointerId !== prev.pointerId) {
    return { state: prev, ok: false, reason: "FOREIGN_POINTER" };
  }
  if (!isPoint(point)) return { state: prev, ok: false, reason: "INVALID_POINT" };

  const current = { x: point.x, y: point.y };
  return {
    state: {
      ...prev,
      currentPoint: current,
      endSnap: snap,
      moved: prev.moved || segmentLength(prev.startPoint, current) >= minLenMm,
    },
    ok: true,
    reason: null,
  };
}

/**
 * Close the gesture. `ok` means this txId validly closed the session; `segment`
 * is non-null only when a wall should actually be created, so a press without
 * a real drag closes cleanly and draws nothing.
 *
 * @returns {{state: object, ok: boolean, reason: string|null, segment: object|null}}
 */
export function commitWallDraw(state, txId, { minLenMm = WALL_DRAW_V2_MIN_LEN_MM } = {}) {
  const prev = state || createWallDrawSession();
  if (prev.status !== WALL_DRAW_DRAWING) {
    return { state: prev, ok: false, reason: "NOT_ACTIVE", segment: null };
  }
  if (txId !== prev.txId) {
    return { state: prev, ok: false, reason: "STALE_TRANSACTION", segment: null };
  }
  const start = prev.startPoint;
  const end = prev.currentPoint;
  if (!isPoint(start) || !isPoint(end) || segmentLength(start, end) < minLenMm) {
    return { state: idleAfter(prev), ok: true, reason: "BELOW_MIN_LENGTH", segment: null };
  }
  return {
    state: idleAfter(prev),
    ok: true,
    reason: null,
    segment: {
      start: { x: start.x, y: start.y },
      end: { x: end.x, y: end.y },
      startSnap: prev.startSnap,
      endSnap: prev.endSnap,
      txId: prev.txId,
    },
  };
}

/**
 * Drop the gesture. `txId` is optional: an unscoped cancel (Escape, pointer
 * abort) targets whatever is open, a scoped cancel refuses stale ids. Calling
 * cancel after a commit is a no-op — a trailing lostpointercapture can never
 * undo a wall that was already committed.
 */
export function cancelWallDraw(state, txId = null) {
  const prev = state || createWallDrawSession();
  if (prev.status !== WALL_DRAW_DRAWING) {
    return { state: prev, ok: false, reason: "NOT_ACTIVE" };
  }
  if (txId != null && txId !== prev.txId) {
    return { state: prev, ok: false, reason: "STALE_TRANSACTION" };
  }
  return { state: idleAfter(prev), ok: true, reason: null };
}

export function isWallDrawActive(state) {
  return !!state && state.status === WALL_DRAW_DRAWING;
}

/** Renderer-facing rubber band, or null when idle. */
export function wallDrawPreview(state) {
  if (!isWallDrawActive(state) || !state.startPoint || !state.currentPoint) return null;
  return {
    start: { ...state.startPoint },
    end: { ...state.currentPoint },
    startSnap: state.startSnap,
    endSnap: state.endSnap,
    lengthMm: segmentLength(state.startPoint, state.currentPoint),
    moved: state.moved,
  };
}

export function wallDrawTxId(state) {
  return state ? state.txId : 0;
}

export function wallDrawPointerId(state) {
  return isWallDrawActive(state) ? state.pointerId : null;
}
