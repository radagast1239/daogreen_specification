import { uid } from "./ids.js";

export function normalizeRackImages(images) {
  if (!Array.isArray(images)) return [];
  return images
    .filter((image) => image && image.url)
    .map((image, index) => ({
      id: image.id || uid("rack_img"),
      title: String(image.title || `Изображение ${index + 1}`).trim(),
      url: image.url,
      mimeType: String(image.mimeType || "image/*"),
      sortOrder: index,
      createdAt: image.createdAt || new Date().toISOString(),
      clientVisible: image.clientVisible === true,
      rackId: String(image.rackId || ""),
    }));
}

export function addRackImage(images, file, url, rackId = "") {
  const list = normalizeRackImages(images);
  const title = String(file?.name || `Изображение ${list.length + 1}`).replace(/\.[^.]+$/, "");
  return [...list, {
    id: uid("rack_img"),
    title,
    url,
    mimeType: file?.type || "image/*",
    sortOrder: list.length,
    createdAt: new Date().toISOString(),
    clientVisible: false,
    rackId: String(rackId || ""),
  }];
}

export function updateRackImage(images, id, patch) {
  return normalizeRackImages(images).map((image) => image.id === id ? { ...image, ...patch } : image);
}

export function moveRackImage(images, id, direction) {
  const list = normalizeRackImages(images);
  const from = list.findIndex((image) => image.id === id);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= list.length) return list;
  [list[from], list[to]] = [list[to], list[from]];
  return list.map((image, sortOrder) => ({ ...image, sortOrder }));
}

export function cloneRackImages(images) {
  return normalizeRackImages(images).map((image, sortOrder) => ({
    ...image,
    id: uid("rack_img"),
    sortOrder,
  }));
}
