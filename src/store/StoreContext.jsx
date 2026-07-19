import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { buildReferenceData } from "../lib/referenceData.js";
import { applyClientSectionsFromSettings } from "../lib/clientSectionsConfig.js";
import { buildItemsFromModules } from "../lib/apiHelpers.js";
import { api as apiClient, getCachedProjectRevision } from "../lib/api.js";
import {
  reconcileItemClientVisibilityFlags,
  reconcileProjectItemsVisibility,
  applyClientVisibilityPatch,
} from "../../shared/itemTypes.js";
import { createItemPatchQueue } from "./itemPatchQueue.js";
import { Modal } from "../components/ui.jsx";
import { reconcileItemCatalogFields } from "../../shared/itemTypes.js";

export { buildItemsFromModules };

const StoreContext = createContext(null);

function reconcileStoredItem(item, materials = []) {
  const material = item?.materialId
    ? materials.find((m) => m.id === item.materialId)
    : null;
  return reconcileItemClientVisibilityFlags(reconcileItemCatalogFields(item, material), material);
}

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
                updatedAt: action.updatedAt === undefined ? p.updatedAt : action.updatedAt,
                items: p.items.map((it) =>
                  it.id === action.itemId
                    ? reconcileStoredItem({ ...it, ...action.item }, state.materials)
                    : it
                ),
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
    case "PROJECT_ITEMS_VISIBILITY_PATCH": {
      const idSet = new Set(action.itemIds || []);
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id !== action.projectId
            ? p
            : {
                ...p,
                items: p.items.map((it) =>
                  idSet.has(it.id)
                    ? applyClientVisibilityPatch(it, action.patch)
                    : it
                ),
              }
        ),
      };
    }
    case "PROJECT_ENSURE": {
      const project = reconcileProjectItemsVisibility(action.project, state.materials);
      return state.projects.some((p) => p.id === project.id)
        ? {
            ...state,
            projects: state.projects.map((p) => (p.id === project.id ? project : p)),
          }
        : { ...state, projects: [project, ...state.projects] };
    }
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
  const stateRef = useRef(state);
  stateRef.current = state;
  const revisionRef = useRef(new Map());
  const projectWriteTailsRef = useRef(new Map());
  const [revisionConflict, setRevisionConflict] = useState(null);
  const [, tick] = useState(0);
  const materialsInflight = useRef(null);
  const modulesInflight = useRef(null);
  const itemPatchQueueRef = useRef(null);

  const currentProjectRevision = useCallback((projectId) => {
    const fromRef = revisionRef.current.has(projectId) ? Number(revisionRef.current.get(projectId)) : 0;
    const fromCache = Number(getCachedProjectRevision(projectId)) || 0;
    const fromState = Number(stateRef.current.projects.find((project) => project.id === projectId)?.revision) || 0;
    return Math.max(fromRef, fromCache, fromState, 1);
  }, []);

  const noteRevisionConflict = useCallback((error, projectId) => {
    if (error?.code !== "PROJECT_REVISION_CONFLICT") return false;
    setRevisionConflict({
      projectId: projectId || error.projectId,
      expectedRevision: error.expectedRevision,
      currentRevision: error.currentRevision,
      scope: "admin",
    });
    return true;
  }, []);

  const runProjectWrite = useCallback((projectId, sender) => {
    const previous = projectWriteTailsRef.current.get(projectId) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const expectedRevision = currentProjectRevision(projectId);
      try {
        const result = await sender(expectedRevision);
        const revision = Number(result?.revision);
        if (revision > 0) revisionRef.current.set(projectId, revision);
        return result;
      } catch (error) {
        noteRevisionConflict(error, projectId);
        throw error;
      }
    });
    projectWriteTailsRef.current.set(projectId, next);
    next.finally(() => {
      if (projectWriteTailsRef.current.get(projectId) === next) projectWriteTailsRef.current.delete(projectId);
    }).catch(() => {});
    return next;
  }, [currentProjectRevision, noteRevisionConflict]);

  if (!itemPatchQueueRef.current) {
    itemPatchQueueRef.current = createItemPatchQueue({
      send: ({ projectId, itemId, patch }) => runProjectWrite(projectId, (expectedRevision) =>
        apiClient.patchItem(projectId, itemId, patch, expectedRevision)
      ),
      onOptimistic: ({ projectId, itemId, patch }) => {
        dispatch({ type: "PROJECT_ITEM_UPDATE", projectId, itemId, item: patch });
      },
      onSettled: (item, { projectId, itemId }) => {
        dispatch({ type: "PROJECT_ITEM_UPDATE", projectId, itemId, item });
      },
      onLatestError: (_error, { projectId, itemId }, _revision, lastConfirmed) => {
        // Do not reload the project after a transient save failure: a stale snapshot
        // could overwrite a qty already confirmed by an earlier queued PATCH.
        if (lastConfirmed) {
          dispatch({ type: "PROJECT_ITEM_UPDATE", projectId, itemId, item: lastConfirmed });
        }
      },
    });
  }

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
        revisionRef.current.set(p.id, Number(p.revision) || 1);
        dispatch({ type: "PROJECT_PREPEND", project: p });
        return p;
      },
      async projectUpdate(id, patch) {
        const p = await runProjectWrite(id, (expectedRevision) =>
          apiClient.updateProject(id, { ...patch, expectedRevision })
        );
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
        const p = await runProjectWrite(id, (expectedRevision) => apiClient.approveAll(id, expectedRevision));
        dispatch({ type: "PROJECT_SET", project: p });
        return p;
      },
      async createVersion(id, opts = {}) {
        try {
          return await runProjectWrite(id, (expectedRevision) => apiClient.createVersion(id, opts, expectedRevision));
        } catch (e) {
          const err = new Error(e.message);
          if (e.problems) err.problems = e.problems;
          throw err;
        }
      },
      async regenerateToken(id) {
        const { clientToken } = await runProjectWrite(id, (expectedRevision) => apiClient.regenerateToken(id, expectedRevision));
        dispatch({ type: "PROJECT_TOKEN", id, clientToken });
        return clientToken;
      },
      async archiveProject(id) {
        await runProjectWrite(id, (expectedRevision) => apiClient.archiveProject(id, expectedRevision));
        dispatch({ type: "PROJECT_REMOVE", id });
      },
      async itemUpdate(projectId, itemId, patch) {
        return itemPatchQueueRef.current(`${projectId}:${itemId}`, { projectId, itemId, patch });
      },
      async itemAdd(projectId, item) {
        const created = await runProjectWrite(projectId, (expectedRevision) => apiClient.addItem(projectId, item, expectedRevision));
        dispatch({ type: "PROJECT_ITEM_ADD", projectId, item: created });
        return created;
      },
      async itemDelete(projectId, itemId) {
        await runProjectWrite(projectId, (expectedRevision) => apiClient.deleteItem(projectId, itemId, expectedRevision));
        dispatch({ type: "PROJECT_ITEM_REMOVE", projectId, itemId });
      },
      async importExcel(file, opts) {
        const result = await apiClient.importExcel(file, opts);
        await refreshMaterials();
        return result;
      },
      async loadProject(id) {
        const p = await apiClient.getProject(id);
        revisionRef.current.set(id, Number(p.revision) || 1);
        dispatch({ type: "PROJECT_ENSURE", project: p });
        return p;
      },
      applyItemsVisibilityPatch(projectId, itemIds, patch) {
        dispatch({ type: "PROJECT_ITEMS_VISIBILITY_PATCH", projectId, itemIds, patch });
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
      async bulkPatchItems(projectId, body) {
        return runProjectWrite(projectId, (expectedRevision) =>
          apiClient.bulkPatchItems(projectId, { ...body, expectedRevision })
        );
      },
      async refreshItemsFromMaterial(projectId, body, context) {
        const result = await runProjectWrite(projectId, (expectedRevision) =>
          apiClient.refreshItemsFromMaterial(projectId, { ...body, expectedRevision }, context)
        );
        for (const it of result?.updated || []) {
          dispatch({ type: "PROJECT_ITEM_UPDATE", projectId, itemId: it.id, item: it });
        }
        return result;
      },
      async applySectionTemplate(projectId, body) {
        return runProjectWrite(projectId, (expectedRevision) =>
          apiClient.applySectionTemplate(projectId, { ...body, expectedRevision })
        );
      },
      async importFromProject(projectId, body) {
        return runProjectWrite(projectId, (expectedRevision) =>
          apiClient.importFromProject(projectId, { ...body, expectedRevision })
        );
      },
      async reviewReplacement(projectId, itemId, body) {
        return runProjectWrite(projectId, (expectedRevision) =>
          apiClient.reviewReplacement(projectId, itemId, { ...body, expectedRevision })
        );
      },
      noteRevisionConflict,
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
      runProjectWrite,
      noteRevisionConflict,
    ]
  );

  const value = useMemo(() => ({ state, dispatch, actions }), [state, actions]);
  const loadCurrentProject = async () => {
    const projectId = revisionConflict?.projectId;
    if (!projectId) return;
    const project = await apiClient.getProject(projectId);
    revisionRef.current.set(projectId, Number(project.revision) || 1);
    dispatch({ type: "PROJECT_ENSURE", project });
    setRevisionConflict(null);
  };
  return (
    <StoreContext.Provider value={value}>
      {children}
      {revisionConflict && (
        <Modal
          title="Конфликт изменений проекта"
          onClose={() => setRevisionConflict(null)}
          footer={<>
            <button type="button" className="btn" onClick={() => setRevisionConflict(null)}>Остаться и скопировать свои изменения</button>
            <button type="button" className="btn btn-primary" onClick={loadCurrentProject}>Загрузить актуальную версию</button>
          </>}
        >
          <p>Проект изменён в другой вкладке. Ваши изменения не сохранены поверх новой версии.</p>
          <p className="muted">Серверная версия: {revisionConflict.currentRevision}; версия этой вкладки: {revisionConflict.expectedRevision}.</p>
        </Modal>
      )}
    </StoreContext.Provider>
  );
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
