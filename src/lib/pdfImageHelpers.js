import { absolutePhotoUrl } from "./photoHelpers.js";
import { itemImageUrl } from "./itemHelpers.js";
import { getAdminKey } from "./api.js";

export const PDF_THUMB_MM = 11;
export const PDF_THUMB_PAD_MM = 1.5;
export const PDF_PHOTO_COL_WIDTH_MM = PDF_THUMB_MM + PDF_THUMB_PAD_MM * 2;

const imageCache = new Map();

function apiBase() {
  return (import.meta.env.VITE_API_URL || import.meta.env.BASE_URL || "").replace(/\/$/, "");
}

function absImageUrl(url) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  const base = apiBase() || (typeof window !== "undefined" ? window.location.origin : "");
  const path = url.startsWith("/") ? url : `/${url}`;
  // Идемпотентно: не префиксовать уже префиксованный путь (иначе /spec/spec/uploads/…).
  if (base && (path === base || path.startsWith(`${base}/`))) return path;
  return `${base}${path}`;
}

function isCrossOriginFetch(url) {
  if (!url.startsWith("http")) return false;
  if (typeof window === "undefined") return true;
  try {
    const pageOrigin = window.location.origin;
    const targetOrigin = new URL(url).origin;
    if (targetOrigin === pageOrigin) return false;
    const api = apiBase();
    if (api) {
      try {
        if (targetOrigin === new URL(api, pageOrigin).origin) return false;
      } catch {
        /* ignore */
      }
    }
    return true;
  } catch {
    return true;
  }
}

export function resolvePdfFetchUrl(url, { clientToken } = {}) {
  const abs = absImageUrl(url);
  if (!abs) return "";
  if (!isCrossOriginFetch(abs)) return abs;
  const base = apiBase() || (typeof window !== "undefined" ? window.location.origin : "http://localhost");
  if (clientToken) {
    return `${base}/api/client/p/${encodeURIComponent(clientToken)}/media?url=${encodeURIComponent(abs)}`;
  }
  return `${base}/api/media/image?url=${encodeURIComponent(abs)}`;
}

export function firstPhotoFromItems(items = []) {
  for (const it of items) {
    const u = itemImageUrl(it);
    if (u) return u;
  }
  return "";
}

export function mergedRowPhotoUrl(row) {
  const direct = row?.imageUrl || row?.photoUrl;
  if (direct) return absImageUrl(direct);
  return firstPhotoFromItems(row?.sourceItems || []);
}

export function itemRowPhotoUrl(it) {
  return itemImageUrl(it) || absolutePhotoUrl(it?.imageUrl || it?.photoUrl || "");
}

/** Разрешаем только image/* и явно не html — чтобы не вставить в PDF HTML/страницу приложения. */
export function isAllowedImageContentType(contentType) {
  const ct = String(contentType || "").toLowerCase();
  if (!ct.startsWith("image/")) return false;
  if (ct.includes("html")) return false;
  return true;
}

/** Валидный data-URL картинки для jsPDF. */
export function isPdfImageDataUrl(value) {
  return typeof value === "string" && value.startsWith("data:image/");
}

export async function loadImageDataUrl(url, opts = {}) {
  if (!url) return null;
  const fetchUrl = resolvePdfFetchUrl(url, opts);
  if (!fetchUrl) return null;
  try {
    const headers = {};
    if (fetchUrl.includes("/api/media/image")) {
      const key = getAdminKey();
      if (key) headers["X-Admin-Key"] = key;
    }
    const res = await fetch(fetchUrl, { headers, credentials: "same-origin", cache: "no-store" });
    if (!res || !res.ok) return null;
    // Отбраковываем не-картинки: HTML/index.html, JSON, 404-страницы и т.п.
    if (!isAllowedImageContentType(res.headers?.get?.("content-type"))) return null;
    const blob = await res.blob();
    if (!blob || blob.size <= 0) return null;
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    if (!isPdfImageDataUrl(dataUrl)) return null;
    return dataUrl;
  } catch {
    return null;
  }
}

function detectImageFormat(dataUrl) {
  if (dataUrl.includes("image/png")) return "PNG";
  if (dataUrl.includes("image/webp") || dataUrl.includes("image/gif")) return "WEBP";
  return "JPEG";
}

async function normalizePdfImage(dataUrl) {
  const format = detectImageFormat(dataUrl);
  if (format !== "WEBP") return { dataUrl, format };
  if (typeof document === "undefined") return null;
  try {
    const jpeg = await rasterizeDataUrl(dataUrl, "image/jpeg");
    return { dataUrl: jpeg, format: "JPEG" };
  } catch {
    return null;
  }
}

function rasterizeDataUrl(dataUrl, mime = "image/jpeg") {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const max = 160;
      const scale = Math.min(1, max / Math.max(img.width, img.height, 1));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("no canvas"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL(mime, 0.88));
    };
    img.onerror = () => reject(new Error("image load failed"));
    img.src = dataUrl;
  });
}

/** Реально ли картинка декодируется браузером (natural size > 0). Вне DOM — пропускаем проверку. */
function probePdfImage(dataUrl) {
  return new Promise((resolve) => {
    if (typeof Image === "undefined") {
      resolve(true);
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > 0);
    img.onerror = () => resolve(false);
    img.src = dataUrl;
  });
}

export async function loadPdfImage(url, opts = {}) {
  if (!url) return null;
  const cacheKey = `${opts.clientToken || ""}|${url}`;
  if (imageCache.has(cacheKey)) return imageCache.get(cacheKey);
  const promise = loadImageDataUrl(url, opts)
    .then((dataUrl) => (dataUrl ? normalizePdfImage(dataUrl) : null))
    .then(async (img) => {
      if (!img || !isPdfImageDataUrl(img.dataUrl) || !img.format) return null;
      const ok = await probePdfImage(img.dataUrl);
      return ok ? img : null;
    });
  imageCache.set(cacheKey, promise);
  return promise;
}

export async function buildPdfPhotoMap(rows, urlPicker = mergedRowPhotoUrl, opts = {}) {
  const map = new Map();
  await Promise.all(
    (rows || []).map(async (row, index) => {
      const img = await loadPdfImage(urlPicker(row), opts);
      if (img) map.set(index, img);
    })
  );
  return map;
}

export function pdfPhotoTableHooks(photoByRowIndex, photoColIndex) {
  const thumb = PDF_THUMB_MM;
  const pad = PDF_THUMB_PAD_MM;
  return {
    didParseCell(data) {
      if (data.column.index !== photoColIndex) return;
      if (data.section === "head") {
        data.cell.styles.cellWidth = PDF_PHOTO_COL_WIDTH_MM;
        return;
      }
      if (data.section === "body") {
        // Чистим ячейку под картинку только если для строки есть валидное фото,
        // иначе оставляем текстовый fallback "—".
        if (photoByRowIndex.get(data.row.index)) {
          data.cell.text = [];
          data.cell.styles.minCellHeight = thumb + pad * 2;
          data.cell.styles.valign = "middle";
        }
      }
    },
    didDrawCell(data) {
      if (data.section !== "body" || data.column.index !== photoColIndex) return;
      const img = photoByRowIndex.get(data.row.index);
      if (!img || !isPdfImageDataUrl(img.dataUrl) || !img.format) return;
      try {
        data.doc.addImage(
          img.dataUrl,
          img.format,
          data.cell.x + pad,
          data.cell.y + pad,
          thumb,
          thumb,
          undefined,
          "FAST"
        );
      } catch {
        /* ignore broken image */
      }
    },
  };
}
