/**
 * Frame BOM per-rack ↔ project-total basis contract.
 *
 * A. calculator purchase draft            — quantity per one rack
 * B. stellageConfigs[].groups[].qty       — quantity per one rack
 * C. builder editor line qty              — quantity per one rack
 * D. canonical frame_bom project_item.qty — total for all racks (per-rack × count)
 * E. rack count is applied exactly once, on the write to D
 * F. the divisor is stellageConfigs[].count for the proven rack — never a
 *    transient item.stellageCount / item.rackCount, which are not stored in SQLite
 *    and are therefore absent after a reload.
 *
 * A Builder save that writes a canonical total into (B) or (C) makes the next
 * save multiply by the rack count a second time, so the write path blocks it.
 */
import { parseFrameBomDecimal, roundFrameBomQty } from "./frameBomUnits.js";
import {
  FRAME_BOM_SOURCE,
  isFrameBomLine,
  resolveFrameBomDedupeKey,
} from "./frameBomProjectItems.js";
import { buildModuleRackKey } from "./moduleRackIds.js";

export const FRAME_BOM_GROUP_QTY_BASIS_INVALID = "FRAME_BOM_GROUP_QTY_BASIS_INVALID";

export const FRAME_BOM_BASIS_REASON = {
  UNPROVEN: "BASIS_UNPROVEN",
  GROUP_QTY_IS_CANONICAL_TOTAL: "GROUP_QTY_IS_CANONICAL_TOTAL",
  GROUP_QTY_NOT_PER_RACK: "GROUP_QTY_NOT_PER_RACK",
  PROJECT_QTY_NOT_TOTAL: "PROJECT_QTY_NOT_TOTAL",
};

/**
 * Rack count from stellageConfigs[].count — the only proven divisor.
 * @param {unknown} rawCount
 * @returns {{ proven: boolean, count: number }}
 */
export function resolveProvenRackCount(rawCount) {
  const count = parseFrameBomDecimal(rawCount, NaN);
  if (!Number.isFinite(count) || count < 1) return { proven: false, count: 1 };
  return { proven: true, count };
}

/** total (all racks) → per rack, using a proven count only. */
export function frameBomTotalToPerRack(totalQty, rackCount) {
  const { proven, count } = resolveProvenRackCount(rackCount);
  const total = parseFrameBomDecimal(totalQty, 0);
  if (!proven || count === 1) return roundFrameBomQty(total);
  return roundFrameBomQty(total / count);
}

/** per rack → total (all racks), using a proven count only. */
export function frameBomPerRackToTotal(perRackQty, rackCount) {
  const { proven, count } = resolveProvenRackCount(rackCount);
  const perRack = parseFrameBomDecimal(perRackQty, 0);
  if (!proven || count === 1) return roundFrameBomQty(perRack);
  return roundFrameBomQty(perRack * count);
}

/**
 * Frame BOM lineage of a builder editor line — never materialId or name.
 * @param {object} line
 */
export function isFrameBomBuilderLine(line) {
  if (!line) return false;
  const source = String(line.source || line.sourceType || line.source_type || "").trim();
  if (source === FRAME_BOM_SOURCE) return true;
  if (source === "manual") return false;
  return isFrameBomLine(line);
}

/**
 * Composite rack+BOM identity for a builder line (never materialId-only).
 * @param {object} line
 * @param {object} [stellage]
 */
export function frameBomBuilderLineDedupeKey(line, stellage) {
  const moduleRackKey = String(
    line?.moduleRackKey
      || buildModuleRackKey({ moduleId: stellage?.moduleId, rackId: stellage?.id })
      || (stellage?.id ? `stellage:${stellage.id}` : ""),
  ).trim();
  if (!moduleRackKey) return "";
  return resolveFrameBomDedupeKey({
    ...line,
    moduleRackKey,
    source: FRAME_BOM_SOURCE,
    sourceType: FRAME_BOM_SOURCE,
  });
}

/**
 * Basis provenance stamped on an editor line by the hydrate step.
 * @param {object} line
 */
export function frameBomEditorLineBasis(line) {
  return {
    resolved: line?.frameBomBasisResolved === true,
    rackCount: parseFrameBomDecimal(line?.frameBomRackCount, NaN),
    perRackQty: parseFrameBomDecimal(line?.frameBomPerRackQty, NaN),
    sourceTotalQty: parseFrameBomDecimal(line?.frameBomSourceTotalQty, NaN),
  };
}

/** Same predicate (and therefore same order) as builder `activeLines`. */
function activeGroupLines(items = []) {
  return (items || []).filter((ln) => ln.included && ln.name?.trim());
}

function canonicalTotalsByKey(items = []) {
  const map = new Map();
  for (const it of items || []) {
    if ((it?.source || it?.sourceType) !== FRAME_BOM_SOURCE) continue;
    const key = resolveFrameBomDedupeKey(it);
    if (!key) continue;
    map.set(key, it);
  }
  return map;
}

