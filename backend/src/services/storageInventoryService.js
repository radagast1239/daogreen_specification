/**
 * Read-only uploads inventory: physical scan + reference join.
 * Never deletes, moves, or renames files. Never writes project data.
 */
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { db } from "../db.js";
import { getUploadRoot, resolveLocalUploadAbsPath } from "./publishedAssetRetention.js";
import {
  normalizeUploadUrl,
  isLocalUploadUrl,
  collectPinnedAssetUrlsFromSnapshot,
} from "../../../shared/publishedAssetPin.js";
import { parseReleaseSnapshot } from "../../../shared/projectPublishedRelease.js";
import {
  classifyInventoryStatus,
  missingSeverity,
  dedupeReferences,
  buildInventorySummary,
  filterInventoryFiles,
  paginateList,
  sanitizeInventoryFile,
  statusExplanation,
  STORAGE_STATUSES,
} from "../../../shared/storageInventory.js";

const DEFAULT_MAX_FILES = Number(process.env.STORAGE_INVENTORY_MAX_FILES) || 5000;
const DEFAULT_TIMEOUT_MS = Number(process.env.STORAGE_INVENTORY_TIMEOUT_MS) || 120000;

let scanInFlight = null;
let lastScanResult = null;

export function getLastStorageInventory() {
  return lastScanResult;
}

export function isStorageInventoryScanning() {
  return !!scanInFlight;
}

function mimeFromExt(ext) {
  const e = String(ext || "").toLowerCase();
  if (e === ".png") return "image/png";
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".webp") return "image/webp";
  if (e === ".gif") return "image/gif";
  if (e === ".pdf") return "application/pdf";
  if (e === ".svg") return "image/svg+xml";
  if (e === ".json") return "application/json";
  return "application/octet-stream";
}

function categoryFromPath(assetPath, refs = []) {
  const cats = new Set();
  const lower = String(assetPath || "").toLowerCase();
  if (lower.endsWith(".pdf")) cats.add("document");
  if (/\.(png|jpe?g|webp|gif|svg)$/i.test(lower)) cats.add("image");
  for (const r of refs) {
    if (r.referenceType) cats.add(String(r.referenceType).split(":")[0] || r.referenceType);
    if (r.pinned) cats.add("published");
    if (r.referenceType?.includes("scheme")) cats.add("scheme");
    if (r.referenceType?.includes("rack")) cats.add("rack");
    if (r.referenceType?.includes("drawing")) cats.add("frame_drawing");
    if (r.referenceType?.includes("material")) cats.add("material");
    if (r.referenceType?.includes("branding") || r.referenceType?.includes("logo")) cats.add("branding");
  }
  if (!cats.size) cats.add("upload");
  return [...cats];
}

function streamSha256(absPath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(absPath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Walk UPLOAD_ROOT. Do not follow symlinks that escape the root (realpath check).
 */
export function walkUploadRootFiles(rootDir, { maxFiles = DEFAULT_MAX_FILES, deadlineMs = 0 } = {}) {
  let root = path.resolve(rootDir);
  try {
    root = fs.realpathSync(root);
  } catch {
    /* keep resolved path if realpath fails */
  }
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  const out = [];

  function timedOut() {
    return deadlineMs > 0 && Date.now() > deadlineMs;
  }

  function isInsideRoot(abs) {
    const resolved = path.resolve(abs);
    return resolved === root || resolved.startsWith(rootWithSep);
  }

  function walk(dir) {
    if (out.length >= maxFiles || timedOut()) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= maxFiles || timedOut()) return;
      const abs = path.join(dir, ent.name);
      let real;
      try {
        real = fs.realpathSync(abs);
      } catch {
        continue;
      }
      if (!isInsideRoot(real)) continue;

      let st;
      try {
        st = fs.lstatSync(abs);
      } catch {
        continue;
      }

      if (st.isSymbolicLink()) {
        let targetStat;
        try {
          targetStat = fs.statSync(abs);
        } catch {
          continue;
        }
        if (targetStat.isDirectory()) walk(abs);
        else if (targetStat.isFile()) {
          const rel = path.relative(root, real).split(path.sep).join("/");
          if (!rel || rel.startsWith("..")) continue;
          out.push({
            abs: real,
            rel,
            assetPath: `/uploads/${rel}`,
            sizeBytes: targetStat.size,
            modifiedAt: targetStat.mtime.toISOString(),
            extension: path.extname(real),
          });
        }
        continue;
      }

      if (st.isDirectory()) {
        walk(abs);
        continue;
      }
      if (st.isFile()) {
        const rel = path.relative(root, abs).split(path.sep).join("/");
        if (!rel || rel.startsWith("..")) continue;
        out.push({
          abs,
          rel,
          assetPath: `/uploads/${rel}`,
          sizeBytes: st.size,
          modifiedAt: st.mtime.toISOString(),
          extension: path.extname(abs),
        });
      }
    }
  }

  if (fs.existsSync(root)) walk(root);
  return out;
}

