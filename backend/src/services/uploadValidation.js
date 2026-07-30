/**
 * Upload content validation: magic bytes, SVG ban, PDF checks, path safety.
 */
import path from "path";

export const UPLOAD_SVG_FORBIDDEN = "UPLOAD_SVG_FORBIDDEN";
export const UPLOAD_TYPE_MISMATCH = "UPLOAD_TYPE_MISMATCH";
export const UPLOAD_MAGIC_MISMATCH = "UPLOAD_MAGIC_MISMATCH";
export const UPLOAD_TYPE_FORBIDDEN = "UPLOAD_TYPE_FORBIDDEN";
export const FRAME_DRAWING_PDF_REQUIRED = "FRAME_DRAWING_PDF_REQUIRED";
export const UPLOAD_PATH_INVALID = "UPLOAD_PATH_INVALID";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const IMAGE_MIME = {
  ".jpg": new Set(["image/jpeg", "image/jpg"]),
  ".jpeg": new Set(["image/jpeg", "image/jpg"]),
  ".png": new Set(["image/png"]),
  ".webp": new Set(["image/webp"]),
};

export class UploadValidationError extends Error {
  constructor(code, message, status = 400) {
    super(message || code);
    this.name = "UploadValidationError";
    this.code = code;
    this.status = status;
  }
}

export function detectImageMagic(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (buf.length < 3) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "png";
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

export function detectPdfMagic(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (buf.length < 5) return false;
  return buf.slice(0, 5).toString("ascii") === "%PDF-";
}

export function looksLikeSvg(buffer, { filename = "", mime = "" } = {}) {
  const ext = path.extname(filename || "").toLowerCase();
  const m = String(mime || "").toLowerCase();
  if (ext === ".svg" || m === "image/svg+xml" || m.includes("svg")) return true;
  const head = Buffer.isBuffer(buffer)
    ? buffer.slice(0, 1024).toString("utf8")
    : String(buffer || "").slice(0, 1024);
  const trimmed = head.trim().toLowerCase();
  if (!trimmed) return false;
  if (trimmed.includes("<svg")) return true;
  if (trimmed.startsWith("<?xml") && trimmed.includes("<svg")) return true;
  return false;
}

export function sanitizeUploadBasename(name, fallback = "file") {
  const base = path.basename(String(name || fallback));
  const cleaned = base
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
  if (!cleaned || cleaned === "." || cleaned === ".." || cleaned.includes("..")) {
    return fallback;
  }
  return cleaned;
}

/** Relative path under upload root from a stored /uploads/... URL. Rejects traversal. */
export function uploadsRelativeFromUrl(url) {
  const u = String(url || "").replace(/\\/g, "/").trim();
  if (!u.startsWith("/uploads/")) return null;
  const rel = u.slice("/uploads/".length).replace(/^\/+/, "");
  if (!rel || rel.includes("..") || path.isAbsolute(rel)) return null;
  if (rel.split("/").some((p) => p === ".." || p === "")) return null;
  return rel;
}

export function resolvePathInsideUploadRoot(uploadRoot, relativeOrUrl) {
  const root = path.resolve(uploadRoot);
  let rel = String(relativeOrUrl || "").replace(/\\/g, "/");
  if (rel.startsWith("/uploads/")) {
    rel = uploadsRelativeFromUrl(rel);
    if (!rel) {
      throw new UploadValidationError(UPLOAD_PATH_INVALID, "Invalid upload path", 400);
    }
  } else {
    rel = rel.replace(/^\/+/, "");
    if (!rel || rel.includes("..") || path.isAbsolute(rel)) {
      throw new UploadValidationError(UPLOAD_PATH_INVALID, "Invalid upload path", 400);
    }
  }
  const abs = path.resolve(root, rel);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(rootWithSep)) {
    throw new UploadValidationError(UPLOAD_PATH_INVALID, "Path outside upload root", 403);
  }
  return abs;
}

/**
 * Validate image upload: JPEG/PNG/WebP only. Ext + mime + magic must agree. SVG always forbidden.
 */
