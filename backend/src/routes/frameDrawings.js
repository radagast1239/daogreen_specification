import { Router } from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import { nanoid } from "nanoid";
import { db } from "../db.js";
import { multerFileFilter } from "../services/uploadFilter.js";
import {
  assertCanDeleteOrOverwriteAsset,
  isAssetPinnedByPublishedRelease,
} from "../services/publishedAssetRetention.js";
import { hideSupersededFrameDrawingVersions } from "../services/frameDrawingVisibility.js";
import { resolveUploadRoot } from "../services/uploadRoot.js";
import {
  assertValidPdfUpload,
  UploadValidationError,
  FRAME_DRAWING_PDF_REQUIRED,
} from "../services/uploadValidation.js";

/** Always resolve at call time so UPLOAD_ROOT matches saveFile/static. */
function uploadRoot() {
  return resolveUploadRoot();
}

function resolveUnderUploadRoot(relPath) {
  const root = path.resolve(uploadRoot());
  const rel = String(relPath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel || rel.includes("..") || path.isAbsolute(rel)) return null;
  const abs = path.resolve(root, rel);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(rootWithSep)) return null;
  return abs;
}

const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: multerFileFilter({ pdfOnly: true }),
});

const router = Router();

function rowToDrawing(row) {
  if (!row) return null;
  let frameConfig = {};
  try {
    frameConfig = JSON.parse(row.frame_config_json || "{}");
  } catch {
    frameConfig = {};
  }
  return {
    id: row.id,
    projectId: row.project_id || null,
    moduleId: row.module_id || null,
    stellageId: row.stellage_id || null,
    moduleRackKey: row.module_rack_key || null,
    presetId: row.preset_id || null,
    sourceType: row.source_type,
    title: row.title,
    rackType: row.rack_type,
    frameConfig,
    pdfUrl: row.pdf_url,
    pdfFilename: row.pdf_filename,
    downloadUrl: `/api/frame-drawings/${row.id}/download`,
    fileId: row.file_id || null,
    isClientVisible: !!row.is_client_visible,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function computeNextVersion({
  projectId,
  stellageId,
  moduleId,
  moduleRackKey,
  presetId,
  sourceType,
}) {
  let sql = "SELECT MAX(version) as v FROM frame_drawings WHERE ";
  const params = [];
  if (projectId && stellageId) {
    sql += "project_id = ? AND stellage_id = ?";
    params.push(projectId, stellageId);
  } else if (moduleId && moduleRackKey) {
    sql += "module_id = ? AND module_rack_key = ?";
    params.push(moduleId, moduleRackKey);
  } else if (presetId) {
    sql += "preset_id = ?";
    params.push(presetId);
  } else if (projectId) {
    sql += "project_id = ? AND COALESCE(stellage_id, '') = '' AND COALESCE(module_rack_key, '') = ''";
    params.push(projectId);
  } else {
    return 1;
  }
  const row = db.prepare(sql).get(...params);
  return (row?.v || 0) + 1;
}

function countExistingDrawings(filters) {
  const { projectId, stellageId, moduleId, moduleRackKey, presetId } = filters;
  if (projectId && stellageId) {
    return db.prepare(
      "SELECT COUNT(*) as c FROM frame_drawings WHERE project_id = ? AND stellage_id = ?",
    ).get(projectId, stellageId).c;
  }
  if (moduleId && moduleRackKey) {
    return db.prepare(
      "SELECT COUNT(*) as c FROM frame_drawings WHERE module_id = ? AND module_rack_key = ?",
    ).get(moduleId, moduleRackKey).c;
  }
  if (presetId) {
    return db.prepare(
      "SELECT COUNT(*) as c FROM frame_drawings WHERE preset_id = ?",
    ).get(presetId).c;
  }
  return 0;
}

function resolvePdfSubdir(body) {
  const projectId = body.project_id || body.projectId || null;
  const presetId = body.preset_id || body.presetId || null;
  if (projectId) return path.join("frame-drawings", String(projectId));
  if (presetId) return path.join("frame-drawings", "presets", String(presetId));
  return path.join("frame-drawings", "standalone");
}

function writePdfBuffer(buffer, body, drawingId) {
  const root = resolveUploadRoot();
  const subdir = resolvePdfSubdir(body);
  const absDir = path.join(root, subdir);
  fs.mkdirSync(absDir, { recursive: true });
  const filename = `${drawingId}.pdf`;
  const rel = path.join(subdir, filename).replace(/\\/g, "/");
  const absPath = resolveUnderUploadRoot(rel);
  if (!absPath) throw new Error("Invalid frame drawing upload path");
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  if (fs.existsSync(absPath)) {
    assertCanDeleteOrOverwriteAsset({ url: `/uploads/${rel}` });
  }
  fs.writeFileSync(absPath, buffer);
  const urlPath = `/uploads/${rel}`;
  return { urlPath, absPath, filename };
}

function parseBool(val, def = true) {
  if (val === undefined || val === null || val === "") return def;
  if (val === true || val === "true" || val === "1" || val === 1) return true;
  if (val === false || val === "false" || val === "0" || val === 0) return false;
  return def;
}

function parseFrameConfig(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function filesFilename(title, pdfFilename) {
  if (pdfFilename) return pdfFilename;
  return title.endsWith(".pdf") ? title : `${title}.pdf`;
}

function isFrameDrawingUploadPath(pdfUrl) {
  if (!pdfUrl) return false;
  const rel = pdfUrl.replace(/^\/uploads\/?/, "").replace(/\\/g, "/");
  return rel.startsWith("frame-drawings/");
}

function removeDrawingFilesRow(fileId) {
  if (!fileId) return;
  db.prepare("DELETE FROM files WHERE id = ?").run(fileId);
}

function ensureDrawingFilesRow({ projectId, fileId, pdfFilename, pdfUrl, title }) {
  if (!projectId) return null;
  const filename = filesFilename(title, pdfFilename);
  const id = fileId || nanoid(12);
  const existing = db.prepare("SELECT id FROM files WHERE id = ?").get(id);
  if (existing) {
    db.prepare(
      "UPDATE files SET project_id = ?, type = ?, filename = ?, url = ? WHERE id = ?",
    ).run(projectId, "frame_drawing", filename, pdfUrl, id);
  } else {
    db.prepare(
      "INSERT INTO files (id, project_id, type, filename, url) VALUES (?, ?, ?, ?, ?)",
    ).run(id, projectId, "frame_drawing", filename, pdfUrl);
  }
  return id;
}

/** Sync files row for a frame drawing based on visibility. Returns file_id or null. */
function syncDrawingFilesVisibility({
  projectId,
  isClientVisible,
  fileId = null,
  pdfFilename,
  pdfUrl,
  title,
}) {
  if (!projectId || !isClientVisible) {
    removeDrawingFilesRow(fileId);
    return null;
  }
  return ensureDrawingFilesRow({ projectId, fileId, pdfFilename, pdfUrl, title });
}

function safeDeleteFrameDrawingPdf(pdfUrl) {
  if (!isFrameDrawingUploadPath(pdfUrl)) return;
  if (isAssetPinnedByPublishedRelease({ url: pdfUrl })) {
    console.warn(`[frame-drawings] skip delete of pinned PDF: ${pdfUrl}`);
    return;
  }
  const rel = pdfUrl.replace(/^\/uploads\/?/, "");
  const abs = resolveUnderUploadRoot(rel);
  if (!abs || !fs.existsSync(abs)) return;
  try {
    fs.unlinkSync(abs);
  } catch (err) {
    console.warn(`[frame-drawings] failed to delete PDF: ${abs}`, err?.message || err);
  }
}

router.get("/", (req, res) => {
  const {
    project_id,
    module_id,
    stellage_id,
    module_rack_key,
    preset_id,
    source_type,
  } = req.query;
  let sql = "SELECT * FROM frame_drawings WHERE 1=1";
  const params = [];
  if (project_id) {
    sql += " AND project_id = ?";
    params.push(project_id);
  }
  if (module_id) {
    sql += " AND module_id = ?";
    params.push(module_id);
  }
  if (stellage_id) {
    sql += " AND stellage_id = ?";
    params.push(stellage_id);
  }
  if (module_rack_key) {
    sql += " AND module_rack_key = ?";
    params.push(module_rack_key);
  }
  if (preset_id) {
    sql += " AND preset_id = ?";
    params.push(preset_id);
  }
  if (source_type) {
    sql += " AND source_type = ?";
    params.push(source_type);
  }
  sql += " ORDER BY updated_at DESC, created_at DESC";
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(rowToDrawing));
});

router.get("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM frame_drawings WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(rowToDrawing(row));
});

router.get("/:id/download", (req, res) => {
  const row = db.prepare("SELECT * FROM frame_drawings WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  const rel = row.pdf_url.replace(/^\/uploads\/?/, "");
  const abs = resolveUnderUploadRoot(rel);
  if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: "File not found" });
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.download(abs, row.pdf_filename || `${row.id}.pdf`);
});

