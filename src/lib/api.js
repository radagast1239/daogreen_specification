const API = (import.meta.env.VITE_API_URL || import.meta.env.BASE_URL || "").replace(/\/$/, "");

const ADMIN_KEY_STORAGE = "daogreen-admin-key";

export function getAdminKey() {
  return localStorage.getItem(ADMIN_KEY_STORAGE) || "";
}

export function setAdminKey(key) {
  localStorage.setItem(ADMIN_KEY_STORAGE, key);
}

async function request(path, { method = "GET", body, admin = true, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (admin) headers["X-Admin-Key"] = getAdminKey();
  if (token) headers["X-Client-Token"] = token;

  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    if (data.problems) err.problems = data.problems;
    throw err;
  }
  return data;
}

export const api = {
  health: () => request("/api/health", { admin: false }),

  getMaterials: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/api/materials${q ? `?${q}` : ""}`);
  },
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
      headers: { "X-Admin-Key": getAdminKey() },
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Import failed");
    return data;
  },
  uploadPhoto: async (file) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${API}/api/materials/upload-photo`, {
      method: "POST",
      headers: { "X-Admin-Key": getAdminKey() },
      body: fd,
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
      headers: { "X-Admin-Key": getAdminKey() },
      body: fd,
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
      headers: { "X-Admin-Key": getAdminKey() },
      body: fd,
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
  approveAll: (id) => request(`/api/projects/${id}/approve-all`, { method: "POST" }),
  createVersion: (id, body) => request(`/api/projects/${id}/versions`, { method: "POST", body: body || {} }),
  getVersions: (id) => request(`/api/projects/${id}/versions`),
  regenerateToken: (id) => request(`/api/projects/${id}/regenerate-token`, { method: "POST" }),
  patchItem: (projectId, itemId, patch) =>
    request(`/api/projects/${projectId}/items/${itemId}`, { method: "PATCH", body: patch }),
  refreshItemsFromMaterial: (projectId, body) =>
    request(`/api/projects/${projectId}/items/refresh-from-material`, { method: "POST", body }),
  bulkPatchItems: (projectId, body) =>
    request(`/api/projects/${projectId}/items/bulk-patch`, { method: "POST", body }),
  addItem: (projectId, item) => request(`/api/projects/${projectId}/items`, { method: "POST", body: item }),
  deleteItem: (projectId, itemId) =>
    request(`/api/projects/${projectId}/items/${itemId}`, { method: "DELETE" }),

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
  patchClientCooling: (token, safetyFactor) =>
    request(`/api/client/p/${encodeURIComponent(token)}/cooling`, {
      method: "PATCH",
      body: { safetyFactor },
      admin: false,
      token,
    }),
  proposeClientReplacement: (token, itemId, body) =>
    request(`/api/client/p/${encodeURIComponent(token)}/items/${encodeURIComponent(itemId)}/propose-replacement`, {
      method: "POST",
      body,
      admin: false,
      token,
    }),
  reviewReplacement: (projectId, itemId, body) =>
    request(`/api/projects/${projectId}/items/${itemId}/replacement-review`, { method: "POST", body }),

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
  saveSettings: (data) => request("/api/admin/settings", { method: "PATCH", body: data }),
  downloadBackup: () =>
    fetch(`${API}/api/admin/backup`, { headers: { "X-Admin-Key": getAdminKey() } }).then(async (res) => {
      if (!res.ok) throw new Error("Backup failed");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `daogreen-backup-${new Date().toISOString().slice(0, 10)}.db`;
      a.click();
      URL.revokeObjectURL(a.href);
    }),
  getAnalytics: () => request("/api/admin/analytics"),
  getAdminUsers: () => request("/api/admin/admin-users"),
  createAdminUser: (data) => request("/api/admin/admin-users", { method: "POST", body: data }),
  deleteAdminUser: (id) => request(`/api/admin/admin-users/${id}`, { method: "DELETE" }),
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
      headers: { "X-Admin-Key": getAdminKey() },
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed");
    return data;
  },
  deleteDocument: (id) => request(`/api/admin/documents/${id}`, { method: "DELETE" }),
  archiveProject: (id) => request(`/api/projects/${id}/archive`, { method: "POST" }),
  restoreProject: (id) => request(`/api/projects/${id}/restore`, { method: "POST" }),
};

export function photoSrc(url) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
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
