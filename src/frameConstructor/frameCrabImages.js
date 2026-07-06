import { crabCatalogByKey, crabImagePublicPath } from './frameCrabCatalog.js';
import { getCrabPhotoOverride } from './frameCrabPhotos.js';

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'svg'];

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function svgTextToPngDataUrl(svgText, size = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('SVG rasterize failed'));
    };
    img.src = url;
  });
}

async function fetchImageBlob(file, ext) {
  const url = crabImagePublicPath(file, ext);
  const resp = await fetch(url);
  if (!resp.ok) return null;
  return resp.blob();
}

/**
 * Загружает фото краба для PDF (растр PNG data URL).
 * @param {string} file — имя файла без расширения (g, t, x, a4, a6)
 * @returns {Promise<string|null>}
 */
export async function loadCrabImageDataUrl(file) {
  if (!file) return null;

  const custom = getCrabPhotoOverride(file);
  if (custom) return custom;

  if (typeof fetch === 'undefined') return null;

  for (const ext of IMAGE_EXTENSIONS) {
    try {
      const blob = await fetchImageBlob(file, ext);
      if (!blob) continue;
      if (ext === 'svg' || blob.type.includes('svg')) {
        const text = await blob.text();
        return await svgTextToPngDataUrl(text);
      }
      const dataUrl = await blobToDataUrl(blob);
      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
        return dataUrl;
      }
    } catch {
      // try next extension
    }
  }
  return null;
}

/**
 * @param {{ crabKey?: string|null, crabFile?: string|null }[]} hardwareRows
 */
export async function loadHardwareRowImages(hardwareRows) {
  const cache = new Map();
  return Promise.all(
    hardwareRows.map(async (row) => {
      const file = row.crabFile || crabCatalogByKey(row.crabKey)?.file;
      if (!file) return { ...row, imageDataUrl: null };
      if (!cache.has(file)) {
        cache.set(file, loadCrabImageDataUrl(file));
      }
      const imageDataUrl = await cache.get(file);
      return { ...row, imageDataUrl };
    }),
  );
}
