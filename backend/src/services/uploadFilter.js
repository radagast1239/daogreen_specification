import path from "path";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"]);
const DOC_EXT = new Set([".pdf", ".xlsx", ".xls", ".csv"]);
const IMAGE_MIME = /^image\//;
const DOC_MIME =
  /^(application\/pdf|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|application\/vnd\.ms-excel|text\/csv)/;

export function isAllowedUpload(file, { allowDocs = false } = {}) {
  const ext = path.extname(file?.originalname || "").toLowerCase();
  const mime = String(file?.mimetype || "").toLowerCase();
  if (IMAGE_EXT.has(ext) || IMAGE_MIME.test(mime)) return true;
  if (allowDocs && (DOC_EXT.has(ext) || DOC_MIME.test(mime))) return true;
  return false;
}

export function multerFileFilter(options = {}) {
  return (_req, file, cb) => {
    if (isAllowedUpload(file, options)) cb(null, true);
    else cb(new Error("Недопустимый тип файла. Разрешены изображения" + (options.allowDocs ? " и PDF/Excel" : "") + "."));
  };
}
