import {
  bulkPatchItemsWithFallback,
  refreshItemsFromMaterialWithFallback,
} from "./projectItemApiFallback.js";

const API = (import.meta.env.VITE_API_URL || import.meta.env.BASE_URL || "").replace(/\/$/, "");

const ADMIN_KEY_STORAGE = "daogreen-admin-key";
const projectRevisionCache = new Map();
const clientRevisionCache = new Map();

function projectIdFromPath(path) {
  const match = String(path).match(/^\/api\/projects\/([^/?]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function rememberProjectRevision(projectId, value) {
  const revision = Number(value?.revision ?? value);
  if (projectId && revision > 0) projectRevisionCache.set(projectId, revision);
}

function rememberClientRevision(token, value) {
  const revision = Number(value?.revision ?? value);
  if (token && revision > 0) clientRevisionCache.set(token, revision);
}

export function getCachedProjectRevision(projectId) {
  return projectRevisionCache.get(projectId) || null;
}

export function getCachedClientRevision(token) {
  return clientRevisionCache.get(token) || null;
}

export function getAdminKey() {
  return localStorage.getItem(ADMIN_KEY_STORAGE) || "";
}

export function setAdminKey(key) {
  localStorage.setItem(ADMIN_KEY_STORAGE, key);
}

export function clearAdminKey() {
  localStorage.removeItem(ADMIN_KEY_STORAGE);
}

async function request(path, { method = "GET", body, admin = true, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (admin) {
    const key = getAdminKey();
    if (key) headers["X-Admin-Key"] = key;
  }
  if (token) headers["X-Client-Token"] = token;

  const projectId = projectIdFromPath(path);
  let effectiveBody = body;
  if (admin && projectId && method !== "GET" && method !== "DELETE" && body && typeof body === "object" && body.expectedRevision == null) {
    effectiveBody = { ...body, expectedRevision: projectRevisionCache.get(projectId) };
  }
  if (!admin && token && method !== "GET" && body && typeof body === "object" && body.expectedRevision == null) {
    effectiveBody = { ...body, expectedRevision: clientRevisionCache.get(token) };
  }
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: effectiveBody != null ? JSON.stringify(effectiveBody) : undefined,
    // Cookie sessions need credentials on admin calls; client-token mode stays same-origin.
    credentials: admin ? "include" : "same-origin",
  });

  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const payload = data?.error && typeof data.error === "object" ? data.error : data;
    const err = new Error(payload?.message || data.error || `HTTP ${res.status}`);
    err.status = res.status;
    if (payload?.code) err.code = payload.code;
    else if (typeof data.error === "string" && /^[A-Z0-9_]+$/.test(data.error)) err.code = data.error;
    if (payload?.projectId) err.projectId = payload.projectId;
    if (payload?.expectedRevision != null) err.expectedRevision = payload.expectedRevision;
    if (payload?.currentRevision != null) err.currentRevision = payload.currentRevision;
    if (data.problems) err.problems = data.problems;
    if (payload?.references || data.references) err.references = payload?.references || data.references;
    throw err;
  }
  if (Array.isArray(data)) {
    for (const project of data) rememberProjectRevision(project?.id, project);
  } else {
    rememberProjectRevision(projectId || data?.id || data?.projectId || data?.project?.id, data?.project || data);
    if (token) rememberClientRevision(token, data);
  }
  return data;
}

function adminFetchHeaders(extra = {}) {
  const headers = { ...extra };
  const key = getAdminKey();
  if (key) headers["X-Admin-Key"] = key;
  return headers;
}

export const api = {
  health: () => request("/api/health", { admin: false }),

  getMaterials: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/api/materials${q ? `?${q}` : ""}`);
  },
  getMaterialTranslationCoverage: () => request("/api/materials/meta/translation-coverage"),
  upsertMaterialTranslation: (id, body) =>
    request(`/api/materials/${id}/translation`, { method: "PUT", body }),
  getModules: () => request("/api/materials/modules"),
  createMaterial: (data) => request("/api/materials", { method: "POST", body: data }),
  updateMaterial: (id, patch) => request(`/api/materials/${id}`, { method: "PATCH", body: patch }),
  deleteMaterial: (id) => request(`/api/materials/${id}`, { method: "DELETE" }),
  importExcel: async (file, { module, mode } = {}) => {
    const fd = new FormData();
    fd.append("file", file);
    if (module) fd.append("module", module);
    if (mode) fd.append("mode", mode);
    const res = await fetch(`${API}/api/materials/import/excel`, {
      method: "POST",
      headers: adminFetchHeaders(),
      body: fd,
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.message || data.error || "Import failed");
      err.status = res.status;
      if (data.code) err.code = data.code;
      else if (typeof data.error === "string" && /^[A-Z0-9_]+$/.test(data.error)) err.code = data.error;
      if (data.references) err.references = data.references;
      throw err;
    }
    return data;
  },
  uploadPhoto: async (file) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${API}/api/materials/upload-photo`, {
      method: "POST",
      headers: adminFetchHeaders(),
      body: fd,
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed");
    return data;
  },
  bulkPhotos: async (files) => {
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    const res = await fetch(`${API}/api/materials/bulk-photos`, {
      method: "POST",
      headers: adminFetchHeaders(),
      body: fd,
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed");
    return data;
  },
  importPhotosFolder: () => request("/api/materials/import-photos-folder", { method: "POST" }),
  importExcelPhotos: async (file, { module } = {}) => {
    const fd = new FormData();
    fd.append("file", file);
    if (module) fd.append("module", module);
    const res = await fetch(`${API}/api/materials/import/excel-photos`, {
      method: "POST",
      headers: adminFetchHeaders(),
      body: fd,
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Import failed");
    return data;
  },

  getProjects: () => request("/api/projects"),
  getDashboard: () => request("/api/projects/dashboard/summary"),
  getProject: (id) => request(`/api/projects/${id}`),
  createProject: (data) => request("/api/projects", { method: "POST", body: data }),
  updateProject: (id, patch) => request(`/api/projects/${id}`, { method: "PATCH", body: patch }),
  refreshFrameBom: (id, body) =>
    request(`/api/projects/${id}/frame-bom/refresh`, { method: "POST", body }),
  deleteProject: (id) => request(`/api/projects/${id}`, { method: "DELETE" }),
  duplicateProject: (id, body) => request(`/api/projects/${id}/duplicate`, { method: "POST", body: body || {} }),
  importPreview: (id, body) => request(`/api/projects/${id}/import-preview`, { method: "POST", body }),
  importFromProject: (id, body) => request(`/api/projects/${id}/import-from-project`, { method: "POST", body }),
  compareProjects: (id, otherId) => request(`/api/projects/${id}/compare/${otherId}`),
  listSectionTemplates: () => request("/api/projects/section-templates/list"),
  saveSectionTemplate: (id, module, body) =>
    request(`/api/projects/${id}/sections/${encodeURIComponent(module)}/save-template`, { method: "POST", body }),
  applySectionTemplate: (id, body) =>
    request(`/api/projects/${id}/apply-section-template`, { method: "POST", body }),
  approveAll: (id, expectedRevision) => request(`/api/projects/${id}/approve-all`, { method: "POST", body: { expectedRevision } }),
  createVersion: (id, body, expectedRevision) => request(`/api/projects/${id}/versions`, { method: "POST", body: { ...(body || {}), expectedRevision } }),
  getVersions: (id) => request(`/api/projects/${id}/versions`),
  getVersionClientPreview: (id, versionId) =>
    request(`/api/projects/${id}/versions/${encodeURIComponent(versionId)}/client-preview`),
  getVersionDiff: (id, versionId, compareTo) => {
    const q = compareTo ? `?compareTo=${encodeURIComponent(compareTo)}` : "";
    return request(`/api/projects/${id}/versions/${encodeURIComponent(versionId)}/diff${q}`);
  },
  getVersionPdfData: (id, versionId) =>
    request(`/api/projects/${id}/versions/${encodeURIComponent(versionId)}/pdf`),
  downloadVersionExcel: async (id, versionId) => {
    const r = await fetch(`${API}/api/projects/${id}/versions/${encodeURIComponent(versionId)}/excel`, {
      headers: adminFetchHeaders(),
      credentials: "include",
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(t || `Excel ${r.status}`);
    }
    const blob = await r.blob();
    const cd = r.headers.get("Content-Disposition") || "";
    const m = /filename="([^"]+)"/.exec(cd);
    const filename = m?.[1] || `Daogreen_v_${versionId}.xlsx`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  regenerateToken: (id, expectedRevision) => request(`/api/projects/${id}/regenerate-token`, { method: "POST", body: { expectedRevision } }),
  patchItem: (projectId, itemId, patch, expectedRevision) =>
    request(`/api/projects/${projectId}/items/${encodeURIComponent(itemId)}`, { method: "PATCH", body: { ...patch, expectedRevision } }),
  refreshItemsFromMaterial: (projectId, body, context) =>
    refreshItemsFromMaterialWithFallback(request, projectId, body, context),
  bulkPatchItems: (projectId, body) => bulkPatchItemsWithFallback(request, projectId, body),
  addItem: (projectId, item, expectedRevision) => request(`/api/projects/${projectId}/items`, { method: "POST", body: { ...item, expectedRevision } }),
  deleteItem: (projectId, itemId, expectedRevision) =>
    request(`/api/projects/${projectId}/items/${encodeURIComponent(itemId)}?expectedRevision=${encodeURIComponent(expectedRevision ?? projectRevisionCache.get(projectId) ?? "")}`, { method: "DELETE" }),

  getClientProject: (token) =>
    request(`/api/client/p/${encodeURIComponent(token)}`, { admin: false, token }),
  patchClientItem: (token, itemId, patch) =>
    request(`/api/client/p/${encodeURIComponent(token)}/items/${encodeURIComponent(itemId)}`, {
      method: "PATCH",
      body: patch,
      admin: false,
      token,
    }),
  bulkPatchClientItems: (token, body) =>
    request(`/api/client/p/${encodeURIComponent(token)}/items/bulk`, {
      method: "PATCH",
      body,
      admin: false,
      token,
    }),
  patchClientCooling: async (_token, _safetyFactor) => ({
    ok: false,
    code: "CLIENT_ENGINEERING_MUTATION_FORBIDDEN",
  }),
  proposeClientReplacement: (token, itemId, body) =>
    request(`/api/client/p/${encodeURIComponent(token)}/items/${encodeURIComponent(itemId)}/propose-replacement`, {
      method: "POST",
      body,
      admin: false,
      token,
    }),
  reviewReplacement: (projectId, itemId, body) =>
    request(`/api/projects/${projectId}/items/${encodeURIComponent(itemId)}/replacement-review`, { method: "POST", body }),

  getClients: () => request("/api/admin/clients"),
  patchClientProfile: (data) => request("/api/admin/clients/profile", { method: "PATCH", body: data }),
  getSuppliers: () => request("/api/suppliers"),
  createSupplier: (data) => request("/api/suppliers", { method: "POST", body: data }),
  updateSupplier: (id, patch) => request(`/api/suppliers/${id}`, { method: "PATCH", body: patch }),
  deleteSupplier: (id) => request(`/api/suppliers/${id}`, { method: "DELETE" }),
  getSuppliersLegacy: () => request("/api/admin/suppliers"),
  getModulesAdmin: () => request("/api/admin/modules"),
  createModule: (data) => request("/api/admin/modules", { method: "POST", body: data }),
  updateModule: (id, patch) => request(`/api/admin/modules/${id}`, { method: "PATCH", body: patch }),
  archiveModule: (id) => request(`/api/admin/modules/${id}/archive`, { method: "POST" }),
  restoreModule: (id) => request(`/api/admin/modules/${id}/restore`, { method: "POST" }),
  duplicateModule: (id) => request(`/api/admin/modules/${id}/duplicate`, { method: "POST" }),
  getPresets: () => request("/api/presets"),
  createPreset: (data) => request("/api/presets", { method: "POST", body: data }),
  updatePreset: (id, patch) => request(`/api/presets/${id}`, { method: "PATCH", body: patch }),
  deletePreset: (id) => request(`/api/presets/${id}`, { method: "DELETE" }),
  reorderPresets: (ids) => request("/api/presets/reorder", { method: "POST", body: { ids } }),
  getArchive: () => request("/api/admin/archive"),
  getSettings: () => request("/api/admin/settings"),
  exchangeMagicLink: async (token) => {
    const res = await fetch(`${API}/api/auth/magic-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: String(token || "") }),
      credentials: "include",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    if (data && typeof data === "object" && "token" in data) {
      const err = new Error("Invalid auth response");
      err.status = 500;
      throw err;
    }
    return data;
  },
  logoutAdmin: async () => {
    const res = await fetch(`${API}/api/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      credentials: "include",
    });
    clearAdminKey();
    if (!res.ok && res.status !== 404) {
      const data = await res.json().catch(() => ({}));
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return { ok: true };
  },
  saveSettings: (data) => request("/api/admin/settings", { method: "PATCH", body: data }),
  getStorageInventory: (params = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== "") q.set(k, String(v));
    }
    const qs = q.toString();
    return request(`/api/admin/storage/inventory${qs ? `?${qs}` : ""}`);
  },
  scanStorageInventory: (body = {}) =>
    request("/api/admin/storage/inventory/scan", { method: "POST", body }),
  getStorageInventoryFile: (assetPath) =>
    request(`/api/admin/storage/inventory/file?assetPath=${encodeURIComponent(assetPath)}`),
  previewStorageQuarantine: (body = {}) =>
    request("/api/admin/storage/quarantine/preview", { method: "POST", body }),
  executeStorageQuarantine: (body = {}) =>
    request("/api/admin/storage/quarantine", { method: "POST", body }),
  listStorageQuarantine: (params = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.set("status", params.status);
    if (params.page) q.set("page", String(params.page));
    if (params.pageSize) q.set("pageSize", String(params.pageSize));
    const qs = q.toString();
    return request(`/api/admin/storage/quarantine${qs ? `?${qs}` : ""}`);
  },
  restoreStorageQuarantine: (id) =>
    request(`/api/admin/storage/quarantine/${encodeURIComponent(id)}/restore`, { method: "POST", body: {} }),
  downloadBackup: () =>
    fetch(`${API}/api/admin/backup`, { headers: adminFetchHeaders(), credentials: "include" }).then(async (res) => {
      if (!res.ok) throw new Error("Backup failed");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `daogreen-backup-${new Date().toISOString().slice(0, 10)}.db`;
      a.click();
      URL.revokeObjectURL(a.href);
    }),
  getAnalytics: () => request("/api/admin/analytics"),
  getReportsR1: () => request("/api/admin/reports"),
  getAdminUsers: () => request("/api/admin/admin-users"),
  createAdminUser: (data) => request("/api/admin/admin-users", { method: "POST", body: { name: data?.name, active: data?.active } }),
  deleteAdminUser: (id) => request(`/api/admin/admin-users/${id}`, { method: "DELETE" }),
  revokeAllSessions: () => request("/api/admin/session/revoke-all", { method: "POST", body: {} }),
  logoutAdminSession: () =>
    fetch(`${API}/api/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: "{}",
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    }),
  getDuplicates: () => request("/api/materials/meta/duplicates"),
  mergeMaterials: (keepId, duplicateId) =>
    request("/api/materials/merge", { method: "POST", body: { keepId, duplicateId } }),
  getPriceHistory: (id) => request(`/api/materials/${id}/price-history`),
  getProjectActivity: (projectId) => request(`/api/projects/${projectId}/activity`),
  publishCheck: (projectId) => request(`/api/projects/${projectId}/publish-check`),
  getProjectDocuments: (projectId) => request(`/api/admin/projects/${projectId}/documents`),
  uploadProjectDocument: async (projectId, file, type) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("type", type || "other");
    const res = await fetch(`${API}/api/admin/projects/${projectId}/documents`, {
      method: "POST",
      headers: adminFetchHeaders(),
      body: fd,
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed");
    return data;
  },
  deleteDocument: (id) => request(`/api/admin/documents/${id}`, { method: "DELETE" }),
  /** Open authenticated admin file (blob) — private uploads are not on /uploads static. */
  openAdminFile: async (fileId, filename) => {
    const res = await fetch(`${API}/api/admin/files/${encodeURIComponent(fileId)}`, {
      headers: { "X-Admin-Key": getAdminKey() },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || data.message || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return { filename };
  },
  openFrameDrawingPdf: async (drawingId) => {
    const res = await fetch(`${API}/api/frame-drawings/${encodeURIComponent(drawingId)}/download`, {
      headers: { "X-Admin-Key": getAdminKey() },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || data.message || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
  getFrameDrawings: (params = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v) qs.set(k, v); });
    const q = qs.toString();
    return request(`/api/frame-drawings${q ? `?${q}` : ""}`);
  },
  getFrameDrawing: (id) => request(`/api/frame-drawings/${id}`),
  deleteFrameDrawing: (id) => request(`/api/frame-drawings/${id}`, { method: "DELETE" }),
  uploadFrameDrawing: async (payload, pdfBlob, filename, replace = false) => {
    const fd = new FormData();
    fd.append("file", pdfBlob, filename || "frame-drawing.pdf");
    const fieldMap = {
      projectId: "project_id",
      moduleId: "module_id",
      stellageId: "stellage_id",
      moduleRackKey: "module_rack_key",
      presetId: "preset_id",
      sourceType: "source_type",
      title: "title",
      rackType: "rack_type",
      drawingId: "drawing_id",
      pdfFilename: "pdf_filename",
      isClientVisible: "is_client_visible",
    };
    Object.entries(payload).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "") return;
      if (k === "frameConfigJson" && typeof v === "object") {
        fd.append("frame_config_json", JSON.stringify(v));
        return;
      }
      const key = fieldMap[k] || k;
      fd.append(key, typeof v === "boolean" ? String(v) : String(v));
    });
    if (replace) fd.append("replace", "true");
    const res = await fetch(`${API}/api/frame-drawings`, {
      method: "POST",
      headers: adminFetchHeaders(),
      body: fd,
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.message || data.error || "Upload failed");
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  },
  archiveProject: (id, expectedRevision) => request(`/api/projects/${id}/archive`, { method: "POST", body: { expectedRevision } }),
  restoreProject: (id, expectedRevision) => request(`/api/projects/${id}/restore`, { method: "POST", body: { expectedRevision: expectedRevision ?? projectRevisionCache.get(id) } }),
};

export function photoSrc(url) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  if (url.startsWith("/api/")) return `${API}${url}`;
  if (url.startsWith("/uploads/public/")) return `${API}${url}`;
  if (url.startsWith("/uploads/")) {
    return `${API}/api/media/image?url=${encodeURIComponent(url)}`;
  }
  return `${API}${url}`;
}

export function clientLink(token) {
  const basePath = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const publicBase = import.meta.env.VITE_PUBLIC_URL?.replace(/\/$/, "");
  const safeToken = encodeURIComponent(token);

  if (publicBase) {
    return `${publicBase}/client/p/${safeToken}`;
  }

  if (typeof window !== "undefined") {
    const { origin, pathname } = window.location;
    // Админка на /spec/… — клиентская ссылка всегда с тем же префиксом
    if (basePath && !pathname.startsWith(basePath)) {
      return `${origin}${basePath}/client/p/${safeToken}`;
    }
    return `${origin}${basePath}/client/p/${safeToken}`;
  }

  return `${basePath}/client/p/${safeToken}`;
}

/** Относительный путь для React Router (basename уже учтён) */
export function clientRoutePath(token) {
  return `/client/p/${encodeURIComponent(token)}`;
}
