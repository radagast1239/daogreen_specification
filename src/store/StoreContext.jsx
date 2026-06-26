import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { buildReferenceData } from "../lib/referenceData.js";
import { applyClientSectionsFromSettings } from "../lib/clientSectionsConfig.js";
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
      return { ...state, materials: action.materials, materialsLoaded: true };
    case "MODULES_SET":
      return { ...state, modules: action.modules, modulesLoaded: true };
    case "PROJECTS_SET":
      return { ...state, projects: action.projects };
    case "PROJECT_SET":
      return {
        ...state,
        projects: state.projects.map((p) => (p.id === action.project.id ? action.project : p)),
      };
    case "DASHBOARD_SET":
      return { ...state, dashboard: action.dashboard };
    case "SETTINGS_SET":
      return {
        ...state,
        settings: action.settings,
        reference: action.reference,
      };
    case "MATERIAL_ADD":
      return { ...state, materials: [...state.materials, action.material], materialsLoaded: true };
    case "MATERIAL_UPDATE_ONE":
      return {
        ...state,
        materials: state.materials.map((x) => (x.id === action.id ? action.material : x)),
      };
    case "MATERIAL_REMOVE":
      return { ...state, materials: state.materials.filter((x) => x.id !== action.id) };
    case "PROJECT_PREPEND":
      return { ...state, projects: [action.project, ...state.projects] };
    case "PROJECT_REMOVE":
      return { ...state, projects: state.projects.filter((p) => p.id !== action.id) };
    case "PROJECT_TOKEN":
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.id ? { ...p, clientToken: action.clientToken } : p
        ),
      };
    case "PROJECT_ITEM_UPDATE":
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.projectId
            ? {
                ...p,
                updatedAt: action.updatedAt || new Date().toISOString(),
                items: p.items.map((it) => (it.id === action.itemId ? { ...it, ...action.item } : it)),
              }
            : p
        ),
      };
    case "PROJECT_ITEM_ADD":
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.projectId ? { ...p, items: [...p.items, action.item] } : p
        ),
      };
    case "PROJECT_ITEM_REMOVE":
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.projectId
            ? { ...p, items: p.items.filter((it) => it.id !== action.itemId) }
            : p
        ),
      };
    case "PROJECT_ENSURE":
      return state.projects.some((p) => p.id === action.project.id)
        ? {
            ...state,
            projects: state.projects.map((p) => (p.id === action.project.id ? action.project : p)),
          }
        : { ...state, projects: [action.project, ...state.projects] };
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
  materialsLoaded: false,
  modulesLoaded: false,
  projects: [],
  dashboard: null,
  settings: {},
  reference: buildReferenceData({}),
};

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const [, tick] = useState(0);
  const materialsInflight = useRef(null);
  const modulesInflight = useRef(null);

  const refreshSettings = useCallback(async () => {
    const settings = await apiClient.getSettings();
    const reference = buildReferenceData(settings);
    applyClientSectionsFromSettings(settings);
    dispatch({ type: "SETTINGS_SET", settings, reference });
    return settings;
  }, []);

  const refreshMaterials = useCallback(async () => {
    const materials = await apiClient.getMaterials();
    dispatch({ type: "MATERIALS_SET", materials });
    return materials;
  }, []);

  const refreshModules = useCallback(async () => {
    const modules = await apiClient.getModules();
    dispatch({ type: "MODULES_SET", modules });
    return modules;
  }, []);

  const ensureMaterials = useCallback(async () => {
    if (state.materialsLoaded) return state.materials;
    if (!materialsInflight.current) {
      materialsInflight.current = refreshMaterials().finally(() => {
        materialsInflight.current = null;
      });
    }
    return materialsInflight.current;
  }, [state.materialsLoaded, state.materials, refreshMaterials]);

  const ensureModules = useCallback(async () => {
    if (state.modulesLoaded) return state.modules;
    if (!modulesInflight.current) {
      modulesInflight.current = refreshModules().finally(() => {
        modulesInflight.current = null;
      });
    }
    return modulesInflight.current;
  }, [state.modulesLoaded, state.modules, refreshModules]);

  const refreshProjects = useCallback(async () => {
    const projects = await apiClient.getProjects();
    dispatch({ type: "PROJECTS_SET", projects });
    return projects;
  }, []);

  const refreshDashboard = useCallback(async () => {
    const dashboard = await apiClient.getDashboard();
    dispatch({ type: "DASHBOARD_SET", dashboard });
    return dashboard;
  }, []);

  const refreshCore = useCallback(async ({ silent = false, full = false } = {}) => {
    if (!silent) {
      dispatch({ type: "SET_LOADING", loading: true });
      dispatch({ type: "SET_ERROR", error: null });
    }
    try {
      if (full) {
        const [materials, modules, projects, settings] = await Promise.all([
          apiClient.getMaterials(),
          apiClient.getModules(),
          apiClient.getProjects(),
          apiClient.getSettings(),
        ]);
        const reference = buildReferenceData(settings);
        applyClientSectionsFromSettings(settings);
        dispatch({
          type: "HYDRATE",
          payload: {
            materials,
            modules,
            projects,
            settings,
            reference,
            materialsLoaded: true,
            modulesLoaded: true,
            loading: false,
          },
        });
      } else {
        const [projects, settings] = await Promise.all([
          apiClient.getProjects(),
          apiClient.getSettings(),
        ]);
        const reference = buildReferenceData(settings);
        applyClientSectionsFromSettings(settings);
        dispatch({
          type: "HYDRATE",
          payload: { projects, settings, reference, loading: false },
        });
      }
    } catch (e) {
      dispatch({ type: "SET_ERROR", error: e.message });
      dispatch({ type: "SET_LOADING", loading: false });
    }
  }, []);

  const refresh = useCallback(() => refreshCore({ full: true }), [refreshCore]);

  useEffect(() => {
    if (typeof window !== "undefined" && /\/client(\/p)?\//.test(window.location.pathname)) {
      dispatch({ type: "HYDRATE", payload: { loading: false, ready: true, error: null } });
      return;
    }
    refreshCore();
  }, [refreshCore]);

  const actions = useMemo(
    () => ({
      refresh,
      refreshCore,
      ensureMaterials,
      ensureModules,
      refreshSettings,
      refreshMaterials,
      refreshModules,
      refreshProjects,
      refreshDashboard,
      async materialAdd(material) {
        const m = await apiClient.createMaterial(material);
        dispatch({ type: "MATERIAL_ADD", material: m });
        return m;
      },
      async materialUpdate(id, patch) {
        const m = await apiClient.updateMaterial(id, patch);
        dispatch({ type: "MATERIAL_UPDATE_ONE", id, material: m });
        return m;
      },
      async materialDelete(id) {
        await apiClient.deleteMaterial(id);
        dispatch({ type: "MATERIAL_REMOVE", id });
      },
      async projectCreate(data) {
        const p = await apiClient.createProject(data);
        dispatch({ type: "PROJECT_PREPEND", project: p });
        return p;
      },
      async projectUpdate(id, patch) {
        const p = await apiClient.updateProject(id, patch);
        dispatch({ type: "PROJECT_SET", project: p });
        return p;
      },
      async projectDelete(id) {
        await apiClient.deleteProject(id);
        dispatch({ type: "PROJECT_REMOVE", id });
      },
      async projectDuplicate(id, body = {}) {
        const p = await apiClient.duplicateProject(id, body);
        dispatch({ type: "PROJECT_PREPEND", project: p });
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
        dispatch({ type: "PROJECT_TOKEN", id, clientToken });
        return clientToken;
      },
      async archiveProject(id) {
        await apiClient.archiveProject(id);
        dispatch({ type: "PROJECT_REMOVE", id });
      },
      async itemUpdate(projectId, itemId, patch) {
        const item = await apiClient.patchItem(projectId, itemId, patch);
        dispatch({ type: "PROJECT_ITEM_UPDATE", projectId, itemId, item });
        return item;
      },
      async itemAdd(projectId, item) {
        const created = await apiClient.addItem(projectId, item);
        dispatch({ type: "PROJECT_ITEM_ADD", projectId, item: created });
        return created;
      },
      async itemDelete(projectId, itemId) {
        await apiClient.deleteItem(projectId, itemId);
        dispatch({ type: "PROJECT_ITEM_REMOVE", projectId, itemId });
      },
      async importExcel(file, opts) {
        const result = await apiClient.importExcel(file, opts);
        await refreshMaterials();
        return result;
      },
      async loadProject(id) {
        const p = await apiClient.getProject(id);
        dispatch({ type: "PROJECT_ENSURE", project: p });
        return p;
      },
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
    [
      refresh,
      refreshCore,
      ensureMaterials,
      ensureModules,
      refreshSettings,
      refreshMaterials,
      refreshModules,
      refreshProjects,
      refreshDashboard,
    ]
  );

  const value = useMemo(() => ({ state, dispatch, actions }), [state, actions]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}

export function useReference() {
  return useStore().state.reference;
}

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
