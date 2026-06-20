const API = import.meta.env.VITE_API_URL || "";

const ADMIN_KEY_STORAGE = "daogreen-admin-key";

export function getAdminKey() {
  return localStorage.getItem(ADMIN_KEY_STORAGE) || import.meta.env.VITE_ADMIN_KEY || "daogreen-admin-change-me";
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
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
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
  duplicateProject: (id) => request(`/api/projects/${id}/duplicate`, { method: "POST" }),
  approveAll: (id) => request(`/api/projects/${id}/approve-all`, { method: "POST" }),
  createVersion: (id) => request(`/api/projects/${id}/versions`, { method: "POST" }),
  getVersions: (id) => request(`/api/projects/${id}/versions`),
  regenerateToken: (id) => request(`/api/projects/${id}/regenerate-token`, { method: "POST" }),
  patchItem: (projectId, itemId, patch) =>
    request(`/api/projects/${projectId}/items/${itemId}`, { method: "PATCH", body: patch }),
  addItem: (projectId, item) => request(`/api/projects/${projectId}/items`, { method: "POST", body: item }),
  deleteItem: (projectId, itemId) =>
    request(`/api/projects/${projectId}/items/${itemId}`, { method: "DELETE" }),

  getClientProject: (token) => request(`/api/client/p/${token}`, { admin: false }),
  patchClientItem: (token, itemId, patch) =>
    request(`/api/client/p/${token}/items/${itemId}`, { method: "PATCH", body: patch, admin: false }),

  getClients: () => request("/api/admin/clients"),
  getSuppliers: () => request("/api/admin/suppliers"),
  getModulesAdmin: () => request("/api/admin/modules"),
  getPresets: () => request("/api/presets"),
  createPreset: (data) => request("/api/presets", { method: "POST", body: data }),
  updatePreset: (id, patch) => request(`/api/presets/${id}`, { method: "PATCH", body: patch }),
  deletePreset: (id) => request(`/api/presets/${id}`, { method: "DELETE" }),
  reorderPresets: (ids) => request("/api/presets/reorder", { method: "POST", body: { ids } }),
  getArchive: () => request("/api/admin/archive"),
  getSettings: () => request("/api/admin/settings"),
  saveSettings: (data) => request("/api/admin/settings", { method: "PATCH", body: data }),
  archiveProject: (id) => request(`/api/projects/${id}/archive`, { method: "POST" }),
  restoreProject: (id) => request(`/api/projects/${id}/restore`, { method: "POST" }),
};

export function photoSrc(url) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  return `${API}${url}`;
}

export function clientLink(token) {
  return `${window.location.origin}/client/p/${token}`;
}
