/**
 * Explicit named re-exports only.
 *
 * `export *` is avoided on purpose: the wall barrel already demonstrates that
 * chained star-exports can silently resolve to an empty namespace, and this
 * module sits on the commit path.
 */
export {
  INTERACTION_IDLE,
  INTERACTION_PREVIEWING,
  createInteractionSession,
  beginInteraction,
  previewInteraction,
  commitInteraction,
  cancelInteraction,
  isInteractionActive,
  interactionPreviewPlan,
  interactionBasePlan,
  interactionKind,
  interactionTxId,
} from "./interactionSession.js";

export { createWallEditController } from "./wallEditController.js";

export {
  WALL_DRAW_IDLE,
  WALL_DRAW_DRAWING,
  WALL_DRAW_V2_MIN_LEN_MM,
  createWallDrawSession,
  beginWallDraw,
  previewWallDraw,
  commitWallDraw,
  cancelWallDraw,
  isWallDrawActive,
  wallDrawPreview,
  wallDrawTxId,
  wallDrawPointerId,
} from "./wallDrawSession.js";

export { createWallDrawController } from "./wallDrawController.js";