function pushRef(map, url, ref) {
  const normalized = normalizeUploadUrl(url);
  if (!normalized || !isLocalUploadUrl(normalized)) return;
  if (!map.has(normalized)) map.set(normalized, []);
  map.get(normalized).push(ref);
}

function collectPublishedReferences() {
  const map = new Map();
  const rows = db
    .prepare(
      `SELECT id, project_id, version_number, snapshot FROM spec_versions ORDER BY project_id, version_number`
    )
    .all();
  const projectNames = new Map(
    db.prepare("SELECT id, name FROM projects").all().map((r) => [r.id, r.name || ""])
  );

  for (const row of rows) {
    let raw;
    try {
      raw = JSON.parse(row.snapshot || "[]");
    } catch {
      continue;
    }
    const parsed = parseReleaseSnapshot(raw);
    const urls = collectPinnedAssetUrlsFromSnapshot(parsed);
    const projectId = row.project_id;
    const base = {
      projectId,
      projectName: projectNames.get(projectId) || "",
      versionId: row.id,
      versionNumber: row.version_number,
      pinned: true,
    };

    for (const img of parsed.imageManifest?.projectSchemes || []) {
      if (!img?.url) continue;
      pushRef(map, img.url, {
        ...base,
        referenceType: "published:scheme",
        field: "imageManifest.projectSchemes",
        url: normalizeUploadUrl(img.url),
      });
    }
    for (const img of parsed.imageManifest?.rackImages || []) {
      if (!img?.url) continue;
      pushRef(map, img.url, {
        ...base,
        referenceType: "published:rack",
        field: "imageManifest.rackImages",
        rackId: img.rackId || "",
        url: normalizeUploadUrl(img.url),
      });
    }
    for (const pin of parsed.pinnedFrameDrawings || []) {
      const u = pin.url || pin.pdfUrl;
      if (!u) continue;
      pushRef(map, u, {
        ...base,
        referenceType: "published:frame_drawing",
        field: "pinnedFrameDrawings",
        drawingId: pin.drawingId || pin.id || "",
        url: normalizeUploadUrl(u),
      });
    }
    // Frozen client documents: the only files a published link serves.
    for (const doc of parsed.documentManifest || []) {
      if (!doc?.url) continue;
      pushRef(map, doc.url, {
        ...base,
        referenceType: doc.type === "frame_drawing"
          ? "published:document_frame_drawing"
          : "published:document",
        field: "documentManifest",
        drawingId: doc.drawingId || "",
        url: normalizeUploadUrl(doc.url),
      });
    }
    // Legacy array snapshots: only item photo urls if present
    if (Array.isArray(raw)) {
      for (const it of raw) {
        const u = it?.photoUrl || it?.photo_url || it?.imageUrl;
        if (u) {
          pushRef(map, u, {
            ...base,
            referenceType: "published:legacy_item_photo",
            field: "snapshot[].photoUrl",
            url: normalizeUploadUrl(u),
          });
        }
      }
    }
    // Fallback: any /uploads/ URL collected by helper not already pushed
    for (const u of urls) {
      const list = map.get(u) || [];
      if (!list.length) {
        pushRef(map, u, {
          ...base,
          referenceType: "published:snapshot",
          field: "snapshot",
          url: u,
        });
      }
    }
  }
  return map;
}

