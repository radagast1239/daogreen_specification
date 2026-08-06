/**
 * Thin React adapter over createWallEditController (PHASE 1A).
 *
 * The controller is held in a ref so pointer handlers read and advance the
 * transaction synchronously; a version counter re-renders the canvas when the
 * preview changes. No transaction logic lives here — see
 * core/session/interactionSession.js.
 */
import { useRef, useState } from "react";
import { createWallEditController } from "./core/session/index.js";

/**
 * @param {object} opts
 * @param {(previewPlan: object, ctx: object) => object} opts.finalize — commit-time
 *        pass over the last preview (the single room sync lives here).
 * @param {(basePlan: object, finalPlan: object) => void} opts.commitFrom — one history step.
 */
export function usePlanInteractionSession({ finalize, commitFrom }) {
  // Latest callbacks without rebuilding the controller (PlanPage recreates
  // these every render; the transaction must outlive them).
  const finalizeRef = useRef(finalize);
  finalizeRef.current = finalize;
  const commitFromRef = useRef(commitFrom);
  commitFromRef.current = commitFrom;

  const [, bump] = useState(0);
  const controllerRef = useRef(null);
  if (!controllerRef.current) {
    controllerRef.current = createWallEditController({
      finalize: (previewPlan, ctx) => (
        finalizeRef.current ? finalizeRef.current(previewPlan, ctx) : previewPlan
      ),
      commitFrom: (basePlan, finalPlan) => commitFromRef.current(basePlan, finalPlan),
      onChange: () => bump((n) => n + 1),
    });
  }

  return controllerRef.current;
}
