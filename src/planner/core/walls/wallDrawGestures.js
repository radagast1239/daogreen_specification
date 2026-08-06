/**
 * Pure wall-tool gesture contract.
 * PlanPage owns DOM events; this module decides intent without mutating plan.
 */

export const WALL_DRAW_MIN_LEN_MM = 50;
export const WALL_DBLCLICK_MAX_SCREEN_PX = 4;
export const WALL_DRAFT_EPS_MM = 8;

/** @typedef {'idle'|'pending'|'preview'} WallGesturePhase */

/**
 * @returns {{
 *   phase: WallGesturePhase,
 *   start: {x:number,y:number}|null,
 *   end: {x:number,y:number}|null,
 *   hostWallId: string|null,
 *   screenX: number|null,
 *   screenY: number|null,
 *   startedAt: number|null,
 *   buttonDown: boolean,
 *   suppressNextClick: boolean,
 * }}
 */
export function createWallGestureState() {
  return {
    phase: "idle",
    start: null,
    end: null,
    hostWallId: null,
    screenX: null,
    screenY: null,
    startedAt: null,
    buttonDown: false,
    suppressNextClick: false,
  };
}

export function wallGestureLen(state) {
  if (!state?.start || !state?.end) return 0;
  return Math.hypot(state.end.x - state.start.x, state.end.y - state.start.y);
}

/**
 * Should wall-mode wall/node hit paths start select/drag?
 * Always false — wall tool owns the pointer sequence.
 */
export function wallToolAllowsGeometryDrag() {
  return false;
}

/**
 * Select-tool may start wall/node drag under existing contract.
 */
export function selectToolAllowsGeometryDrag(tool) {
  return tool === "select";
}

/**
 * Consume a synthetic click after commit. Returns next state + whether event is eaten.
 *
 * Only click-family events (click / dblclick) may be suppressed this way. A
 * pointerdown is always a fresh physical press, so it must never be eaten here —
 * see wallGesturePointerDown.
 */
export function consumePostCommitClick(state) {
  if (!state?.suppressNextClick) {
    return { state, consumed: false };
  }
  return {
    state: { ...state, suppressNextClick: false },
    consumed: true,
  };
}

/**
 * First / continue pointerdown while tool === wall.
 *
 * @param {ReturnType<typeof createWallGestureState>} state
 * @param {{
 *   point: {x:number,y:number},
 *   screenX: number,
 *   screenY: number,
 *   now?: number,
 *   hostWallId?: string|null,
 *   dblClickIntervalMs?: number,
 * }} ev
 */
export function wallGesturePointerDown(state, ev) {
  const now = ev.now ?? Date.now();
  const dblMs = ev.dblClickIntervalMs ?? 500;
  // A pointerdown is always a fresh physical press, never the synthetic click
  // that trails a commit. Clear the post-commit flag but keep handling the
  // event: eating it here swallowed the first press of every wall drawn after
  // the previous commit, so consecutive partitions silently did nothing.
  let s = state || createWallGestureState();
  if (s.suppressNextClick) s = { ...s, suppressNextClick: false };

  if (s.phase === "pending" || s.phase === "preview") {
    const screenDx = Math.hypot(
      (ev.screenX ?? 0) - (s.screenX ?? ev.screenX ?? 0),
      (ev.screenY ?? 0) - (s.screenY ?? ev.screenY ?? 0),
    );
    const dt = now - (s.startedAt ?? now);
    const len = wallGestureLen({ ...s, end: ev.point });
    const sameHost = ev.hostWallId && s.hostWallId && ev.hostWallId === s.hostWallId;
    const stationary = screenDx <= WALL_DBLCLICK_MAX_SCREEN_PX && len < WALL_DRAFT_EPS_MM;

    if (sameHost && stationary && dt <= dblMs) {
      return {
        state: createWallGestureState(),
        action: "open-properties",
        wallId: s.hostWallId,
      };
    }

    if (len >= WALL_DRAW_MIN_LEN_MM) {
      return {
        state: {
          ...createWallGestureState(),
          suppressNextClick: true,
        },
        action: "commit",
        start: s.start,
        end: ev.point,
        hostWallId: ev.hostWallId || null,
      };
    }

    // Too short — keep / refresh pending start.
    return {
      state: {
        ...s,
        phase: "pending",
        start: ev.point,
        end: ev.point,
        hostWallId: ev.hostWallId ?? s.hostWallId,
        screenX: ev.screenX,
        screenY: ev.screenY,
        startedAt: now,
        buttonDown: true,
      },
      action: "restart-pending",
    };
  }

  return {
    state: {
      phase: "pending",
      start: ev.point,
      end: ev.point,
      hostWallId: ev.hostWallId || null,
      screenX: ev.screenX,
      screenY: ev.screenY,
      startedAt: now,
      buttonDown: true,
      suppressNextClick: false,
    },
    action: "start-pending",
  };
}

export function wallGesturePointerMove(state, point) {
  if (!state || state.phase === "idle" || !state.start) {
    return { state, action: "none" };
  }
  const next = {
    ...state,
    phase: "preview",
    end: point,
  };
  return { state: next, action: "preview" };
}

/**
 * Pointerup: keep pending for click-click; optionally commit drag-release when
 * button was held and length is enough (and caller says endsOnWall / always).
 */
export function wallGesturePointerUp(state, {
  point,
  commitOnRelease = false,
} = {}) {
  if (!state || state.phase === "idle") {
    return { state: state || createWallGestureState(), action: "none" };
  }
  const end = point || state.end || state.start;
  const len = wallGestureLen({ ...state, end });
  const nextBase = {
    ...state,
    end,
    buttonDown: false,
  };

  if (commitOnRelease && len >= WALL_DRAW_MIN_LEN_MM) {
    return {
      state: {
        ...createWallGestureState(),
        suppressNextClick: true,
      },
      action: "commit",
      start: state.start,
      end,
    };
  }

  // Keep pending draft — do not clear short first click.
  return {
    state: {
      ...nextBase,
      phase: len > WALL_DRAFT_EPS_MM ? "preview" : "pending",
    },
    action: "keep-pending",
  };
}

export function wallGestureCancel() {
  return createWallGestureState();
}

export function wallGestureMarkCommitted(state) {
  return {
    ...(state || createWallGestureState()),
    phase: "idle",
    start: null,
    end: null,
    hostWallId: null,
    buttonDown: false,
    suppressNextClick: true,
  };
}

/** Drag handlers must no-op when tool is wall. */
export function shouldBlockWallGeometryDrag(tool) {
  return tool === "wall";
}
