import { uid } from "../store/helpers.js";
import { DEFAULT_PLAN } from "./catalog.js";
import { triggerDownload } from "../lib/exportDownload.js";

const STORAGE_KEY = "daogreen-standalone-plans";
const FILE_FORMAT = "daogreen-plan";
const FILE_VERSION = 1;

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeAll(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function listStandalonePlans() {
  return readAll().sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

export function getStandalonePlan(id) {
  return readAll().find((d) => d.id === id) || null;
}

export function saveStandalonePlan(draft) {
  const list = readAll();
  const idx = list.findIndex((d) => d.id === draft.id);
  const next = { ...draft, updatedAt: new Date().toISOString() };
  if (idx >= 0) list[idx] = next;
  else list.push(next);
  writeAll(list);
  return next;
}

export function createStandalonePlan(name = "Новый план") {
  const draft = {
    id: uid("draft"),
    name: name.trim() || "Новый план",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    plan: DEFAULT_PLAN(),
  };
  saveStandalonePlan(draft);
  return draft;
}

export function renameStandalonePlan(id, name) {
  const draft = getStandalonePlan(id);
  if (!draft) return null;
  return saveStandalonePlan({ ...draft, name: name.trim() || draft.name });
}

export function deleteStandalonePlan(id) {
  writeAll(readAll().filter((d) => d.id !== id));
}

export function planToFilePayload(draft) {
  return {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    exportedAt: new Date().toISOString(),
    name: draft.name,
    plan: draft.plan,
  };
}

export function downloadPlanFile(draft) {
  const payload = planToFilePayload(draft);
  const safe = (draft.name || "план").replace(/[^\wа-яА-ЯёЁ\s-]+/gi, "").trim() || "план";
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  triggerDownload(blob, `${safe}.daogreen-plan.json`);
}

export function parsePlanFile(json) {
  if (!json || typeof json !== "object") throw new Error("Неверный файл");
  if (json.format === FILE_FORMAT && json.plan) {
    return { name: json.name || "Импортированный план", plan: json.plan };
  }
  if (json.room && Array.isArray(json.items)) {
    return { name: json.name || "Импортированный план", plan: json };
  }
  throw new Error("Файл не похож на план Daogreen");
}

export async function readPlanFile(file) {
  const text = await file.text();
  return parsePlanFile(JSON.parse(text));
}

export function importStandalonePlan({ name, plan }) {
  const draft = {
    id: uid("draft"),
    name: name || "Импортированный план",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    plan,
  };
  saveStandalonePlan(draft);
  return draft;
}
