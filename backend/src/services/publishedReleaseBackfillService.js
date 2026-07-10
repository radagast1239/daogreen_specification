import { db, loadProject, loadProjectItems } from "../db.js";
import {
  BACKFILL_ACTION,
  planPublishedReleaseBackfill,
  snapshotSha256,
  validateVersionSnapshot,
  verifyBackfillResults,
  isPublishedReleaseValid,
} from "../../../shared/publishedReleaseBackfill.js";
import {
  buildPublishedReleaseMeta,
  parsePublishedRelease,
} from "../../../shared/projectPublishedRelease.js";
import { createVersion } from "../routes/projects.js";

function loadVersionRows(projectId) {
  return db
    .prepare("SELECT * FROM spec_versions WHERE project_id = ? ORDER BY version_number DESC")
    .all(projectId)
    .map((r) => ({
      id: r.id,
      project_id: r.project_id,
      version_number: r.version_number,
      created_at: r.created_at,
      created_by: r.created_by,
      snapshot: r.snapshot,
    }));
}

function loadProjectRowMeta(projectId) {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  if (!row) return null;
  let manualParams = {};
  try {
    manualParams = JSON.parse(row.manual_params || "{}");
  } catch {
    manualParams = {};
  }
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    clientToken: row.client_token,
    manualParams,
    itemCount: db.prepare("SELECT COUNT(*) c FROM project_items WHERE project_id = ?").get(projectId).c,
    versionCount: db.prepare("SELECT COUNT(*) c FROM spec_versions WHERE project_id = ?").get(projectId).c,
  };
}

function persistPublishedReleaseOnly(projectId, publishedRelease) {
  const row = db.prepare("SELECT manual_params, status, client_token FROM projects WHERE id = ?").get(projectId);
  if (!row) throw new Error("project_not_found");
  let mp = {};
  try {
    mp = JSON.parse(row.manual_params || "{}");
  } catch {
    mp = {};
  }
  mp.publishedRelease = publishedRelease;
  db.prepare("UPDATE projects SET manual_params = ?, updated_at = datetime('now') WHERE id = ?").run(
    JSON.stringify(mp),
    projectId,
  );
}

function fingerprintProject(projectId) {
  const items = loadProjectItems(projectId);
  const row = db.prepare("SELECT status, client_token, manual_params FROM projects WHERE id = ?").get(projectId);
  const token = row?.client_token || "";
  const status = row?.status || "";
  const itemFp = items
    .map((it) => `${it.id}|${it.qty}|${it.status}|${it.actualPrice}|${it.clientComment}`)
    .sort()
    .join("\n");
  return { token, status, itemFp, itemCount: items.length };
}

function assessAfter(projectId) {
  const p = loadProject(projectId);
  const versions = loadVersionRows(projectId);
  const release = parsePublishedRelease(p?.manualParams);
  const row = release ? versions.find((v) => v.id === release.versionId) : null;
  const check = isPublishedReleaseValid(release, row);
  return {
    publishedRelease: release,
    publishedReleaseValid: check.valid,
    invalidReason: check.valid ? null : check.reason,
    versionId: release?.versionId || null,
    snapshotHash: check.valid ? check.snapshot.hash : null,
  };
}

function buildBeforeReport(projectId) {
  const meta = loadProjectRowMeta(projectId);
  if (!meta) return null;
  const p = loadProject(projectId);
  const versions = loadVersionRows(projectId);
  const plan = planPublishedReleaseBackfill({ project: p, versionRows: versions });
  const fp = fingerprintProject(projectId);
  return {
    projectId,
    name: meta.name,
    status: meta.status,
    itemCount: meta.itemCount,
    versionCount: meta.versionCount,
    pointerBefore: parsePublishedRelease(meta.manualParams),
    plan,
    fingerprint: fp,
  };
}

export function listClientTokenProjectIds() {
  return db
    .prepare("SELECT id FROM projects WHERE client_token IS NOT NULL AND TRIM(client_token) != ''")
    .all()
    .map((r) => r.id);
}