function collectLiveProjectReferences() {
  const map = new Map();
  const projects = db.prepare("SELECT id, name, manual_params, stellage_configs FROM projects").all();
  for (const p of projects) {
    let mp = {};
    let stellage = [];
    try {
      mp = JSON.parse(p.manual_params || "{}");
    } catch {
      mp = {};
    }
    try {
      stellage = JSON.parse(p.stellage_configs || "[]");
    } catch {
      stellage = [];
    }
    const base = { projectId: p.id, projectName: p.name || "", pinned: false };

    for (const s of mp.projectSchemes || []) {
      if (!s?.url) continue;
      pushRef(map, s.url, {
        ...base,
        referenceType: "live:scheme",
        field: "manualParams.projectSchemes",
        url: normalizeUploadUrl(s.url),
      });
    }
    for (const st of Array.isArray(stellage) ? stellage : []) {
      for (const img of st.extraImages || []) {
        if (!img?.url) continue;
        pushRef(map, img.url, {
          ...base,
          referenceType: "live:rack",
          field: "stellageConfigs.extraImages",
          rackId: st.id || "",
          url: normalizeUploadUrl(img.url),
        });
      }
    }
  }

  const items = db
    .prepare(
      `SELECT project_id, id, photo_url, replacement_photo_url FROM project_items
       WHERE (photo_url IS NOT NULL AND photo_url != '')
          OR (replacement_photo_url IS NOT NULL AND replacement_photo_url != '')`
    )
    .all();
  const names = new Map(db.prepare("SELECT id, name FROM projects").all().map((r) => [r.id, r.name || ""]));
  for (const it of items) {
    const base = {
      projectId: it.project_id,
      projectName: names.get(it.project_id) || "",
      pinned: false,
      itemId: it.id,
    };
    if (it.photo_url) {
      pushRef(map, it.photo_url, {
        ...base,
        referenceType: "live:item_photo",
        field: "project_items.photo_url",
        url: normalizeUploadUrl(it.photo_url),
      });
    }
    if (it.replacement_photo_url) {
      pushRef(map, it.replacement_photo_url, {
        ...base,
        referenceType: "live:replacement_photo",
        field: "project_items.replacement_photo_url",
        url: normalizeUploadUrl(it.replacement_photo_url),
      });
    }
  }
  return map;
}

function collectFilesTableReferences() {
  const map = new Map();
  const rows = db
    .prepare(
      `SELECT id, project_id, material_id, type, filename, url FROM files WHERE url IS NOT NULL AND url != ''`
    )
    .all();
  const names = new Map(db.prepare("SELECT id, name FROM projects").all().map((r) => [r.id, r.name || ""]));
  for (const r of rows) {
    pushRef(map, r.url, {
      projectId: r.project_id || "",
      projectName: names.get(r.project_id) || "",
      materialId: r.material_id || "",
      fileId: r.id,
      referenceType: r.type === "frame_drawing" ? "live:frame_drawing" : "live:document",
      field: "files.url",
      pinned: false,
      url: normalizeUploadUrl(r.url),
      filename: r.filename || "",
    });
  }
  return map;
}

function collectFrameDrawingTableReferences() {
  const map = new Map();
  let rows = [];
  try {
    rows = db
      .prepare(
        `SELECT id, project_id, stellage_id, title, pdf_url, pdf_filename
         FROM frame_drawings WHERE pdf_url IS NOT NULL AND pdf_url != ''`
      )
      .all();
  } catch {
    return map;
  }
  const names = new Map(db.prepare("SELECT id, name FROM projects").all().map((r) => [r.id, r.name || ""]));
  for (const r of rows) {
    pushRef(map, r.pdf_url, {
      projectId: r.project_id || "",
      projectName: names.get(r.project_id) || "",
      drawingId: r.id,
      rackId: r.stellage_id || "",
      referenceType: "live:frame_drawing",
      field: "frame_drawings.pdf_url",
      pinned: false,
      url: normalizeUploadUrl(r.pdf_url),
      filename: r.pdf_filename || "",
      title: r.title || "",
    });
  }
  return map;
}

