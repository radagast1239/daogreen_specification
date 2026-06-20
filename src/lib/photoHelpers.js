import { photoSrc } from "./api.js";

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

/** Дополнить строку фото из базы перед сохранением в проект */
export function hydrateLinePhoto(line, materials = []) {
  if (line.imageUrl || line.photoUrl) return line;
  const img = resolveLinePhoto(line, materials);
  if (!img) return line;
  return { ...line, imageUrl: img, photoUrl: img };
}
