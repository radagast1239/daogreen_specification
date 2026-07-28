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

function reject(cb, message, code) {
  const err = new Error(message);
  err.code = code;
  err.status = 400;
  cb(err);
}

export function isAllowedUpload(file, { allowDocs = false, pdfOnly = false } = {}) {
  const filename = file?.originalname || "";
  const ext = path.extname(filename).toLowerCase();
  const mime = String(file?.mimetype || "").toLowerCase();

  if (ext === ".svg" || mime === "image/svg+xml" || mime.includes("svg")) {
    return false;
  }
  if (looksLikeSvg(null, { filename, mime })) {
    return false;
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
      cb(
        new Error(
          "Недопустимый тип файла. Разрешены JPEG/PNG/WebP" +
            (options.allowDocs ? " и PDF/Excel" : "") +
            ".",
        ),
      );
    }
  };
}
