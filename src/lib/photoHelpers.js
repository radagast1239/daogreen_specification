import { photoSrc } from "./api.js";

function apiBase() {
  return (import.meta.env.VITE_API_URL || import.meta.env.BASE_URL || "").replace(/\/$/, "");
}

/** Абсолютный URL фото для экспорта и клиента */
export function absolutePhotoUrl(url) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  const base =
    import.meta.env.VITE_API_URL ||
    (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}${url.startsWith("/") ? url : `/${url}`}`;
}

export function materialPhoto(mat) {
  if (!mat) return "";
  return mat.imageUrl || mat.photoUrl || "";
}

/** Фото строки сборщика: из строки или из материала базы */
export function resolveLinePhoto(line, materials = []) {
  const direct = line?.imageUrl || line?.photoUrl || "";
  if (direct) return direct;
  if (!line?.materialId) return "";
  const mat = materials.find((m) => m.id === line.materialId);
  return materialPhoto(mat);
}

export function linePhotoSrc(line, materials = []) {
  const u = resolveLinePhoto(line, materials);
  return u ? photoSrc(u) : "";
}

export function itemPhotoSrc(it) {
  const u = it?.imageUrl || it?.photoUrl || "";
  return u ? photoSrc(u) : "";
}

/**
 * Client purchase thumb src (restores production 6df5 dist wiring):
 * - http | /api/* | /uploads/public/* → photoSrc
 * - other /uploads/* + clientToken → /api/client/p/{token}/media?url=...
 * - else → photoSrc
 */
export function clientPhotoSrc(it, clientToken) {
  const raw = String(it?.accessUrl || it?.imageUrl || it?.photoUrl || "").trim();
  if (!raw) return "";
  if (raw.startsWith("http") || raw.startsWith("/api/")) return photoSrc(raw);
  if (raw.startsWith("/uploads/public/")) return photoSrc(raw);
  if (clientToken && raw.startsWith("/uploads/")) {
    const path = raw.startsWith("/") ? raw : `/${raw}`;
    return `${apiBase()}/api/client/p/${encodeURIComponent(clientToken)}/media?url=${encodeURIComponent(path)}`;
  }
  return photoSrc(raw);
}

/** Merged purchase row photo: prefer sourceItems[0], else the row itself. */
export function clientMergedPhotoSrc(row, clientToken) {
  const first = row?.sourceItems?.[0];
  return clientPhotoSrc(first || row, clientToken);
}

/** Дополнить строку фото из базы перед сохранением в проект */
export function hydrateLinePhoto(line, materials = []) {
  if (line.imageUrl || line.photoUrl) return line;
  const img = resolveLinePhoto(line, materials);
  if (!img) return line;
  return { ...line, imageUrl: img, photoUrl: img };
}