export function runPublishedReleaseBackfill({
  projectIds = [],
  allClientProjects = false,
  dryRun = true,
  createdBy = "backfill",
} = {}) {
  const ids = allClientProjects
    ? listClientTokenProjectIds()
    : projectIds.filter(Boolean);

  const reports = [];
  let hadError = false;

  for (const projectId of ids) {
    const before = buildBeforeReport(projectId);
    if (!before) {
      hadError = true;
      reports.push({ projectId, error: "not_found", ok: false });
      continue;
    }

    const beforeFp = before.fingerprint;
    const plan = before.plan;

    if (dryRun) {
      reports.push({
        ...before,
        mode: "dry-run",
        ok: plan.action !== BACKFILL_ACTION.MANUAL_REVIEW,
      });
      if (plan.action === BACKFILL_ACTION.MANUAL_REVIEW) hadError = true;
      continue;
    }

    try {
      const tx = db.transaction((pid) => {
        const snapBefore = loadVersionRows(pid);
        const snapHashesBefore = new Map(
          snapBefore.map((v) => [v.id, snapshotSha256(v.snapshot)]),
        );

        let action = plan.action;
        let versionId = plan.versionId || null;

        if (action === BACKFILL_ACTION.NOOP) {
          /* no-op */
        } else if (action === BACKFILL_ACTION.POINTER_BACKFILL) {
          const ver = snapBefore.find((v) => v.id === plan.versionId);
          if (!ver) throw new Error("chosen_version_missing");
          const publishedRelease = {
            versionId: ver.id,
            versionNumber: ver.version_number,
            publishedAt: ver.created_at || new Date().toISOString(),
            workflowStatus: "",
          };
          persistPublishedReleaseOnly(pid, publishedRelease);
        } else if (action === BACKFILL_ACTION.CREATE_V1) {
          const version = createVersion(pid, createdBy, { force: true });
          if (!version?.id) throw new Error("create_version_failed");
          versionId = version.id;
        } else if (action === BACKFILL_ACTION.NO_CLIENT_TOKEN) {
          /* skip */
        } else {
          throw new Error(`manual_review:${plan.reason}`);
        }

        const afterFp = fingerprintProject(pid);
        if (afterFp.token !== beforeFp.token) throw new Error("token_changed");
        if (afterFp.status !== beforeFp.status) throw new Error("status_changed");
        if (afterFp.itemFp !== beforeFp.itemFp) throw new Error("project_items_changed");

        const snapAfter = loadVersionRows(pid);
        for (const v of snapAfter) {
          const prev = snapHashesBefore.get(v.id);
          if (prev && prev !== snapshotSha256(v.snapshot)) {
            throw new Error(`snapshot_mutated:${v.id}`);
          }
        }

        return { versionId, action };
      });

      const applied = tx(projectId);
      const after = assessAfter(projectId);
      reports.push({
        ...before,
        mode: "apply",
        applied,
        after,
        ok: after.publishedReleaseValid,
      });
      if (!after.publishedReleaseValid) hadError = true;
    } catch (e) {
      hadError = true;
      reports.push({
        ...before,
        mode: "apply",
        ok: false,
        error: e.message,
        after: assessAfter(projectId),
      });
    }
  }

  const verify = dryRun
    ? {
        ok: reports.every(
          (r) =>
            !r.error
            && r.plan?.action !== BACKFILL_ACTION.MANUAL_REVIEW
            && r.plan?.action !== BACKFILL_ACTION.NO_CLIENT_TOKEN,
        ),
        problems: reports
          .filter((r) => r.plan?.action === BACKFILL_ACTION.MANUAL_REVIEW)
          .map((r) => ({ projectId: r.projectId, code: "manual_review_planned" })),
      }
    : verifyBackfillResults(
        reports.map((r) => ({
          projectId: r.projectId,
          action: r.plan?.action,
          after: r.after,
        })),
      );

  const ok = dryRun
    ? verify.ok
    : !hadError && verify.ok;

  return {
    dryRun,
    reports,
    verify,
    ok,
  };
}

export function verifyAllClientProjects() {
  const ids = listClientTokenProjectIds();
  const results = ids.map((id) => ({
    projectId: id,
    ...assessAfter(id),
  }));
  const problems = results.filter((r) => !r.publishedReleaseValid);
  return { ok: problems.length === 0, results, problems };
}

export { buildBeforeReport, assessAfter, validateVersionSnapshot, planPublishedReleaseBackfill };
