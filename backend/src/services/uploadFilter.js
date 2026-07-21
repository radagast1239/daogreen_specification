import path from "path";
import {
  UPLOAD_SVG_FORBIDDEN,
  looksLikeSvg,
} from "./uploadValidation.js";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const DOC_EXT = new Set([".pdf", ".xlsx", ".xls", ".csv"]);
const IMAGE_MIME = /^(image\/jpeg|image\/jpg|image\/png|image\/webp)$/;
const DOC_MIME =
  /^(application\/pdf|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|application\/vnd\.ms-excel|text\/csv|application\/csv)/;

/** Strict allow-list for project floor/client schemes (no SVG/GIF/HTML/exec). */
export const SCHEME_MEDIA_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".pdf"]);
export const SCHEME_MEDIA_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

export const SCHEME_MEDIA_MAX_BYTES = 25 * 1024 * 1024;

function reject(cb, message, code) {
  const err = new Error(message);
  err.code = code;
  err.status = 400;
  cb(err);
}

export function isAllowedUpload(file, { allowDocs = false, pdfOnly = false, schemeMedia = false } = {}) {
  const filename = file?.originalname || "";
  const ext = path.extname(filename).toLowerCase();
  const mime = String(file?.mimetype || "").toLowerCase();

  if (ext === ".svg" || mime === "image/svg+xml" || mime.includes("svg")) {
    return false;
  }
  if (looksLikeSvg(null, { filename, mime })) {
    return false;
  }

  if (schemeMedia) {
    const extOk = SCHEME_MEDIA_EXT.has(ext);
    const mimeOk = SCHEME_MEDIA_MIME.has(mime);
    if (ext && mime && mime !== "application/octet-stream") return extOk && mimeOk;
    return extOk || mimeOk;
  }

  if (pdfOnly) {
    return ext === ".pdf" || mime === "application/pdf";
  }

  if (IMAGE_EXT.has(ext) || IMAGE_MIME.test(mime)) return true;
  if (allowDocs && (DOC_EXT.has(ext) || DOC_MIME.test(mime))) return true;
  return false;
}

export function multerFileFilter(options = {}) {
  return (_req, file, cb) => {
    const filename = file?.originalname || "";
    const mime = String(file?.mimetype || "").toLowerCase();
    if (looksLikeSvg(null, { filename, mime })) {
      return reject(cb, "SVG uploads are forbidden", UPLOAD_SVG_FORBIDDEN);
    }
    if (isAllowedUpload(file, options)) cb(null, true);
    else if (options.pdfOnly) {
      reject(cb, "PDF file required", "FRAME_DRAWING_PDF_REQUIRED");
    } else {
      const msg = options.schemeMedia
        ? "Недопустимый тип файла. Разрешены JPEG, PNG, WebP и PDF."
        : "Недопустимый тип файла. Разрешены JPEG/PNG/WebP" +
          (options.allowDocs ? " и PDF/Excel" : "") +
          ".";
      cb(new Error(msg));
    }
  };
}

/**
 * Detect media kind from magic bytes. Returns normalized mime or null.
 */
export function detectSchemeMediaKind(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (buffer.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

function extForMime(mime) {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "application/pdf") return ".pdf";
  return "";
}

/**
 * Validate declared MIME + extension against magic bytes for scheme uploads.
 * @returns {{ mimeType: string, ext: string }}
 */
export function assertSchemeMediaBuffer(buffer, { originalname = "", mimetype = "" } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    const err = new Error("Пустой файл");
    err.status = 400;
    throw err;
  }
  if (buffer.length > SCHEME_MEDIA_MAX_BYTES) {
    const err = new Error("Файл слишком большой (макс. 25 МБ)");
    err.status = 413;
    throw err;
  }

  const detected = detectSchemeMediaKind(buffer);
  if (!detected) {
    const err = new Error("Файл не является допустимым JPEG/PNG/WebP/PDF");
    err.status = 415;
    throw err;
  }

  const declaredMime = String(mimetype || "").toLowerCase().split(";")[0].trim();
  const ext = path.extname(originalname || "").toLowerCase();

  if (declaredMime && declaredMime !== "application/octet-stream" && declaredMime !== detected) {
    // Allow image/jpg alias for jpeg
    const aliasOk =
      (declaredMime === "image/jpg" && detected === "image/jpeg") ||
      (declaredMime === "image/pjpeg" && detected === "image/jpeg");
    if (!aliasOk) {
      const err = new Error("MIME файла не совпадает с содержимым");
      err.status = 415;
      throw err;
    }
  }

  if (ext) {
    const expected = extForMime(detected);
    const ok =
      ext === expected ||
      (detected === "image/jpeg" && (ext === ".jpg" || ext === ".jpeg")) ||
      (detected === "application/pdf" && ext === ".pdf");
    if (!ok && SCHEME_MEDIA_EXT.has(ext)) {
      const err = new Error("Расширение файла не совпадает с содержимым");
      err.status = 415;
      throw err;
    }
    if (ext === ".svg" || ext === ".html" || ext === ".htm" || ext === ".js" || ext === ".exe") {
      const err = new Error("Недопустимый тип файла");
      err.status = 415;
      throw err;
    }
  }

  return { mimeType: detected, ext: extForMime(detected) };
}
