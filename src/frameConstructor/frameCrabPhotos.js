import { crabImageSrc } from './frameCrabCatalog.js';

export const CRAB_PHOTOS_STORAGE_KEY = 'daogreen-frame-crab-photos';
export const CRAB_PHOTOS_CHANGED_EVENT = 'daogreen-crab-photos-changed';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_PX = 480;

function readAll() {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(CRAB_PHOTOS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(map) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CRAB_PHOTOS_STORAGE_KEY, JSON.stringify(map));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(CRAB_PHOTOS_CHANGED_EVENT));
    }
  } catch {
    /* ignore quota */
  }
}

/** @param {string} file */
export function getCrabPhotoOverride(file) {
  if (!file) return null;
  const dataUrl = readAll()[file];
  return typeof dataUrl === 'string' && dataUrl.startsWith('data:image/') ? dataUrl : null;
}

/** @param {{ file: string }} entry */
export function resolveCrabImageSrc(entry) {
  return getCrabPhotoOverride(entry.file) || crabImageSrc(entry);
}

/** @param {string} file @param {string} dataUrl */
export function setCrabPhotoOverride(file, dataUrl) {
  if (!file || typeof dataUrl !== 'string') return;
  const map = readAll();
  map[file] = dataUrl;
  writeAll(map);
}

/** @param {string} file */
export function clearCrabPhotoOverride(file) {
  if (!file) return;
  const map = readAll();
  if (!(file in map)) return;
  delete map[file];
  writeAll(map);
}

/** @param {() => void} listener */
export function subscribeCrabPhotos(listener) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(CRAB_PHOTOS_CHANGED_EVENT, listener);
  return () => window.removeEventListener(CRAB_PHOTOS_CHANGED_EVENT, listener);
}

/**
 * Сжимает изображение перед сохранением в localStorage.
 * @param {File} file
 * @returns {Promise<string>}
 */
export function resizeCrabPhotoFile(file) {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith('image/')) {
      reject(new Error('Выберите файл изображения (JPG, PNG или WebP).'));
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      reject(new Error('Файл слишком большой (макс. 5 МБ).'));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, MAX_IMAGE_PX / Math.max(img.width, img.height, 1));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.88));
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('Не удалось прочитать изображение.'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
    reader.readAsDataURL(file);
  });
}

/**
 * @param {string} file
 * @param {File} imageFile
 */
export async function uploadCrabPhoto(file, imageFile) {
  const dataUrl = await resizeCrabPhotoFile(imageFile);
  setCrabPhotoOverride(file, dataUrl);
  return dataUrl;
}