/**
 * Pure write-path invariant for Frame BOM-backed rack lines.
 *
 * Detection is exact-equality only — no thresholds and no "number looks too
 * large" rule. Ordinary/manual rack lines and racks without Frame BOM lineage
 * are never inspected.
 *
 * @param {{
 *   projectId?: string,
 *   stellages?: object[],
 *   builtStellageConfigs?: object[],
 *   builtItems?: object[],
 *   loadedItems?: object[],
 * }} params
 * @returns {{ ok: boolean, code: string, violations: object[] }}
 */
export function checkFrameBomGroupQtyBasis({
  projectId = "",
  stellages = [],
  builtStellageConfigs = [],
  builtItems = [],
  loadedItems = [],
} = {}) {
  const violations = [];
  const builtByKey = canonicalTotalsByKey(builtItems);
  const loadedByKey = canonicalTotalsByKey(loadedItems);
  const configById = new Map(
    (builtStellageConfigs || []).map((cfg) => [String(cfg?.id || ""), cfg]),
  );

  for (const st of stellages || []) {
    const cfg = configById.get(String(st?.id || ""));
    if (!cfg) continue;
    const { proven, count } = resolveProvenRackCount(cfg.count);
    const groups = Array.isArray(cfg.groups) ? cfg.groups : [];
    const lines = activeGroupLines(st.items);

    for (let index = 0; index < lines.length; index += 1) {
      const ln = lines[index];
      if (!isFrameBomBuilderLine(ln)) continue;

      const key = frameBomBuilderLineDedupeKey(ln, st);
      const editorPerRackQty = parseFrameBomDecimal(ln.qty, NaN);
      const group = groups[index];
      const groupQty = parseFrameBomDecimal(group?.qty, NaN);
      const builtItem = key ? builtByKey.get(key) : null;
      const loadedItem = key ? loadedByKey.get(key) : null;
      const projectTotalQty = parseFrameBomDecimal(builtItem?.qty, NaN);
      const expectedTotal = frameBomPerRackToTotal(editorPerRackQty, count);
      const basis = frameBomEditorLineBasis(ln);

      const push = (reason) => {
        violations.push({
          code: FRAME_BOM_GROUP_QTY_BASIS_INVALID,
          reason,
          projectId: String(projectId || ""),
          rackId: String(st?.id || ""),
          itemId: String(builtItem?.id || loadedItem?.id || ln.id || ""),
          materialId: String(ln.materialId || ""),
          groupQty,
          editorPerRackQty,
          projectTotalQty,
          rackCount: count,
          expectedTotal,
        });
      };

      // Rack or count could not be proven — fail closed rather than rescale.
      if (!proven || (count > 1 && !basis.resolved)) {
        push(FRAME_BOM_BASIS_REASON.UNPROVEN);
        continue;
      }

      // groups[] must carry the editor per-rack quantity, never the total.
      if (!Number.isFinite(groupQty) || groupQty !== roundFrameBomQty(editorPerRackQty)) {
        push(FRAME_BOM_BASIS_REASON.GROUP_QTY_NOT_PER_RACK);
        continue;
      }

      // The canonical project row must be the total, scaled exactly once.
      if (builtItem && projectTotalQty !== expectedTotal) {
        push(FRAME_BOM_BASIS_REASON.PROJECT_QTY_NOT_TOTAL);
        continue;
      }

      if (count > 1) {
        // A per-rack quantity equal to the canonical total it was hydrated from
        // is the double-scaling signature: the next save would multiply again.
        const loadedTotal = parseFrameBomDecimal(loadedItem?.qty, NaN);
        const hydratedPerRack = Number.isFinite(basis.perRackQty)
          ? roundFrameBomQty(basis.perRackQty)
          : NaN;
        const looksLikeTotal =
          (Number.isFinite(loadedTotal)
            && roundFrameBomQty(editorPerRackQty) === roundFrameBomQty(loadedTotal)
            && Number.isFinite(hydratedPerRack)
            && hydratedPerRack !== roundFrameBomQty(loadedTotal))
          || (Number.isFinite(basis.sourceTotalQty)
            && roundFrameBomQty(editorPerRackQty) === roundFrameBomQty(basis.sourceTotalQty)
            && Number.isFinite(hydratedPerRack)
            && hydratedPerRack !== roundFrameBomQty(basis.sourceTotalQty));
        if (looksLikeTotal) {
          push(FRAME_BOM_BASIS_REASON.GROUP_QTY_IS_CANONICAL_TOTAL);
        }
      }
    }
  }

  return {
    ok: violations.length === 0,
    code: violations.length ? FRAME_BOM_GROUP_QTY_BASIS_INVALID : "",
    violations,
  };
}

/** Human-readable blocker text for the Builder save toast. */
export function formatFrameBomGroupQtyBasisError(violations = []) {
  const first = violations[0];
  if (!first) return "Сохранение заблокировано: нарушен контракт количеств Frame BOM.";
  return [
    "Сохранение заблокировано: количество Frame BOM записывается не на один стеллаж.",
    `Стеллаж: ${first.rackId}, материал: ${first.materialId || first.itemId}.`,
    `В группе: ${first.groupQty}, на стеллаж: ${first.editorPerRackQty}, в проекте: ${first.projectTotalQty}, стеллажей: ${first.rackCount}, ожидалось в проекте: ${first.expectedTotal}.`,
  ].join(" ");
}