router.post("/", pdfUpload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "PDF file required", code: FRAME_DRAWING_PDF_REQUIRED });
  try {
    assertValidPdfUpload(req.file);
  } catch (e) {
    if (e instanceof UploadValidationError) {
      return res.status(e.status || 400).json({ error: e.code, code: e.code, message: e.message });
    }
    return res.status(400).json({ error: e.message });
  }
  return saveDrawing(req, res, req.body || {});
});

function saveDrawing(req, res, body) {
  const projectId = body.project_id || body.projectId || null;
  const moduleId = body.module_id || body.moduleId || null;
  const stellageId = body.stellage_id || body.stellageId || body.rack_id || body.rackId || null;
  const moduleRackKey = body.module_rack_key || body.moduleRackKey || null;
  const presetId = body.preset_id || body.presetId || null;
  const sourceType = body.source_type || body.sourceType || "standalone";
  const title = (body.title || req.file.originalname || "Чертёж каркаса").trim();
  const rackType = body.rack_type || body.rackType || "";
  const frameConfig = parseFrameConfig(body.frame_config_json || body.frameConfigJson);
  const isClientVisible = parseBool(body.is_client_visible ?? body.isClientVisible, true);
  const updateId = body.drawing_id || body.drawingId || null;
  const replace = parseBool(body.replace, false) && updateId;

  const existingCount = countExistingDrawings({
    projectId,
    stellageId,
    moduleId,
    moduleRackKey,
    presetId,
  });

  const pdfFilename = body.pdf_filename || body.pdfFilename || req.file.originalname || "frame-drawing.pdf";
  const frameConfigJson = JSON.stringify(frameConfig);
  const now = new Date().toISOString();

  if (replace) {
    const prevRow = db.prepare("SELECT * FROM frame_drawings WHERE id = ?").get(updateId);
    if (!prevRow) return res.status(404).json({ error: "Not found" });
    const prevUrl = prevRow.pdf_url || "";
    // Pinned published drawings must keep their PDF bytes. Create a new drawing id/path instead.
    if (isAssetPinnedByPublishedRelease({ url: prevUrl, drawingId: updateId })) {
      const id = nanoid(12);
      const { urlPath } = writePdfBuffer(req.file.buffer, { projectId, presetId }, id);
      const fileId = projectId
        ? syncDrawingFilesVisibility({
            projectId,
            isClientVisible,
            fileId: null,
            pdfFilename,
            pdfUrl: urlPath,
            title,
          })
        : null;
      const version = computeNextVersion({
        projectId,
        stellageId,
        moduleId,
        moduleRackKey,
        presetId,
        sourceType,
      });
      db.prepare(`
        INSERT INTO frame_drawings (
          id, project_id, module_id, stellage_id, module_rack_key, preset_id, source_type,
          title, rack_type, frame_config_json, pdf_url, pdf_filename, file_id,
          is_client_visible, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, projectId, moduleId, stellageId, moduleRackKey, presetId, sourceType,
        title, rackType, frameConfigJson, urlPath, pdfFilename, fileId,
        isClientVisible ? 1 : 0, version, now, now,
      );
      const drawing = rowToDrawing(db.prepare("SELECT * FROM frame_drawings WHERE id = ?").get(id));
      if (isClientVisible) {
        hideSupersededFrameDrawingVersions({
          keepId: id,
          projectId,
          stellageId,
          moduleId,
          moduleRackKey,
          presetId,
        });
      }
      return res.json({
        ...drawing,
        existingVersions: existingCount,
        replaced: false,
        createdNewDueToPin: true,
        preservedDrawingId: updateId,
      });
    }
    const { urlPath } = writePdfBuffer(req.file.buffer, { projectId, presetId }, updateId);
    const prev = { version: prevRow.version, file_id: prevRow.file_id };
    const fileId = projectId
      ? syncDrawingFilesVisibility({
          projectId,
          isClientVisible,
          fileId: prev?.file_id || null,
          pdfFilename,
          pdfUrl: urlPath,
          title,
        })
      : null;

    db.prepare(`
      UPDATE frame_drawings SET
        project_id = ?, module_id = ?, stellage_id = ?, module_rack_key = ?, preset_id = ?,
        source_type = ?, title = ?, rack_type = ?, frame_config_json = ?,
        pdf_url = ?, pdf_filename = ?, file_id = ?,
        is_client_visible = ?, version = ?, updated_at = ?
      WHERE id = ?
    `).run(
      projectId, moduleId, stellageId, moduleRackKey, presetId,
      sourceType, title, rackType, frameConfigJson,
      urlPath, pdfFilename, fileId,
      isClientVisible ? 1 : 0, (prev?.version || 1) + 1, now,
      updateId,
    );
    if (isClientVisible) {
      hideSupersededFrameDrawingVersions({
        keepId: updateId,
        projectId,
        stellageId,
        moduleId,
        moduleRackKey,
        presetId,
      });
    }
    const drawing = rowToDrawing(db.prepare("SELECT * FROM frame_drawings WHERE id = ?").get(updateId));
    return res.json({ ...drawing, existingVersions: existingCount, replaced: true });
  }

  const id = nanoid(12);
  const { urlPath } = writePdfBuffer(req.file.buffer, { projectId, presetId }, id);
  const fileId = projectId
    ? syncDrawingFilesVisibility({
        projectId,
        isClientVisible,
        fileId: null,
        pdfFilename,
        pdfUrl: urlPath,
        title,
      })
    : null;

  const version = computeNextVersion({
    projectId,
    stellageId,
    moduleId,
    moduleRackKey,
    presetId,
    sourceType,
  });

  db.prepare(`
    INSERT INTO frame_drawings (
      id, project_id, module_id, stellage_id, module_rack_key, preset_id, source_type,
      title, rack_type, frame_config_json, pdf_url, pdf_filename, file_id,
      is_client_visible, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, projectId, moduleId, stellageId, moduleRackKey, presetId, sourceType,
    title, rackType, frameConfigJson, urlPath, pdfFilename, fileId,
    isClientVisible ? 1 : 0, version, now, now,
  );

  if (isClientVisible) {
    hideSupersededFrameDrawingVersions({
      keepId: id,
      projectId,
      stellageId,
      moduleId,
      moduleRackKey,
      presetId,
    });
  }

  const drawing = rowToDrawing(db.prepare("SELECT * FROM frame_drawings WHERE id = ?").get(id));
  return res.json({
    ...drawing,
    existingVersions: existingCount,
    isNewVersion: existingCount > 0,
  });
}

router.patch("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM frame_drawings WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });

  const title = req.body.title ?? row.title;
  const pdfFilename = req.body.pdf_filename ?? req.body.pdfFilename ?? row.pdf_filename;
  const pdfUrl = req.body.pdf_url ?? req.body.pdfUrl ?? row.pdf_url;
  const isClientVisibleRaw = req.body.is_client_visible ?? req.body.isClientVisible;
  const visible = isClientVisibleRaw === undefined
    ? !!row.is_client_visible
    : parseBool(isClientVisibleRaw, true);

  const fileId = row.project_id
    ? syncDrawingFilesVisibility({
        projectId: row.project_id,
        isClientVisible: visible,
        fileId: row.file_id || null,
        pdfFilename,
        pdfUrl,
        title,
      })
    : null;

  db.prepare(`
    UPDATE frame_drawings SET
      title = ?, pdf_filename = ?, pdf_url = ?, file_id = ?,
      is_client_visible = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(title, pdfFilename, pdfUrl, fileId, visible ? 1 : 0, req.params.id);

  res.json(rowToDrawing(db.prepare("SELECT * FROM frame_drawings WHERE id = ?").get(req.params.id)));
});

router.delete("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM frame_drawings WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });

  try {
    assertCanDeleteOrOverwriteAsset({ url: row.pdf_url, drawingId: row.id });
  } catch (e) {
    if (e.code === "ASSET_PINNED_BY_RELEASE") {
      return res.status(409).json({ error: e.message, code: e.code, details: e.details });
    }
    throw e;
  }

  removeDrawingFilesRow(row.file_id);
  safeDeleteFrameDrawingPdf(row.pdf_url);

  db.prepare("DELETE FROM frame_drawings WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

export default router;
export {
  rowToDrawing,
  parseFrameConfig,
  parseBool,
  syncDrawingFilesVisibility,
  removeDrawingFilesRow,
  ensureDrawingFilesRow,
  isFrameDrawingUploadPath,
  safeDeleteFrameDrawingPdf,
};