function collectMaterialReferences() {
  const map = new Map();
  const rows = db
    .prepare(`SELECT id, name, photo_url FROM materials WHERE photo_url IS NOT NULL AND photo_url != ''`)
    .all();
  for (const m of rows) {
    pushRef(map, m.photo_url, {
      materialId: m.id,
      materialName: m.name || "",
      referenceType: "live:material_photo",
      field: "materials.photo_url",
      pinned: false,
      url: normalizeUploadUrl(m.photo_url),
    });
  }
  return map;
}

function collectBrandingReferences() {
  const map = new Map();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'logoUrl'").get();
  const logo = row?.value || "";
  if (logo) {
    pushRef(map, logo, {
      referenceType: "live:branding_logo",
      field: "settings.logoUrl",
      pinned: false,
      url: normalizeUploadUrl(logo),
    });
  }
  return map;
}

function mergeRefMaps(...maps) {
  const out = new Map();
  for (const m of maps) {
    for (const [url, refs] of m) {
      if (!out.has(url)) out.set(url, []);
      out.get(url).push(...refs);
    }
  }
  for (const [url, refs] of out) {
    out.set(url, dedupeReferences(refs));
  }
  return out;
}

async function hashPhysicalFiles(fileEntries, { concurrency = 4 } = {}) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < fileEntries.length) {
      const idx = i++;
      const entry = fileEntries[idx];
      let contentHash = "";
      try {
        contentHash = await streamSha256(entry.abs);
      } catch {
        contentHash = "";
      }
      results[idx] = { ...entry, contentHash };
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, fileEntries.length || 1) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Full inventory scan. Read-only.
 */
export async function runStorageInventoryScan(options = {}) {
  if (scanInFlight) {
    const err = new Error("Сканирование уже выполняется");
    err.code = "STORAGE_SCAN_IN_PROGRESS";
    throw err;
  }

  const maxFiles = Number(options.maxFiles) || DEFAULT_MAX_FILES;
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const deadlineMs = t0 + timeoutMs;

  scanInFlight = (async () => {
    const root = getUploadRoot();
    const physical = walkUploadRootFiles(root, { maxFiles, deadlineMs });
    const hashed = await hashPhysicalFiles(physical, { concurrency: 4 });

    const refsByUrl = mergeRefMaps(
      collectPublishedReferences(),
      collectLiveProjectReferences(),
      collectFilesTableReferences(),
      collectFrameDrawingTableReferences(),
      collectMaterialReferences(),
      collectBrandingReferences()
    );

    const byPath = new Map();
    for (const f of hashed) {
      const assetPath = normalizeUploadUrl(f.assetPath);
      const refs = dedupeReferences(refsByUrl.get(assetPath) || []);
      const pinnedReferenceCount = refs.filter((r) => r.pinned).length;
      const liveReferenceCount = refs.filter((r) => !r.pinned).length;
      byPath.set(assetPath, {
        assetPath,
        url: assetPath,
        filename: path.basename(f.rel),
        extension: f.extension || path.extname(f.rel),
        mimeType: mimeFromExt(f.extension || path.extname(f.rel)),
        sizeBytes: f.sizeBytes,
        modifiedAt: f.modifiedAt,
        contentHash: f.contentHash || "",
        physicalExists: true,
        referenceCount: refs.length,
        pinnedReferenceCount,
        liveReferenceCount,
        categories: categoryFromPath(assetPath, refs),
        references: refs,
      });
    }

    // Missing references: URL referenced but no physical file
    for (const [url, refs] of refsByUrl) {
      if (byPath.has(url)) continue;
      const abs = resolveLocalUploadAbsPath(url);
      const exists = abs ? fs.existsSync(abs) : false;
      if (exists) continue; // should have been in walk; treat as missing from walk edge case
      const pinnedReferenceCount = refs.filter((r) => r.pinned).length;
      const liveReferenceCount = refs.filter((r) => !r.pinned).length;
      byPath.set(url, {
        assetPath: url,
        url,
        filename: path.basename(url),
        extension: path.extname(url),
        mimeType: mimeFromExt(path.extname(url)),
        sizeBytes: 0,
        modifiedAt: null,
        contentHash: "",
        physicalExists: false,
        referenceCount: refs.length,
        pinnedReferenceCount,
        liveReferenceCount,
        categories: categoryFromPath(url, refs),
        references: refs,
        missingSeverity: missingSeverity({ pinnedReferenceCount, liveReferenceCount }),
      });
    }

    // Duplicate groups
    const hashToPaths = new Map();
    for (const f of byPath.values()) {
      if (!f.physicalExists || !f.contentHash) continue;
      const list = hashToPaths.get(f.contentHash) || [];
      list.push(f.assetPath);
      hashToPaths.set(f.contentHash, list);
    }
    for (const [hash, paths] of hashToPaths) {
      if (paths.length < 2) continue;
      for (const p of paths) {
        const f = byPath.get(p);
        if (f) {
          f.isDuplicate = true;
          f.duplicateGroupHash = hash;
          f.duplicateCount = paths.length;
        }
      }
    }

    const files = [...byPath.values()].map((f) => {
      const status = classifyInventoryStatus({
        physicalExists: f.physicalExists,
        pinnedReferenceCount: f.pinnedReferenceCount,
        liveReferenceCount: f.liveReferenceCount,
        isDuplicate: !!f.isDuplicate && f.pinnedReferenceCount === 0 && f.liveReferenceCount === 0,
      });
      return {
        ...f,
        status,
        statusLabel: status,
        explanation: statusExplanation(status),
        canDelete: false,
      };
    });

    files.sort((a, b) => String(a.assetPath).localeCompare(String(b.assetPath)));

    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - t0;
    const summary = buildInventorySummary(files, {
      scanStartedAt: startedAt,
      scanCompletedAt: completedAt,
      durationMs,
    });

    const result = {
      ok: true,
      readOnly: true,
      uploadRootConfigured: true,
      timedOut: Date.now() > deadlineMs,
      truncated: physical.length >= maxFiles,
      summary,
      files: files.map(sanitizeInventoryFile),
    };
    lastScanResult = result;
    return result;
  })();

  try {
    return await scanInFlight;
  } finally {
    scanInFlight = null;
  }
}

