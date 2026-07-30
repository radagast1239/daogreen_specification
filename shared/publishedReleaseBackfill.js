/** Published release backfill — pure planning/validation (no DB writes). */

import { createHash } from "crypto";
import { lineVisibleToClient } from "./itemTypes.js";
import { parsePublishedRelease, parseReleaseSnapshot, releaseSnapshotItems } from "./projectPublishedRelease.js";
import { publishedPlannedTotal } from "./publishedPurchaseTotals.js";

export const BACKFILL_ACTION = {
  NOOP: "noop",
  POINTER_BACKFILL: "pointer_backfill",
  CREATE_V1: "create_v1",
  MANUAL_REVIEW: "manual_review",
  NO_CLIENT_TOKEN: "no_client_token",
};

export function snapshotSha256(rawSnapshot) {
  const text = typeof rawSnapshot === "string" ? rawSnapshot : JSON.stringify(rawSnapshot ?? "");
  return createHash("sha256").update(text).digest("hex");
}

/**
 * @param {object|null} versionRow — { id, version_number, snapshot, created_at }
 * @returns {{ valid: boolean, reason?: string, items?: object[], clientVisible?: number, plannedTotal?: number }}
 */
export function validateVersionSnapshot(versionRow) {
  if (!versionRow?.id) return { valid: false, reason: "missing_version_row" };
  const raw = versionRow.snapshot;
  if (raw == null || raw === "") return { valid: false, reason: "empty_snapshot" };
  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { valid: false, reason: "invalid_snapshot_json" };
  }
  const meta = parseReleaseSnapshot(parsed);
  const items = meta.items || [];
  if (!items.length) return { valid: false, reason: "snapshot_no_items" };
  const clientVisible = items.filter((it) => lineVisibleToClient(it)).length;
  if (!clientVisible) return { valid: false, reason: "snapshot_no_client_visible_items" };
  return {
    valid: true,
    items,
    clientVisible,
    plannedTotal: publishedPlannedTotal(items),
    schema: meta.schema,
    hash: snapshotSha256(raw),
  };
}

/**
 * @param {object|null} publishedRelease
 * @param {object|null} versionRow
 */
export function isPublishedReleaseValid(publishedRelease, versionRow) {
  if (!publishedRelease?.versionId) return { valid: false, reason: "no_pointer" };
  if (!versionRow || versionRow.id !== publishedRelease.versionId) {
    return { valid: false, reason: "pointer_version_missing" };
  }
  const snap = validateVersionSnapshot(versionRow);
  if (!snap.valid) return { valid: false, reason: snap.reason };
  if (Number(versionRow.version_number) !== Number(publishedRelease.versionNumber)) {
    return { valid: false, reason: "pointer_version_number_mismatch" };
  }
  return { valid: true, snapshot: snap };
}

/**
 * Pick latest valid version row for pointer backfill.
 * @param {object[]} versionRows newest-first or any order
 */
export function pickLatestValidSnapshotVersion(versionRows = []) {
  const sorted = [...versionRows].sort(
    (a, b) => (Number(b.version_number) || 0) - (Number(a.version_number) || 0),
  );
  for (const row of sorted) {
    const v = validateVersionSnapshot(row);
    if (v.valid) return { row, validation: v };
  }
  return null;
}

/**
 * @param {object} input
 * @param {object} input.project — { id, clientToken, manualParams, items }
 * @param {object[]} input.versionRows
 * @param {object|null} input.versionById — map id -> row for pointer validation
 */
export function planPublishedReleaseBackfill({ project, versionRows = [] }) {
  const hasToken = Boolean(String(project?.clientToken || "").trim());
  if (!hasToken) {
    return { action: BACKFILL_ACTION.NO_CLIENT_TOKEN, reason: "no_client_token" };
  }

  const release = parsePublishedRelease(project?.manualParams);
  const pointerRow = release
    ? versionRows.find((v) => v.id === release.versionId) || null
    : null;
  const pointerCheck = isPublishedReleaseValid(release, pointerRow);
  if (pointerCheck.valid) {
    return {
      action: BACKFILL_ACTION.NOOP,
      reason: "already_published",
      publishedRelease: release,
      versionId: release.versionId,
      snapshotHash: pointerCheck.snapshot.hash,
    };
  }

  const picked = pickLatestValidSnapshotVersion(versionRows);
  if (picked) {
    return {
      action: BACKFILL_ACTION.POINTER_BACKFILL,
      reason: release ? "repair_pointer" : "backfill_pointer",
      versionId: picked.row.id,
      versionNumber: picked.row.version_number,
      publishedAt: picked.row.created_at,
      snapshotItems: picked.validation.items.length,
      clientVisible: picked.validation.clientVisible,
      plannedTotal: picked.validation.plannedTotal,
      snapshotHash: picked.validation.hash,
    };
  }

  if (!versionRows.length) {
    return {
      action: BACKFILL_ACTION.CREATE_V1,
      reason: "no_versions",
      workingItems: (project?.items || []).length,
    };
  }

  return {
    action: BACKFILL_ACTION.MANUAL_REVIEW,
    reason: "no_valid_snapshot",
    versionCount: versionRows.length,
  };
}

/** Verify all client-token projects have valid publishedRelease after backfill. */
export function verifyBackfillResults(results = []) {
  const problems = [];
  for (const r of results) {
    if (r.action === BACKFILL_ACTION.NO_CLIENT_TOKEN) continue;
    if (r.action === BACKFILL_ACTION.MANUAL_REVIEW) {
      problems.push({ projectId: r.projectId, code: "manual_review" });
      continue;
    }
    if (!r.after?.publishedReleaseValid) {
      problems.push({ projectId: r.projectId, code: "invalid_after" });
    }
  }
  return { ok: problems.length === 0, problems };
}
