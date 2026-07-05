import { uid } from '../lib/ids.js';
import { normalizeFrameConfig } from './frameConfig.js';

export const FRAME_PRESETS_STORAGE_KEY = 'daogreen-frame-presets';

function readAll() {
  try {
    const raw = localStorage.getItem(FRAME_PRESETS_STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeAll(list) {
  try {
    localStorage.setItem(FRAME_PRESETS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore quota */
  }
}

export function listSavedFramePresets() {
  return readAll().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export function getSavedFramePreset(id) {
  return readAll().find((p) => p.id === id) || null;
}

export function saveFramePreset({ id, name, params }) {
  const list = readAll();
  const now = new Date().toISOString();
  const presetName = (name || params?.name || 'Мой стеллаж').trim() || 'Мой стеллаж';
  const normalizedParams = normalizeFrameConfig({ ...params, name: presetName });
  const idx = id ? list.findIndex((p) => p.id === id) : -1;

  if (idx >= 0) {
    const next = {
      ...list[idx],
      name: presetName,
      params: normalizedParams,
      updatedAt: now,
    };
    list[idx] = next;
    writeAll(list);
    return next;
  }

  const created = {
    id: uid('frame'),
    name: presetName,
    params: normalizedParams,
    createdAt: now,
    updatedAt: now,
  };
  list.push(created);
  writeAll(list);
  return created;
}

export function deleteSavedFramePreset(id) {
  writeAll(readAll().filter((p) => p.id !== id));
}