export function queryStorageInventory(query = {}) {
  if (!lastScanResult) {
    return {
      ok: false,
      needsScan: true,
      message: "Сначала выполните сканирование хранилища",
      summary: null,
      files: [],
      page: 1,
      pageSize: 50,
      total: 0,
    };
  }
  const filtered = filterInventoryFiles(lastScanResult.files, query);
  const page = paginateList(filtered, {
    page: query.page,
    pageSize: query.pageSize,
  });
  return {
    ok: true,
    readOnly: true,
    needsScan: false,
    summary: lastScanResult.summary,
    scanMeta: {
      scanStartedAt: lastScanResult.summary?.scanStartedAt,
      scanCompletedAt: lastScanResult.summary?.scanCompletedAt,
      durationMs: lastScanResult.summary?.durationMs,
      timedOut: lastScanResult.timedOut,
      truncated: lastScanResult.truncated,
    },
    ...page,
    files: page.items,
    duplicateGroupDetails: lastScanResult.summary?.duplicateGroupDetails || [],
  };
}

/**
 * Fresh reference counts for a single /uploads/ asset (no filesystem mutation).
 */
export function getAssetReferenceSnapshot(assetPath) {
  const url = normalizeUploadUrl(assetPath);
  const refsByUrl = mergeRefMaps(
    collectPublishedReferences(),
    collectLiveProjectReferences(),
    collectFilesTableReferences(),
    collectFrameDrawingTableReferences(),
    collectMaterialReferences(),
    collectBrandingReferences()
  );
  const refs = dedupeReferences(refsByUrl.get(url) || []);
  const pinnedReferenceCount = refs.filter((r) => r.pinned).length;
  const liveReferenceCount = refs.filter((r) => !r.pinned).length;
  const status = classifyInventoryStatus({
    physicalExists: true,
    pinnedReferenceCount,
    liveReferenceCount,
    isDuplicate: false,
  });
  return {
    assetPath: url,
    references: refs,
    pinnedReferenceCount,
    liveReferenceCount,
    referenceCount: refs.length,
    status,
  };
}

export { streamSha256 };

/** Test helpers */
export const __test = {
  walkUploadRootFiles,
  collectPublishedReferences,
  collectLiveProjectReferences,
  mergeRefMaps,
  resetLastScan() {
    lastScanResult = null;
  },
  setLastScan(result) {
    lastScanResult = result;
  },
};
