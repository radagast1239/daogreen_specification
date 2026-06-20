import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState } from "react";
import { buildItemsFromModules } from "../lib/apiHelpers.js";
import { api as apiClient } from "../lib/api.js";

export { buildItemsFromModules };

const StoreContext = createContext(null);

function reducer(state, action) {
  switch (action.type) {
    case "HYDRATE":
      return { ...state, ...action.payload, ready: true };
    case "SET_LOADING":
      return { ...state, loading: action.loading };
    case "SET_ERROR":
      return { ...state, error: action.error };
    case "MATERIALS_SET":
      return { ...state, materials: action.materials };
    case "MODULES_SET":
      return { ...state, modules: action.modules };
    case "PROJECTS_SET":
      return { ...state, projects: action.projects };
    case "PROJECT_SET":
      return {
        ...state,
        projects: state.projects.map((p) => (p.id === action.project.id ? action.project : p)),
      };
    case "DASHBOARD_SET":
      return { ...state, dashboard: action.dashboard };
    default:
      return state;
  }
}

const initial = {
  ready: false,
  loading: true,
  error: null,
  materials: [],
  modules: [],
  projects: [],
  dashboard: null,
};

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const [, tick] = useState(0);

  const refresh = useCallback(async () => {
    dispatch({ type: "SET_LOADING", loading: true });
    dispatch({ type: "SET_ERROR", error: null });
    try {
      const [materials, modules, projects, dashboard] = await Promise.all([
        apiClient.getMaterials(),
        apiClient.getModules(),
        apiClient.getProjects(),
        apiClient.getDashboard(),
      ]);
      dispatch({
        type: "HYDRATE",
        payload: { materials, modules, projects, dashboard, loading: false },
      });
    } catch (e) {
      dispatch({ type: "SET_ERROR", error: e.message });
      dispatch({ type: "SET_LOADING", loading: false });
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.pathname.startsWith("/client/")) {
      dispatch({ type: "HYDRATE", payload: { loading: false, ready: true } });
      return;
    }
    refresh();
  }, [refresh]);

  const actions = useMemo(
    () => ({
      refresh,
      async materialAdd(material) {
        const m = await apiClient.createMaterial(material);
        dispatch({ type: "MATERIALS_SET", materials: [...state.materials, m] });
        return m;
      },
      async materialUpdate(id, patch) {
        const m = await apiClient.updateMaterial(id, patch);
        dispatch({
          type: "MATERIALS_SET",
          materials: state.materials.map((x) => (x.id === id ? m : x)),
        });
        return m;
      },
      async materialDelete(id) {
        await apiClient.deleteMaterial(id);
        dispatch({
          type: "MATERIALS_SET",
          materials: state.materials.filter((x) => x.id !== id),
        });
      },
      async projectCreate(data) {
        const p = await apiClient.createProject(data);
        dispatch({ type: "PROJECTS_SET", projects: [p, ...state.projects] });
        return p;
      },
      async projectUpdate(id, patch) {
        const p = await apiClient.updateProject(id, patch);
        dispatch({ type: "PROJECT_SET", project: p });
        return p;
      },
      async projectDelete(id) {
        await apiClient.deleteProject(id);
        dispatch({
          type: "PROJECTS_SET",
          projects: state.projects.filter((p) => p.id !== id),
        });
      },
      async projectDuplicate(id) {
        const p = await apiClient.duplicateProject(id);
        dispatch({ type: "PROJECTS_SET", projects: [p, ...state.projects] });
        return p;
      },
      async approveAll(id) {
        const p = await apiClient.approveAll(id);
        dispatch({ type: "PROJECT_SET", project: p });
        return p;
      },
      async createVersion(id, opts = {}) {
        try {
          return await apiClient.createVersion(id, opts);
        } catch (e) {
          const err = new Error(e.message);
          if (e.problems) err.problems = e.problems;
          throw err;
        }
      },
      async regenerateToken(id) {
        const { clientToken } = await apiClient.regenerateToken(id);
        const p = state.projects.find((x) => x.id === id);
        if (p) dispatch({ type: "PROJECT_SET", project: { ...p, clientToken } });
        return clientToken;
      },
      async archiveProject(id) {
        await apiClient.archiveProject(id);
        dispatch({ type: "PROJECTS_SET", projects: state.projects.filter((p) => p.id !== id) });
      },
      async itemUpdate(projectId, itemId, patch) {
        const item = await apiClient.patchItem(projectId, itemId, patch);
        const p = state.projects.find((x) => x.id === projectId);
        if (p) {
          dispatch({
            type: "PROJECT_SET",
            project: { ...p, items: p.items.map((it) => (it.id === itemId ? { ...it, ...item } : it)) },
          });
        }
        return item;
      },
      async itemAdd(projectId, item) {
        const created = await apiClient.addItem(projectId, item);
        const p = state.projects.find((x) => x.id === projectId);
        if (p) dispatch({ type: "PROJECT_SET", project: { ...p, items: [...p.items, created] } });
        return created;
      },
      async itemDelete(projectId, itemId) {
        await apiClient.deleteItem(projectId, itemId);
        const p = state.projects.find((x) => x.id === projectId);
        if (p)
          dispatch({
            type: "PROJECT_SET",
            project: { ...p, items: p.items.filter((it) => it.id !== itemId) },
          });
      },
      async importExcel(file, opts) {
        const result = await apiClient.importExcel(file, opts);
        await refresh();
        return result;
      },
      async loadProject(id) {
        const p = await apiClient.getProject(id);
        dispatch({ type: "PROJECT_SET", project: p });
        const exists = state.projects.some((x) => x.id === id);
        if (!exists) dispatch({ type: "PROJECTS_SET", projects: [p, ...state.projects] });
        return p;
      },
      // client-side (no admin key)
      async clientPatchItem(token, itemId, patch) {
        return apiClient.patchClientItem(token, itemId, patch);
      },
      async loadClientProject(token) {
        return apiClient.getClientProject(token);
      },
      async clientPatchCooling(token, safetyFactor) {
        return apiClient.patchClientCooling(token, safetyFactor);
      },
      rerender: () => tick((n) => n + 1),
    }),
    [refresh, state.materials, state.projects]
  );

  const value = useMemo(() => ({ state, dispatch, actions }), [state, actions]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}

// legacy dispatch shim for gradual migration
export function useDispatch() {
  const { state, actions } = useStore();
  return async (action) => {
    switch (action.type) {
      case "MATERIAL_ADD":
        return actions.materialAdd(action.material);
      case "MATERIAL_UPDATE":
        return actions.materialUpdate(action.id, action.patch);
      case "MATERIAL_DELETE":
        return actions.materialDelete(action.id);
      case "PROJECT_CREATE":
        return actions.projectCreate(action.project);
      case "PROJECT_UPDATE":
        return actions.projectUpdate(action.id, action.patch);
      case "PROJECT_DELETE":
        return actions.projectDelete(action.id);
      case "PROJECT_DUPLICATE":
        return actions.projectDuplicate(action.id);
      case "ITEM_UPDATE":
        return actions.itemUpdate(action.projectId, action.itemId, action.patch);
      case "ITEM_ADD":
        return actions.itemAdd(action.projectId, action.item);
      case "ITEM_DELETE":
        return actions.itemDelete(action.projectId, action.itemId);
      default:
        break;
    }
  };
}