export function assertValidImageUpload(file) {
  const filename = file?.originalname || file?.filename || "";
  const mime = String(file?.mimetype || "").toLowerCase();
  const buffer = file?.buffer;
  if (looksLikeSvg(buffer, { filename, mime })) {
    throw new UploadValidationError(UPLOAD_SVG_FORBIDDEN, "SVG uploads are forbidden", 400);
  }
  const ext = path.extname(filename).toLowerCase();
  if (!IMAGE_EXT.has(ext)) {
    throw new UploadValidationError(
      UPLOAD_TYPE_FORBIDDEN,
      "Allowed image types: JPEG, PNG, WebP",
      400,
    );
  }
  const allowedMimes = IMAGE_MIME[ext];
  if (!allowedMimes.has(mime)) {
    throw new UploadValidationError(
      UPLOAD_TYPE_MISMATCH,
      "File extension and Content-Type do not match",
      400,
    );
  }
  const magic = detectImageMagic(buffer);
  if (!magic) {
    throw new UploadValidationError(UPLOAD_MAGIC_MISMATCH, "File content is not a valid image", 400);
  }
  const expected =
    ext === ".png" ? "png" : ext === ".webp" ? "webp" : "jpeg";
  if (magic !== expected) {
    throw new UploadValidationError(
      UPLOAD_MAGIC_MISMATCH,
      "File content does not match declared image type",
      400,
    );
  }
  return { ext, mime, magic };
}

/**
 * Validate PDF-only frame drawing upload.
 */
export function assertValidPdfUpload(file, { code = FRAME_DRAWING_PDF_REQUIRED } = {}) {
  const filename = file?.originalname || file?.filename || "";
  const mime = String(file?.mimetype || "").toLowerCase();
  const buffer = file?.buffer;
  if (looksLikeSvg(buffer, { filename, mime })) {
    throw new UploadValidationError(UPLOAD_SVG_FORBIDDEN, "SVG uploads are forbidden", 400);
  }
  const ext = path.extname(filename).toLowerCase();
  if (ext !== ".pdf" && mime !== "application/pdf") {
    throw new UploadValidationError(code, "PDF file required", 400);
  }
  if (ext && ext !== ".pdf") {
    throw new UploadValidationError(code, "PDF file required", 400);
  }
  if (mime && mime !== "application/pdf" && mime !== "application/x-pdf") {
    throw new UploadValidationError(code, "PDF file required", 400);
  }
  if (!detectPdfMagic(buffer)) {
    throw new UploadValidationError(code, "File content is not a valid PDF", 400);
  }
  return { ext: ".pdf", mime: "application/pdf" };
}

/**
 * Validate admin document upload: images (JPEG/PNG/WebP) or PDF/Excel by ext+mime;
 * images still need magic; PDF needs magic; Excel trusted by ext+mime (OOXML zip).
 */
export function assertValidDocumentUpload(file) {
  const filename = file?.originalname || file?.filename || "";
  const mime = String(file?.mimetype || "").toLowerCase();
  const buffer = file?.buffer;
  if (looksLikeSvg(buffer, { filename, mime })) {
    throw new UploadValidationError(UPLOAD_SVG_FORBIDDEN, "SVG uploads are forbidden", 400);
  }
  const ext = path.extname(filename).toLowerCase();
  if (IMAGE_EXT.has(ext) || mime.startsWith("image/")) {
    return assertValidImageUpload(file);
  }
  if (ext === ".pdf" || mime === "application/pdf") {
    return assertValidPdfUpload(file, { code: UPLOAD_MAGIC_MISMATCH });
  }
  const docExt = new Set([".xlsx", ".xls", ".csv"]);
  const docMime =
    /^(application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|application\/vnd\.ms-excel|text\/csv|application\/csv)/;
  if (docExt.has(ext) || docMime.test(mime)) {
    if (docExt.has(ext) && mime && !docMime.test(mime) && mime !== "application/octet-stream") {
      // allow octet-stream for excel from some browsers
      if (![".xlsx", ".xls", ".csv"].includes(ext)) {
        throw new UploadValidationError(UPLOAD_TYPE_MISMATCH, "Document type mismatch", 400);
      }
    }
    return { ext, mime };
  }
  throw new UploadValidationError(
    UPLOAD_TYPE_FORBIDDEN,
    "Allowed: JPEG/PNG/WebP, PDF, Excel",
    400,
  );
}

export function mimeFromFilename(name) {
  const ext = path.extname(name || "").toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (ext === ".xls") return "application/vnd.ms-excel";
  if (ext === ".csv") return "text/csv";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

export function contentDisposition(filename, { inline = false } = {}) {
  const safe = sanitizeUploadBasename(filename, "file").replace(/"/g, "");
  const type = inline ? "inline" : "attachment";
  return `${type}; filename="${safe}"`;
}
