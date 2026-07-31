import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useStore } from "../../store/StoreContext.jsx";
import { PageHeader } from "../../components/Layout.jsx";
import { useToast } from "../../components/Toast.jsx";
import { api } from "../../lib/api.js";
import SpecPickerTable, { countIncluded } from "../../components/SpecPickerTable.jsx";
import { resolveCategories } from "../../lib/categories.js";
import { DEFAULT_MANUAL_PARAMS } from "../../lib/itemHelpers.js";
import ProjectCurrencyFields, { applyCurrencyDescToForm } from "../../components/ProjectCurrencyFields.jsx";
import { DEFAULT_PROJECT_CURRENCY } from "../../../shared/projectCurrency.js";
import BuilderStellageFrameDrawingRow from "../../components/BuilderStellageFrameDrawingRow.jsx";
import {
  DRAFT_PROJECT_FRAME_DRAWING_SECTION_HINT,
  buildFrameDrawingLink,
  buildBuilderFrameDrawingContext,
} from "../../../shared/frameDrawingContext.js";
import { frameBomItemsForModuleRack, stripResidualFrameBomTwins, stripSameNameFrameBomBuilderTwins, syncProjectItemStellageLabels } from "../../../shared/frameBomProjectItems.js";
import { buildProjectItemsAfterBuilderSave } from "../../../shared/buildProjectItemsAfterBuilderSave.js";
import { buildModuleRackKey } from "../../../shared/moduleRackIds.js";
import {
  PROJECT_STATUS_ACTIVE,
  PROJECT_STATUS_DRAFT,
  buildBuilderDraftPath,
  isDraftProject,
  mergeBuilderWizardParams,
  parseBuilderSearchParams,
} from "../../../shared/projectLifecycle.js";
import {
  PROJECT_KIND,
  PROJECT_KIND_OPTIONS,
  suggestProjectName,
  canSubmitNewProject,
  validateNewProjectForm,
  createProjectSubmitGuard,
  shouldUpdateDraftOnStepChange,
  getProjectKindLabel,
  resolveProjectKind,
} from "../../../shared/projectCreation.js";
import { getProjectStatusLabel } from "../../../shared/projectStatus.js";
import {
  findStellageByEditRack,
  hydrateBuilderFromProject,
  mergeStellageBuilderLines,
  preserveFrameBomProjectItems,
  mergeFrameBomQtyFromBuilderLines,
  stellagesForProjectSave,
  isMeaningfulRackDraft,
  validateStellageForFrameDrawing,
} from "../../lib/projectBuilderHydrate.js";

import {
  filterSectionsForFarmType,
  GROUP_LABEL,
  parseFarmSectionCatalogs,
  projectLinesFromCatalog,
  resolveFarmSections,
} from "../../lib/farmSectionsConfig.js";
import {
  activeLines,
  buildProjectFromBuilder,
  catalogLinesForModule,
  newStellageDraft,
} from "../../lib/projectBuilder.js";
import { resolveBuilderLineQty } from "../../../shared/flowSpecs.js";
import { parseStellageModuleCatalogs, parseStellageModuleMeta, projectStellageLinesFromCatalog, resolveStellagePhoto, stellageModulePhoto } from "../../lib/stellageCatalogConfig.js";
import StellagePhotoField, { StellagePhotoThumb } from "../../components/StellagePhotoField.jsx";
import {
  draftFromStellagePreset,
  duplicateStellageInstance,
  emptyFarmSectionsState,
  presetPayloadFromDraft,
} from "../../lib/presetHelpers.js";
import { formatStellageParamsSummary } from "../../lib/stellagePresetParams.js";
import CoolingFarmTab from "../../components/CoolingFarmTab.jsx";
import RoomCoolingEditor from "../../components/RoomCoolingEditor.jsx";
import CompactTableToggle from "../../components/CompactTableToggle.jsx";
import RoomsEditor from "../../components/RoomsEditor.jsx";
import FloorPlanPin from "../../components/FloorPlanPin.jsx";
import ClientSchemesEditor from "../../components/ClientSchemesEditor.jsx";
import RackImagesEditor from "../../components/RackImagesEditor.jsx";
import FarmPowerEditor from "../../components/FarmPowerEditor.jsx";
import { listUploadedSchemes } from "../../lib/clientSchemes.js";
import { COOLING_FARM_DEFAULTS, computeCoolingFarm } from "../../lib/coolingFarmCalc.js";
import { newRoom } from "../../lib/roomHelpers.js";
import {
  applyAndSelectNextRoom,
  applyCoolingCalcToRoom,
  clearRoomCooling,
} from "../../../shared/roomCoolingWorkflow.js";
import { enrichRooms } from "../../../shared/roomCoolingCalc.js";

const FARM_COLUMN_PREFS_KEY = "dg.specPicker.farmColumns";

function loadFarmColumnHidden() {
  try {
    const raw = localStorage.getItem(FARM_COLUMN_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return {
      category: !!parsed?.category,
      supplier: !!parsed?.supplier,
      unit: !!parsed?.unit,
    };
  } catch {
    return {};
  }
}

const STEPS = [
  { id: "basics", label: "1. Проект" },
  { id: "stellages", label: "2. Стеллажи" },
  { id: "general", label: "3. Ферма целиком" },
  { id: "cooling", label: "4. Расчёт охлаждения" },
  { id: "consumables", label: "5. Расходные материалы" },
  { id: "review", label: "6. Создание" },
];

export default function ProjectBuilderPage() {
  const { state, actions } = useStore();
  const ref = state.reference;
  const { confirm, success, error } = useToast();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const savedProjectIdFromUrl = String(searchParams.get("projectId") || "").trim();
  const builderUrl = parseBuilderSearchParams(searchParams);
  const createGuardRef = useRef(null);
  if (!createGuardRef.current) createGuardRef.current = createProjectSubmitGuard();
  const draftGuardRef = useRef(null);
  if (!draftGuardRef.current) draftGuardRef.current = createProjectSubmitGuard();

  const [step, setStep] = useState(() => {
    const fromUrl = searchParams.get("step");
    return STEPS.some((s) => s.id === fromUrl) ? fromUrl : "basics";
  });
  const [saving, setSaving] = useState(false);
  const [frameSchemeSaving, setFrameSchemeSaving] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [projectLoading, setProjectLoading] = useState(false);
  const [loadedProjectId, setLoadedProjectId] = useState(savedProjectIdFromUrl);
  const [loadedProject, setLoadedProject] = useState(null);
  const [pendingEditRack, setPendingEditRack] = useState(() => String(searchParams.get("editRack") || "").trim());
  const editingFinishedProject = Boolean(loadedProject && !isDraftProject(loadedProject));
  // mode=edit (or hydrated finished project) must not behave like a draft session.
  const isDraftSession =
    !editingFinishedProject &&
    (!loadedProjectId || isDraftProject(loadedProject) || builderUrl.mode === "draft");
  const isEditMode = Boolean(loadedProjectId);
  const [presets, setPresets] = useState([]);
  const [farmCatalogs, setFarmCatalogs] = useState({});
  const [stellageCatalogs, setStellageCatalogs] = useState({});
  const [stellageModuleMeta, setStellageModuleMeta] = useState({});
  const [farmSettings, setFarmSettings] = useState(null);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [farmHiddenColumns, setFarmHiddenColumns] = useState(loadFarmColumnHidden);
  const [nameTouched, setNameTouched] = useState(false);

  const toggleFarmColumn = (key) => {
    setFarmHiddenColumns((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(FARM_COLUMN_PREFS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const [form, setForm] = useState({
    name: "",
    client: "",
    city: "",
    area: "",
    height: "",
    sowingArea: "",
    type: "проточка",
    currency: DEFAULT_PROJECT_CURRENCY.symbol,
    currencyCode: DEFAULT_PROJECT_CURRENCY.code,
    currencySymbol: DEFAULT_PROJECT_CURRENCY.symbol,
    currencyName: DEFAULT_PROJECT_CURRENCY.name,
    currencyCustom: false,
    vat: false,
    comment: "",
    manualParams: { ...DEFAULT_MANUAL_PARAMS, projectKind: PROJECT_KIND.CLIENT },
  });

  const [stellages, setStellages] = useState([]);
  const [draft, setDraft] = useState(null);
  const [farmSectionLines, setFarmSectionLines] = useState({});
  const [activeFarmSection, setActiveFarmSection] = useState(null);
  const [farmLoaded, setFarmLoaded] = useState(false);
  // New /new: empty rooms. Hydrate from project when projectId is present.
  const [rooms, setRooms] = useState([]);
  const [activeCoolingRoomId, setActiveCoolingRoomId] = useState(null);

  useEffect(() => {
    const fromUrl = searchParams.get("projectId");
    if (fromUrl && fromUrl !== loadedProjectId) {
      setLoadedProjectId(fromUrl);
    }
  }, [searchParams, loadedProjectId]);

  useEffect(() => {
    if (!savedProjectIdFromUrl || !farmSettings) return;
    let cancelled = false;
    setProjectLoading(true);
    actions.loadProject(savedProjectIdFromUrl)
      .then((project) => {
        if (cancelled || !project) return;
        const hydrated = hydrateBuilderFromProject(project, {
          sections: filterSectionsForFarmType(resolveFarmSections(farmSettings || {}), project.type || "проточка"),
          farmCatalogs,
          stellageCatalogs,
          materials: state.materials,
        });
        setForm(hydrated.form);
        setNameTouched(true);
        setStellages(hydrated.stellages);
        setRooms(hydrated.rooms);
        setFarmSectionLines(hydrated.farmSectionLines);
        setFarmLoaded(hydrated.farmLoaded);
        setLoadedProjectId(project.id);
        setLoadedProject(project);
        // Keep current draft when only editRack changed (return from constructor).
        // Full reload of projectId still clears draft below via setDraft(null) on first load.
        setDraft(null);
        const stepFromUrl = searchParams.get("step");
        if (!stepFromUrl && hydrated.lastStep && STEPS.some((s) => s.id === hydrated.lastStep)) {
          setStep(hydrated.lastStep);
        }
      })
      .catch((e) => {
        if (!cancelled) error(e.message || "Не удалось загрузить проект");
      })
      .finally(() => {
        if (!cancelled) setProjectLoading(false);
      });
    return () => { cancelled = true; };
    // editRack must NOT retrigger hydrate — clearing editRack from URL used to
    // reload the project, wipe draft, and auto-create an empty "Стеллаж 2".
  }, [savedProjectIdFromUrl, farmSettings, farmCatalogs, stellageCatalogs, actions, error, state.materials]);

  useEffect(() => {
    const fromUrl = String(searchParams.get("editRack") || "").trim();
    if (fromUrl) setPendingEditRack(fromUrl);
  }, [searchParams]);

  // After frame constructor saves BOM via store.projectUpdate, keep builder
  // snapshot in sync so "Из схемы каркаса" / preserveFrameBom see new items.
  useEffect(() => {
    if (!loadedProjectId) return;
    const fromStore = state.projects.find((p) => p.id === loadedProjectId);
    if (!fromStore) return;
    setLoadedProject((prev) => {
      if (!prev) return fromStore;
      if (prev === fromStore) return prev;
      if (prev.updatedAt === fromStore.updatedAt && (prev.items?.length || 0) === (fromStore.items?.length || 0)) {
        return prev;
      }
      return fromStore;
    });
  }, [state.projects, loadedProjectId]);

  useEffect(() => {
    const fromUrl = searchParams.get("step");
    if (fromUrl && STEPS.some((s) => s.id === fromUrl) && fromUrl !== step) {
      setStep(fromUrl);
    }
  }, [searchParams, step]);

  const sections = useMemo(
    () => filterSectionsForFarmType(resolveFarmSections(farmSettings || {}), form.type),
    [farmSettings, form.type]
  );
  const stellageMods = state.modules.filter((m) => m.type === "stellage");
  const stellagePresets = useMemo(
    () =>
      [...presets.filter((p) => p.presetType === "stellage")].sort(
        (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)
      ),
    [presets]
  );
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setManual = (k, v) =>
    setForm((f) => ({ ...f, manualParams: { ...(f.manualParams || {}), [k]: v } }));
  const setBasicsField = (key, value) => {
    setForm((f) => {
      const next = { ...f, [key]: value };
      if ((key === "client" || key === "city") && !nameTouched) {
        next.name = suggestProjectName({
          client: key === "client" ? value : f.client,
          city: key === "city" ? value : f.city,
        });
      }
      return next;
    });
    if (key === "name") setNameTouched(true);
  };
  const uploadedSchemes = useMemo(
    () => listUploadedSchemes(form.manualParams),
    [form.manualParams]
  );
  const showFloorPlanPin =
    (step === "general" || step === "cooling" || step === "consumables" || step === "review") &&
    uploadedSchemes.length > 0;
  const setSchemesManualParams = (next) =>
    setForm((f) => ({ ...f, manualParams: next && typeof next === "object" ? next : f.manualParams }));
  const basicsErrors = useMemo(() => validateNewProjectForm(form), [form]);
  const canGoNextFromBasics = canSubmitNewProject(form);
  const projectKind = resolveProjectKind({ manualParams: form.manualParams }) || PROJECT_KIND.CLIENT;

  useEffect(() => {
    Promise.all([api.getPresets(), api.getSettings(), api.getSuppliers()]).then(([p, s, sup]) => {
      setPresets(p);
      setFarmSettings(s);
      setFarmCatalogs(parseFarmSectionCatalogs(s.farmSectionCatalogs));
      setStellageCatalogs(parseStellageModuleCatalogs(s.stellageModuleCatalogs));
      setStellageModuleMeta(parseStellageModuleMeta(s.stellageModuleMeta));
      setCategories(resolveCategories(s));
      setSuppliers(sup);
    });
  }, []);

  // Do not auto-create empty rack drafts — user starts a stellage explicitly.

  useEffect(() => {
    if (step === "general" && !farmLoaded && sections.length) {
      setFarmSectionLines(emptyFarmSectionsState(sections, farmCatalogs, state.materials));
      setActiveFarmSection(sections[0].id);
      setFarmLoaded(true);
    }
  }, [step, farmLoaded, sections, farmCatalogs, state.materials]);

  const effectiveFarmSectionId = useMemo(() => {
    if (!sections.length) return null;
    if (activeFarmSection && sections.some((s) => s.id === activeFarmSection)) {
      return activeFarmSection;
    }
    return sections[0].id;
  }, [sections, activeFarmSection]);

  useEffect(() => {
    if (step !== "general" || !sections.length) return;
    if (effectiveFarmSectionId && effectiveFarmSectionId !== activeFarmSection) {
      setActiveFarmSection(effectiveFarmSectionId);
    }
  }, [step, sections.length, effectiveFarmSectionId, activeFarmSection]);

  const farmHasSelections = useMemo(
    () => Object.values(farmSectionLines).some((lines) => activeLines(lines || []).length > 0),
    [farmSectionLines]
  );

  const goToStep = async (next) => {
    if (next === step) return;
    let draftForSave = draft;
    let stellagesForSave = stellages;
    if (step === "stellages" && next !== "stellages" && draft) {
      if (!isMeaningfulRackDraft(draft) && !draft.editingExisting && !draft.wasInProjectList) {
        // Empty auto-draft: discard silently, never persist.
        setDraft(null);
        draftForSave = null;
      } else if (draft.items?.some((ln) => ln.included) && !draft.editingExisting && !draft.wasInProjectList) {
        if (
          !(await confirm({
            title: "Сохранить заполненный стеллаж?",
            message:
              "Есть незавершённая сборка стеллажа с отмеченными позициями. Если уйти сейчас, они не попадут в проект, пока вы не нажмёте «Стеллаж готов».",
            confirmLabel: "Уйти без сохранения",
            cancelLabel: "Остаться",
          }))
        ) {
          return;
        }
        setDraft(null);
        draftForSave = null;
      } else if (draft.editingExisting || draft.wasInProjectList || isMeaningfulRackDraft(draft)) {
        // Put checked-out / meaningful rack back into the list before leaving.
        const {
          editingExisting: _e,
          wasInProjectList: _w,
          forcePersistForFrame: _f,
          frameDrawingCount: _fd,
          frameBomCount: _fb,
          hasFrameDrawing: _hf,
          ...rest
        } = draft;
        const restored = { ...rest, items: (draft.items || []).map((ln) => ({ ...ln })) };
        const nextList = stellages.some((s) => s.id === draft.id)
          ? stellages.map((s) => (s.id === draft.id ? restored : s))
          : [...stellages, restored];
        setStellages(nextList);
        setDraft(null);
        stellagesForSave = nextList;
        draftForSave = null;
      } else {
        setDraft(null);
        draftForSave = null;
      }
    }
    setStep(next);
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("step", next);
      return p;
    }, { replace: true });
    // Never create on step change — only update an already-saved draft.
    if (shouldUpdateDraftOnStepChange(loadedProjectId) && form.name.trim()) {
      saveDraftSilently(next, { draftOverride: draftForSave, stellagesOverride: stellagesForSave }).catch(() => {});
    }
  };

  const changeFarmType = async (newType) => {
    if (newType === form.type) return;
    if (
      farmHasSelections &&
      !(await confirm({
        title: "Сменить тип фермы?",
        message: `Разделы «Ферма целиком» будут перезагружены для типа «${newType}». Текущие отметки пропадут.`,
      }))
    ) {
      return;
    }
    if (farmHasSelections) setFarmSectionLines({});
    setFarmLoaded(false);
    set("type", newType);
  };

  const changeDraftModule = async (moduleId) => {
    const mod = state.modules.find((m) => m.id === moduleId);
    if (!mod) return;
    const reload = () =>
      setDraft((d) => ({
        ...d,
        moduleId: mod.id,
        moduleName: mod.name,
        tech: mod.tech || "",
        presetId: null,
        photoUrl: stellageModulePhoto(stellageModuleMeta, mod.id),
        items: projectStellageLinesFromCatalog(stellageCatalogs, mod.id, state.materials, mod.name),
      }));
    if (draft?.items?.some((ln) => ln.included)) {
      if (!(await confirm({ title: "Сменить тип?", message: "Текущие отметки будут заменены шаблоном из «Состав стеллажей»." }))) return;
    }
    reload();
  };

  const applyStellagePreset = async (preset) => {
    if (draft?.items?.some((ln) => ln.included) && !(await confirm({ title: "Загрузить пресет?", message: "Текущая сборка будет заменена." }))) return;
    setDraft(draftFromStellagePreset(preset, preset.name, stellages.length + 1, stellageModuleMeta));
  };

  const saveDraftAsPreset = async () => {
    const name = window.prompt("Название конфигурации стеллажа (пресет):", draft?.name || "");
    if (!name?.trim()) return;
    if (countIncluded(draft.items) === 0) {
      error("Отметьте хотя бы одну позицию.");
      return;
    }
    try {
      await api.createPreset(presetPayloadFromDraft(draft, name));
      setPresets(await api.getPresets());
      success("Пресет сохранён в «Модули и шаблоны».");
    } catch (e) {
      error(e.message);
    }
  };

  const startNewStellageDraft = () => {
    setDraft(
      newStellageDraft(
        state.modules,
        state.materials,
        stellages.length + 1,
        stellageCatalogs,
        stellageModuleMeta,
      ),
    );
  };

  const finishStellage = () => {
    if (!draft?.name?.trim()) {
      error("Укажите название стеллажа в проекте.");
      return;
    }
    if (countIncluded(draft.items) === 0 && !draft.wasInProjectList && !draft.hasFrameDrawing) {
      error("Отметьте хотя бы одну позицию галочкой.");
      return;
    }
    if (draft.items.some((ln) => ln.included && resolveBuilderLineQty(ln) <= 0)) {
      error("У отмеченных позиций укажите количество: колонка «Кол-во» или шт в параметрах насоса/вытяжки.");
      return;
    }
    const {
      editingExisting: _e,
      wasInProjectList: _w,
      forcePersistForFrame: _f,
      frameDrawingCount: _fd,
      frameBomCount: _fb,
      hasFrameDrawing: _hf,
      ...finished
    } = draft;
    setStellages((list) => {
      const row = { ...finished, items: draft.items.map((ln) => ({ ...ln })) };
      if (list.some((s) => s.id === draft.id)) {
        return list.map((s) => (s.id === draft.id ? row : s));
      }
      return [...list, row];
    });
    // After finishing a rack, stay on the list — do not auto-open a blank "Стеллаж N+1".
    setDraft(null);
  };

  const openStellageEditor = async (st, { skipConfirm = false } = {}) => {
    if (!st) return;
    // Discard empty unrelated draft without asking — never persist it.
    if (!skipConfirm && draft && draft.id !== st.id && !isMeaningfulRackDraft(draft)) {
      setDraft(null);
    } else if (
      !skipConfirm
      && draft?.id
      && draft.id !== st.id
      && isMeaningfulRackDraft(draft)
      && !(await confirm({
        title: "Сохранить заполненный стеллаж?",
        message: "Текущая незавершённая сборка будет закрыта. Отмеченные позиции не попадут в проект, пока вы не нажмёте «Стеллаж готов».",
        confirmLabel: "Продолжить",
        cancelLabel: "Отмена",
      }))
    ) {
      return;
    }
    const mergedItems = mergeStellageBuilderLines(
      st,
      stellageCatalogs,
      state.materials,
      loadedProject?.items || [],
    );
    setStellages((list) => list.filter((s) => s.id !== st.id));
    setDraft({
      ...st,
      items: mergedItems.map((ln) => ({ ...ln })),
      editingExisting: true,
      wasInProjectList: true,
    });
  };

  const editStellage = (id) => {
    const st = stellages.find((s) => s.id === id);
    return openStellageEditor(st);
  };

  const removeStellage = async (id) => {
    if (!(await confirm({ title: "Удалить готовый стеллаж?" }))) return;
    setStellages((list) => list.filter((s) => s.id !== id));
  };

  const duplicateStellage = (id) => {
    const st = stellages.find((s) => s.id === id);
    if (!st) return;
    setStellages((list) => [...list, duplicateStellageInstance(st)]);
    success("Стеллаж скопирован — при необходимости измените название и кол-во.");
  };

  const saveMaterial = async (payload) => {
    const m = await actions.materialAdd(payload);
    return m;
  };

  const resetFarmSection = async () => {
    if (!activeFarmSection) return;
    const cur = farmSectionLines[activeFarmSection] || [];
    const sec = sections.find((s) => s.id === activeFarmSection);
    if (cur.some((ln) => ln.included) && !(await confirm({ title: "Сбросить раздел?" }))) return;
    setFarmSectionLines((s) => ({
      ...s,
      [activeFarmSection]: projectLinesFromCatalog(farmCatalogs, activeFarmSection, state.materials, sec),
    }));
  };

  const farmHasItems = Object.values(farmSectionLines).some((lines) => activeLines(lines).length > 0);

  const coolingInputs = form.manualParams?.coolingFarm || COOLING_FARM_DEFAULTS;
  const coolingCalc = useMemo(() => computeCoolingFarm(coolingInputs), [coolingInputs]);

  const draftProjectItems = useMemo(() => {
    const farmSections = sections.map((sec) => ({
      sectionId: sec.id,
      sectionName: sec.name,
      defaultResponsible: sec.defaultResponsible || "",
      items: farmSectionLines[sec.id] || [],
    }));
    return buildProjectFromBuilder({
      form,
      stellages,
      farmSections,
      materials: state.materials,
      rooms,
      stellageModuleMeta,
      existingItems: loadedProject?.items || [],
    }).items;
  }, [form, stellages, farmSectionLines, sections, state.materials, rooms, stellageModuleMeta, loadedProject?.items]);

  const roomsCoolingRecKw = useMemo(
    () => enrichRooms(rooms).reduce((sum, r) => sum + (Number(r.recommendedCoolingKw) || 0), 0),
    [rooms]
  );

  const setCoolingInputs = (next) => {
    setForm((f) => ({
      ...f,
      manualParams: { ...f.manualParams, coolingFarm: next },
    }));
  };

  const applyCoolingToForm = ({ coolingKw, coolingBtu }) => {
    setForm((f) => ({
      ...f,
      manualParams: {
        ...f.manualParams,
        coolingFarm: coolingInputs,
        coolingPower: coolingKw,
        coolingBtu,
      },
    }));
  };

  // ---- Cooling calculator → room workflow (new project) ----
  const activeCoolingRoom = rooms.find((r) => r.id === activeCoolingRoomId) || rooms[0] || null;
  const effectiveCoolingRoomId = activeCoolingRoom?.id || null;

  const applyCoolingToRoom = ({ roomId, snapshot }) => {
    const id = roomId || effectiveCoolingRoomId;
    if (!id) return;
    setRooms(rooms.map((r) => (r.id === id ? applyCoolingCalcToRoom(r, snapshot) : r)));
  };

  const applyCoolingAndNext = ({ roomId, snapshot }) => {
    const id = roomId || effectiveCoolingRoomId;
    if (!id) return;
    const { rooms: next, nextRoomId } = applyAndSelectNextRoom(rooms, id, snapshot);
    setRooms(next);
    if (nextRoomId) setActiveCoolingRoomId(nextRoomId);
  };

  const duplicateCoolingToNewRoom = ({ fromRoomId, snapshot }) => {
    const from = rooms.find((r) => r.id === (fromRoomId || effectiveCoolingRoomId)) || null;
    const created = applyCoolingCalcToRoom(newRoom(from?.name ? `Копия — ${from.name}` : "Новая комната"), snapshot);
    setRooms([...rooms, created]);
    setActiveCoolingRoomId(created.id);
  };

  const clearCoolingRoom = ({ roomId }) => {
    const id = roomId || effectiveCoolingRoomId;
    if (!id) return;
    setRooms(rooms.map((r) => (r.id === id ? clearRoomCooling(r) : r)));
  };

  const canCreate = canSubmitNewProject(form);
  const canFinalize = canCreate;

  const buildProjectPayload = ({
    status = PROJECT_STATUS_DRAFT,
    nextStep = step,
    draftOverride,
    stellagesOverride,
  } = {}) => {
    const draftResolved = draftOverride !== undefined ? draftOverride : draft;
    const stellagesResolved = Array.isArray(stellagesOverride) ? stellagesOverride : stellages;
    const farmSections = sections.map((sec) => ({
      sectionId: sec.id,
      sectionName: sec.name,
      defaultResponsible: sec.defaultResponsible || "",
      items: farmSectionLines[sec.id] || [],
    }));
    const built = buildProjectFromBuilder({
      form: {
        ...form,
        manualParams: mergeBuilderWizardParams(
          {
            ...(form.manualParams || {}),
            projectKind: resolveProjectKind({ manualParams: form.manualParams }) || PROJECT_KIND.CLIENT,
            ...(status === PROJECT_STATUS_ACTIVE ? { showCreateOnboarding: true } : {}),
          },
          { lastStep: nextStep }
        ),
      },
      stellages: stellagesForProjectSave(stellagesResolved, draftResolved),
      farmSections,
      materials: state.materials,
      rooms,
      stellageModuleMeta,
      existingItems: loadedProject?.items || [],
    });
    built.status = status;
    if (loadedProject?.items?.length) {
      const stellageList = stellagesForProjectSave(stellagesResolved, draftResolved);
      const farmSectionNames = new Set(farmSections.map((s) => s.sectionName).filter(Boolean));
      const activeStellageIds = new Set(stellageList.map((st) => st.id).filter(Boolean));
      const mergeResult = buildProjectItemsAfterBuilderSave({
        existingItems: loadedProject.items,
        generatedBuilderItems: built.items,
        builderContext: { farmSectionNames, activeStellageIds },
        materials: state.materials,
      });
      if (mergeResult.blocked) {
        const err = new Error(
          mergeResult.invariantErrors.join("; ") || "Сохранение заблокировано: потеря позиций спецификации",
        );
        err.code = "BUILDER_MERGE_BLOCKED";
        throw err;
      }
      built.items = preserveFrameBomProjectItems(mergeResult.items, loadedProject.items, {
        activeStellageIds,
      });
      built.items = stripResidualFrameBomTwins(built.items);
      built.items = stripSameNameFrameBomBuilderTwins(built.items);
      built.items = syncProjectItemStellageLabels(built.items, stellageList);
      built.items = mergeFrameBomQtyFromBuilderLines(built.items, stellageList);
    }
    return built;
  };

  const syncBuilderProjectUrl = (projectId, nextStep = step) => {
    if (!projectId) return;
    const mode =
      (loadedProject && !isDraftProject(loadedProject)) || builderUrl.mode === "edit"
        ? "edit"
        : "draft";
    const url = buildBuilderDraftPath(projectId, { step: nextStep, mode });
    const params = new URLSearchParams(url.split("?")[1] || "");
    setSearchParams(params, { replace: true });
  };

  const markSaved = () => {
    setSaveState("saved");
    window.setTimeout(() => setSaveState("idle"), 2500);
  };

  /** Intermediate save must not demote a finished project back to draft. */
  const resolveSaveStatus = (requested = PROJECT_STATUS_DRAFT) => {
    if (loadedProject && !isDraftProject(loadedProject)) {
      return loadedProject.status || PROJECT_STATUS_ACTIVE;
    }
    return requested;
  };

  const persistProject = async ({
    status = PROJECT_STATUS_DRAFT,
    nextStep = step,
    silent = false,
    draftOverride,
    stellagesOverride,
  } = {}) => {
    if (!canSubmitNewProject(form)) {
      throw new Error("Укажите название и клиента на шаге «Проект».");
    }
    if (!silent) setDraftSaving(true);
    try {
      const effectiveStatus = resolveSaveStatus(status);
      // Always full builder save. Server-side reconcile preserves SpecEditor item
      // state; automatic title-only heuristics are unsafe (miss rack/room/scheme edits).
      const payload = {
        ...buildProjectPayload({ status: effectiveStatus, nextStep, draftOverride, stellagesOverride }),
        builderSave: true,
        builderSaveMode: "full",
      };
      if (loadedProjectId) {
        const updated = await actions.projectUpdate(loadedProjectId, payload);
        setLoadedProjectId(updated.id);
        setLoadedProject(updated);
        syncBuilderProjectUrl(updated.id, nextStep);
        if (!silent) markSaved();
        return updated;
      }
      const guard = status === PROJECT_STATUS_ACTIVE ? createGuardRef.current : draftGuardRef.current;
      const outcome = await guard.run(async () => actions.projectCreate(payload));
      if (outcome.skipped) {
        // Parallel create: prefer already-set id from the winning call.
        if (loadedProjectId && loadedProject) return loadedProject;
        return null;
      }
      const created = outcome.result;
      setLoadedProjectId(created.id);
      setLoadedProject(created);
      syncBuilderProjectUrl(created.id, nextStep);
      if (!silent) markSaved();
      return created;
    } finally {
      if (!silent) setDraftSaving(false);
    }
  };

  const saveDraftSilently = async (nextStep = step, overrides = {}) => {
    if (!loadedProjectId || !canSubmitNewProject(form)) return null;
    return persistProject({
      status: resolveSaveStatus(PROJECT_STATUS_DRAFT),
      nextStep,
      silent: true,
      ...overrides,
    });
  };

  const saveDraft = async () => {
    if (draftSaving || draftGuardRef.current.busy) return;
    if (!canSubmitNewProject(form)) {
      error("Укажите название и клиента на шаге «Проект».");
      setStep("basics");
      return;
    }
    try {
      const project = await persistProject({
        status: resolveSaveStatus(PROJECT_STATUS_DRAFT),
        silent: false,
      });
      if (!project) return;
      success(editingFinishedProject ? "Проект сохранён" : "Черновик сохранён");
    } catch (e) {
      error(e.message || "Не удалось сохранить черновик");
    }
  };

  const openFrameForStellage = (project, stellage, frameCtx = null) => {
    const baseCtx = buildBuilderFrameDrawingContext({
      projectId: project.id,
      projectName: project.name || form.name,
      stellage,
    });
    const ctx = frameCtx
      ? { ...baseCtx, ...frameCtx, returnTo: baseCtx.returnTo }
      : baseCtx;
    nav(buildFrameDrawingLink(ctx));
  };

  const draftOverrideForFrameStellage = (stellage) => {
    if (!stellage?.id) return undefined;
    if (draft?.id === stellage.id) {
      return {
        ...draft,
        editingExisting: true,
        wasInProjectList: true,
        forcePersistForFrame: true,
        hasFrameDrawing: true,
      };
    }
    // Opening scheme from a list rack while an unrelated empty draft is open —
    // do not let the empty draft hitch a ride into the save payload.
    if (draft && !isMeaningfulRackDraft(draft) && !draft.editingExisting) {
      return null;
    }
    return draft;
  };

  const saveProjectAndOpenFrame = async (stellage, frameCtx = null) => {
    if (frameSchemeSaving) return;
    const validationError = validateStellageForFrameDrawing(stellage);
    if (validationError) {
      error(validationError);
      return;
    }
    if (!form.name.trim() || !String(form.client || "").trim()) {
      error("Укажите название и клиента на шаге «Проект».");
      return;
    }
    setFrameSchemeSaving(true);
    try {
      const draftOverride = draftOverrideForFrameStellage(stellage);
      if (draftOverride?.id === stellage.id && draft?.id === stellage.id) {
        setDraft(draftOverride);
      }
      const project = await persistProject({ draftOverride });
      if (!project) return;
      openFrameForStellage(project, stellage, frameCtx);
    } catch (e) {
      error(e.message || "Не удалось сохранить проект");
    } finally {
      setFrameSchemeSaving(false);
    }
  };

  const openSavedProjectFrame = async (stellage, frameCtx = null) => {
    if (frameSchemeSaving) return;
    const validationError = validateStellageForFrameDrawing(stellage);
    if (validationError) {
      error(validationError);
      return;
    }
    setFrameSchemeSaving(true);
    try {
      const draftOverride = draftOverrideForFrameStellage(stellage);
      if (draftOverride?.id === stellage.id && draft?.id === stellage.id) {
        setDraft(draftOverride);
      }
      const project = await persistProject({ draftOverride });
      if (!project) return;
      openFrameForStellage(project, stellage, frameCtx);
    } catch (e) {
      error(e.message || "Не удалось обновить проект");
    } finally {
      setFrameSchemeSaving(false);
    }
  };

  const handleFrameDrawingAction = (stellage, frameCtx = null) => {
    if (loadedProjectId) return openSavedProjectFrame(stellage, frameCtx);
    return saveProjectAndOpenFrame(stellage, frameCtx);
  };

  useEffect(() => {
    // Return from frame constructor: keep the rack in the project list.
    // Do NOT auto-checkout into draft — that emptied the list and spawned "Стеллаж 2".
    if (!pendingEditRack || projectLoading || step !== "stellages") return;
    const target = findStellageByEditRack(stellages, pendingEditRack);
    setPendingEditRack("");
    const params = new URLSearchParams(searchParams);
    params.delete("editRack");
    setSearchParams(params, { replace: true });
    if (!target) return;
    // Ensure any empty unrelated draft is cleared so the list UI is shown.
    if (draft && draft.id !== target.id && !isMeaningfulRackDraft(draft)) {
      setDraft(null);
    } else if (!draft) {
      // already on list view — nothing else to do
    } else if (draft.id === target.id) {
      // already editing the returned rack
    } else if (!isMeaningfulRackDraft(draft)) {
      setDraft(null);
    }
  }, [pendingEditRack, projectLoading, step, stellages, draft, searchParams, setSearchParams]);

  const draftFrameBomItems = useMemo(() => {
    if (!draft?.id || !draft?.moduleId || !loadedProject?.items?.length) return [];
    const moduleRackKey = buildModuleRackKey({ moduleId: draft.moduleId, rackId: draft.id });
    return frameBomItemsForModuleRack(loadedProject.items, moduleRackKey);
  }, [draft, loadedProject]);

  const reviewTotalSum = useMemo(() => {
    let sum = 0;
    for (const st of stellages) {
      for (const ln of activeLines(st.items || [])) {
        sum += (Number(ln.price) || 0) * (Number(ln.qty) || 0) * Math.max(1, Number(st.count) || 1);
      }
    }
    for (const lines of Object.values(farmSectionLines)) {
      for (const ln of activeLines(lines || [])) {
        sum += (Number(ln.price) || 0) * (Number(ln.qty) || 0);
      }
    }
    return Math.round(sum * 100) / 100;
  }, [stellages, farmSectionLines]);

  const finalizeProject = async () => {
    if (!canFinalize || saving || createGuardRef.current.busy) return;
    if (!canSubmitNewProject(form)) {
      error("Укажите название и клиента на шаге «Проект».");
      setStep("basics");
      return;
    }
    setSaving(true);
    try {
      const nextStatus = editingFinishedProject
        ? resolveSaveStatus(loadedProject?.status || PROJECT_STATUS_ACTIVE)
        : PROJECT_STATUS_ACTIVE;
      const project = await persistProject({
        status: nextStatus,
        nextStep: "review",
        silent: true,
      });
      if (!project) return;
      // Ensure onboarding flag for SpecEditor (first create only)
      if (!editingFinishedProject && project?.id && project?.manualParams?.showCreateOnboarding !== true) {
        try {
          await actions.projectUpdate(project.id, {
            manualParams: { ...(project.manualParams || {}), showCreateOnboarding: true },
          });
        } catch {
          /* non-fatal */
        }
      }
      success(editingFinishedProject ? "Проект обновлён" : "Проект создан");
      nav(`/project/${project.id}${editingFinishedProject ? "" : "?created=1"}`, { replace: true });
    } catch (e) {
      error(e.message || (editingFinishedProject ? "Ошибка сохранения проекта" : "Ошибка создания проекта"));
    } finally {
      setSaving(false);
    }
  };

  const activeSection = sections.find((s) => s.id === effectiveFarmSectionId);

  return (
    <>
      <PageHeader
        title={
          editingFinishedProject
            ? "Редактирование проекта"
            : isDraftSession
              ? "Проект в настройке"
              : "Новый проект"
        }
        sub={
          editingFinishedProject
            ? "Меняйте стеллажи, разделы и параметры. Сохранение обновляет тот же проект без создания копии."
            : isEditMode
              ? "Продолжайте сборку фермы в мастере: стеллажи, разделы, охлаждение, закупка. Проект сохраняется как черновик до финального создания."
              : "Соберите стеллажи и разделы фермы. После первого сохранения черновик появится в «В процессе»."
        }
        back={{
          to: editingFinishedProject
            ? `/project/${loadedProjectId}`
            : isEditMode
              ? "/projects/in-progress"
              : "/",
          label: editingFinishedProject ? "К спецификации" : isEditMode ? "В процессе" : "Проекты",
        }}
        actions={
          <>
            {(isDraftSession || editingFinishedProject) && (
              <span className="chip" style={{ fontSize: 11, marginRight: 8 }}>
                {saveState === "saved"
                  ? "Сохранено"
                  : draftSaving
                    ? "Сохранение…"
                    : editingFinishedProject
                      ? "Готовый проект"
                      : "Черновик"}
              </span>
            )}
            <button
              type="button"
              className="btn btn-sm"
              disabled={!canGoNextFromBasics || draftSaving}
              onClick={saveDraft}
            >
              {draftSaving
                ? "Сохранение…"
                : editingFinishedProject
                  ? "Сохранить"
                  : "Сохранить черновик"}
            </button>
            <CompactTableToggle />
            <Link to="/modules" className="btn btn-sm">
              Модули и шаблоны
            </Link>
          </>
        }
      />

      {projectLoading && (
        <p className="muted" style={{ marginBottom: 12 }}>Загрузка проекта…</p>
      )}

      <div className="step-tabs">
        {STEPS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`btn btn-sm ${step === s.id ? "btn-primary" : ""}`}
            onClick={() => goToStep(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {step === "basics" && (
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ marginTop: 0 }}>Данные проекта</h3>
          <div className="form-grid">
            <label>
              Название проекта *
              <input
                value={form.name}
                onChange={(e) => setBasicsField("name", e.target.value)}
                placeholder="Вертикальная ферма — Клиент — Город"
              />
              {basicsErrors.name ? (
                <span className="muted" style={{ color: "var(--danger)", fontSize: 12 }}>{basicsErrors.name}</span>
              ) : null}
            </label>
            <label>
              Клиент / компания *
              <input
                value={form.client}
                onChange={(e) => setBasicsField("client", e.target.value)}
                placeholder="ООО Пример"
              />
              {basicsErrors.client ? (
                <span className="muted" style={{ color: "var(--danger)", fontSize: 12 }}>{basicsErrors.client}</span>
              ) : null}
            </label>
            <label>
              Город
              <input value={form.city} onChange={(e) => setBasicsField("city", e.target.value)} />
            </label>
            <label>
              Ответственный
              <input
                value={form.manualParams?.responsible || ""}
                onChange={(e) => setManual("responsible", e.target.value)}
                placeholder="Имя"
              />
            </label>
            <label>
              Тип проекта
              <select
                value={projectKind}
                onChange={(e) => setManual("projectKind", e.target.value)}
              >
                {PROJECT_KIND_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </label>
            <label>
              Тип фермы
              <select value={form.type} onChange={(e) => changeFarmType(e.target.value)}>
                {ref.farmTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <label>
              Общая площадь, м²
              <input type="number" value={form.area} onChange={(e) => set("area", e.target.value)} />
            </label>
            <label>
              Посевная площадь, м²
              <input type="number" value={form.sowingArea} onChange={(e) => set("sowingArea", e.target.value)} />
            </label>
            <label>
              Высота, м
              <input type="number" value={form.height} onChange={(e) => set("height", e.target.value)} />
            </label>
            <ProjectCurrencyFields
              value={form}
              onChange={(desc) => setForm((f) => applyCurrencyDescToForm(f, desc))}
            />
            <label className="full">
              Описание
              <textarea rows={2} value={form.comment} onChange={(e) => set("comment", e.target.value)} />
            </label>
            <label className="full">
              Внутренний комментарий
              <textarea
                rows={2}
                value={form.manualParams?.notes || ""}
                onChange={(e) => setManual("notes", e.target.value)}
                placeholder="Только для команды, не для клиента"
              />
            </label>
          </div>

          <RoomsEditor rooms={rooms} onChange={setRooms} />

          <ClientSchemesEditor
            manualParams={form.manualParams}
            onChange={setSchemesManualParams}
            showClientVisibility
            title="Схемы проекта"
            projectId={loadedProjectId || "builder-new"}
          />

          <div className="toolbar" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canGoNextFromBasics}
              onClick={() => goToStep("stellages")}
            >
              Далее: стеллажи →
            </button>
          </div>
        </div>
      )}

      {step === "stellages" && !draft && stellages.length === 0 && (
        <div>
          <div className="toolbar" style={{ marginBottom: 14 }}>
            <button type="button" className="btn" onClick={() => goToStep("basics")}>← Назад</button>
            <button type="button" className="btn" style={{ marginLeft: "auto" }} onClick={() => goToStep("general")}>
              Ферма целиком →
            </button>
          </div>
          <div className="card" style={{ padding: 20 }}>
            <p className="muted" style={{ marginTop: 0 }}>
              В проекте пока нет стеллажей. Добавьте первый стеллаж или перейдите к разделам фермы.
            </p>
            <button type="button" className="btn btn-primary" onClick={startNewStellageDraft}>
              ＋ Добавить стеллаж
            </button>
          </div>
        </div>
      )}

      {step === "stellages" && !draft && stellages.length > 0 && (
        <div>
          <div className="toolbar" style={{ marginBottom: 14 }}>
            <button type="button" className="btn" onClick={() => goToStep("basics")}>← Назад</button>
            <button type="button" className="btn" style={{ marginLeft: "auto" }} onClick={() => goToStep("general")}>
              Ферма целиком →
            </button>
          </div>

          <div className="card" style={{ marginBottom: 14, padding: 12, borderColor: 'var(--border)' }}>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {DRAFT_PROJECT_FRAME_DRAWING_SECTION_HINT}
            </p>
          </div>

          <div className="card" style={{ marginBottom: 14, padding: 12 }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>В проекте ({stellages.length})</div>
            {stellages.map((st) => (
              <div key={st.id} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
                <div className="row between stellage-list-row" style={{ marginBottom: 8, gap: 10 }}>
                  <StellagePhotoThumb
                    url={resolveStellagePhoto(stellageModuleMeta, st.moduleId, st.photoUrl || st.params?.photoUrl)}
                    size={48}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong>{st.name}</strong>
                    {(Number(st.count) || 1) > 1 && (
                      <span className="muted" style={{ fontSize: 12, marginLeft: 6 }}>× {st.count} шт.</span>
                    )}
                    <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
                      {st.moduleName} · {countIncluded(st.items)} поз.
                      {st.presetId ? " · пресет" : ""}
                    </span>
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => editStellage(st.id)}>
                      Продолжить спецификацию
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => duplicateStellage(st.id)}>Копия</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeStellage(st.id)}>✕</button>
                  </span>
                </div>
                <BuilderStellageFrameDrawingRow
                  stellage={st}
                  projectId={loadedProjectId}
                  projectName={form.name}
                  onSaveProjectAndOpen={handleFrameDrawingAction}
                  saving={frameSchemeSaving}
                  compact
                />
              </div>
            ))}
          </div>

          <div className="toolbar" style={{ marginBottom: 14 }}>
            <button type="button" className="btn btn-primary" onClick={startNewStellageDraft}>
              Добавить стеллаж
            </button>
          </div>
        </div>
      )}

      {step === "stellages" && draft && (
        <div>
          <div className="toolbar" style={{ marginBottom: 14 }}>
            <button type="button" className="btn" onClick={() => goToStep("basics")}>← Назад</button>
            <button type="button" className="btn" style={{ marginLeft: "auto" }} onClick={() => goToStep("general")}>
              Ферма целиком →
            </button>
          </div>

          <div className="card" style={{ marginBottom: 14, padding: 12, borderColor: 'var(--border)' }}>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {DRAFT_PROJECT_FRAME_DRAWING_SECTION_HINT}
            </p>
          </div>

          {stellages.length > 0 && (
            <div className="card" style={{ marginBottom: 14, padding: 12 }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>В проекте ({stellages.length})</div>
              {stellages.map((st) => (
                <div key={st.id} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
                  <div className="row between stellage-list-row" style={{ marginBottom: 8, gap: 10 }}>
                  <StellagePhotoThumb
                    url={resolveStellagePhoto(stellageModuleMeta, st.moduleId, st.photoUrl || st.params?.photoUrl)}
                    size={48}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong>{st.name}</strong>
                    {(Number(st.count) || 1) > 1 && (
                      <span className="muted" style={{ fontSize: 12, marginLeft: 6 }}>× {st.count} шт.</span>
                    )}
                    <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
                      {st.moduleName} · {countIncluded(st.items)} поз.
                      {st.presetId ? " · пресет" : ""}
                    </span>
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => editStellage(st.id)}>
                      Продолжить спецификацию
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => duplicateStellage(st.id)}>Копия</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeStellage(st.id)}>✕</button>
                  </span>
                  </div>
                  <BuilderStellageFrameDrawingRow
                    stellage={st}
                    projectId={loadedProjectId}
                    projectName={form.name}
                    onSaveProjectAndOpen={handleFrameDrawingAction}
                    saving={frameSchemeSaving}
                    compact
                  />
                </div>
              ))}
            </div>
          )}

          {stellagePresets.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Готовые конфигурации</div>
              <div className="preset-grid">
                {stellagePresets.map((p) => (
                  <button key={p.id} type="button" className="preset-card preset-card--photo" onClick={() => applyStellagePreset(p)}>
                    <StellagePhotoThumb
                      url={resolveStellagePhoto(stellageModuleMeta, p.moduleId, p.params?.photoUrl)}
                      size={80}
                    />
                    <strong>{p.name}</strong>
                    <span className="muted">{p.moduleName}</span>
                    <span className="muted" style={{ fontSize: 11 }}>
                      {p.items.filter((i) => i.included).length} поз.
                      {formatStellageParamsSummary(p.params) ? ` · ${formatStellageParamsSummary(p.params)}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="card" style={{ padding: 16, marginBottom: 12 }}>
            <h3 style={{ marginTop: 0, fontSize: 15 }}>Стеллаж в проекте</h3>
            <div className="form-grid">
              <label>
                Название в проекте
                <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
              </label>
              <label>
                Тип
                <select value={draft.moduleId} onChange={(e) => changeDraftModule(e.target.value)}>
                  {stellageMods.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Количество стеллажей
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={draft.count ?? 1}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, count: Math.max(1, Number(e.target.value) || 1) }))
                  }
                  title="Материалы умножаются на это число"
                />
              </label>
            </div>
            <StellagePhotoField
              value={resolveStellagePhoto(stellageModuleMeta, draft.moduleId, draft.photoUrl || draft.params?.photoUrl)}
              onChange={(url) => setDraft((d) => ({ ...d, photoUrl: url, params: { ...(d.params || {}), photoUrl: url } }))}
              hint="Своё фото экземпляра. Если убрать — подставится фото типа из «Состав стеллажей»."
              compact={false}
            />
            {draft.params && formatStellageParamsSummary(draft.params) && (
              <p className="muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
                Параметры пресета: {formatStellageParamsSummary(draft.params)}
              </p>
            )}
            <div style={{ marginTop: 12 }}>
              <BuilderStellageFrameDrawingRow
                stellage={draft}
                projectId={loadedProjectId}
                projectName={form.name}
                onSaveProjectAndOpen={handleFrameDrawingAction}
                saving={frameSchemeSaving}
              />
            </div>
            <RackImagesEditor
              rackId={draft.id}
              images={draft.extraImages}
              onChange={(extraImages) => setDraft((d) => ({ ...d, extraImages }))}
              onConfirmRemove={(image) => confirm({
                title: "Удалить изображение?",
                message: `Привязка «${image.title}» будет удалена только у этого стеллажа.`,
              })}
            />
            <div className="toolbar" style={{ marginTop: 10 }}>
              <button type="button" className="btn btn-sm" onClick={saveDraftAsPreset}>
                💾 Сохранить как пресет
              </button>
            </div>
          </div>

          <div className="toolbar" style={{ marginBottom: 10 }}>
            <button type="button" className="btn btn-primary" onClick={finishStellage}>
              ✓ Стеллаж готов — следующий
            </button>
            <span className="muted" style={{ fontSize: 12 }}>
              Отметьте позиции и укажите кол-во — без кол-ва клиенту не попадёт
            </span>
          </div>

          {draftFrameBomItems.length > 0 && (
            <div className="card" style={{ marginBottom: 12, padding: 12, background: "var(--surface-alt)" }}>
              <h4 style={{ marginTop: 0, fontSize: 14 }}>Добавлено из схемы каркаса</h4>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {draftFrameBomItems.map((it) => (
                  <li key={it.id}>
                    {it.name} — {it.qty} {it.unit}
                  </li>
                ))}
              </ul>
              <p className="muted" style={{ fontSize: 11, margin: "8px 0 0" }}>
                Эти позиции уже сохранены в черновик проекта. Ниже можно добавить остальные материалы стеллажа.
              </p>
            </div>
          )}

          <SpecPickerTable
            lines={draft.items}
            onChange={(items) => setDraft((d) => ({ ...d, items }))}
            materials={state.materials}
            catalogModule=""
            catalogLabel="позицию"
            onSaveMaterial={saveMaterial}
            showQty
            showCompositionGroups
            showProjectPrice
            stellageGroups={ref.stellageGroups}
            categories={categories}
            suppliers={suppliers}
          />

          <div className="toolbar" style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-primary" onClick={finishStellage}>
              ✓ Стеллаж готов — следующий
            </button>
            <button type="button" className="btn" onClick={() => goToStep("basics")}>← Назад</button>
            <button type="button" className="btn" style={{ marginLeft: "auto" }} onClick={() => goToStep("general")}>
              Ферма целиком →
            </button>
          </div>
        </div>
      )}

      {step === "general" && !sections.length && (
        <div className="card" style={{ padding: 20 }}>
          <p className="muted" style={{ margin: 0 }}>
            Для типа фермы «{form.type}» нет доступных разделов — проверьте настройки в «Модули и шаблоны → Разделы фермы»
            (галочки «Скрыть для типов фермы»).
          </p>
          <button type="button" className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => goToStep("basics")}>
            ← Изменить тип фермы
          </button>
        </div>
      )}

      {step === "general" && sections.length > 0 && (
        <div>
          <p className="muted" style={{ fontSize: 13, margin: "0 0 12px" }}>
            Общая закупка по разделам фермы — отмечайте позиции здесь (не отдельный стартовый сценарий).
          </p>
          <ClientSchemesEditor
            manualParams={form.manualParams}
            onChange={setSchemesManualParams}
            showClientVisibility={false}
            title="Схемы проекта"
            projectId={loadedProjectId || "builder-new"}
          />

          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <h4 style={{ margin: "0 0 8px" }}>Общее и пиковое потребление фермы</h4>
            <FarmPowerEditor manualParams={form.manualParams} onChange={setSchemesManualParams} rooms={rooms} />
          </div>

          {rooms.length > 0 && (
            <p className="muted" style={{ fontSize: 13, margin: "0 0 12px" }}>
              Комнаты ({rooms.length}):{" "}
              {rooms.map((r) => r.name + (r.area ? ` ${r.area} м²` : "")).join(" · ")}
              {" — "}
              <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 0, verticalAlign: "baseline" }} onClick={() => goToStep("basics")}>
                изменить в «Проект»
              </button>
            </p>
          )}

          {!farmLoaded ? (
            <div className="card" style={{ padding: 20 }}>
              <p className="muted" style={{ margin: 0 }}>Загрузка разделов фермы…</p>
            </div>
          ) : (
          <div className="farm-layout">
            <nav className="section-tabs" aria-label="Разделы фермы">
              {sections.map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  className={sec.id === effectiveFarmSectionId ? "active" : ""}
                  title={`${GROUP_LABEL[sec.group] || ""} · ${sec.name}`}
                  style={
                    sec.id === effectiveFarmSectionId
                      ? {
                          borderColor: sec.color,
                          color: sec.color,
                          background: `${sec.color}14`,
                        }
                      : { borderColor: `${sec.color}33` }
                  }
                  onClick={() => setActiveFarmSection(sec.id)}
                >
                  <span className="sec-tab-name">
                    {sec.icon ? `${sec.icon} ` : ""}
                    {sec.name}
                  </span>
                  <span className="muted" style={{ display: "block", fontWeight: 400, fontSize: 10.5, marginTop: 2 }}>
                    {GROUP_LABEL[sec.group] || "Раздел"}
                    {" · "}
                    {(farmSectionLines[sec.id] || []).length} поз.
                    {countIncluded(farmSectionLines[sec.id] || []) > 0 &&
                      ` · ${countIncluded(farmSectionLines[sec.id] || [])} отм.`}
                  </span>
                </button>
              ))}
            </nav>

            <div className="farm-layout__main">
              <div className="card" style={{ padding: 14, marginBottom: 12 }}>
                <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>{activeSection?.name || "Раздел фермы"}</h3>
                <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                  Отметьте нужные позиции, укажите количество и комнату. Состав — из шаблона «Разделы фермы»; наименования — из справочника материалов.
                </p>
                <button type="button" className="btn btn-sm" style={{ marginTop: 10 }} onClick={resetFarmSection}>
                  ↺ Сбросить к шаблону раздела
                </button>
              </div>

              <SpecPickerTable
                lines={farmSectionLines[effectiveFarmSectionId] || []}
                onChange={(lines) =>
                  setFarmSectionLines((s) => ({ ...s, [effectiveFarmSectionId]: lines }))
                }
                materials={state.materials}
                catalogLabel="материал"
                staticNames
                onSaveMaterial={saveMaterial}
                showQty
                showProjectPrice
                showRoom={rooms.length > 0}
                rooms={rooms}
                showFarmLineGroups
                categories={categories}
                suppliers={suppliers}
                farmSectionId={effectiveFarmSectionId}
                hiddenColumns={farmHiddenColumns}
                onToggleColumn={toggleFarmColumn}
              />
            </div>
          </div>
          )}

          <div className="toolbar" style={{ marginTop: 16 }}>
            <button type="button" className="btn" onClick={() => goToStep("stellages")}>← Стеллажи</button>
            {uploadedSchemes.length > 0 && (
              <FloorPlanPin schemes={uploadedSchemes} title="Схема помещения" variant="button" />
            )}
            <button type="button" className="btn btn-primary" style={{ marginLeft: "auto" }} onClick={() => goToStep("cooling")}>
              Расчёт охлаждения →
            </button>
          </div>
        </div>
      )}

      {step === "cooling" && (
        <div>
          {uploadedSchemes.length > 0 && (
            <div className="toolbar" style={{ marginBottom: 12 }}>
              <FloorPlanPin schemes={uploadedSchemes} title="Схема помещения" variant="button" />
            </div>
          )}
          <CoolingFarmTab
            inputs={coolingInputs}
            onInputsChange={setCoolingInputs}
            draftArea={form.area}
            draftHeight={form.height}
            onApplyToProject={applyCoolingToForm}
            rooms={rooms}
            activeRoomId={effectiveCoolingRoomId}
            onActiveRoomChange={setActiveCoolingRoomId}
            onApplyToRoom={applyCoolingToRoom}
            onApplyAndNext={applyCoolingAndNext}
            onDuplicateToNewRoom={duplicateCoolingToNewRoom}
            onClearRoomCooling={clearCoolingRoom}
          />
          <div className="card" style={{ padding: 16, marginTop: 16 }}>
            <h4 style={{ margin: "0 0 4px", fontSize: 14 }}>Кондиционеры по комнатам</h4>
            <p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>
              Сверху — расчёт нагрузки, ниже — спецификация для клиента (комната, шт × кВт, ссылка). Позиции попадут в проект автоматически.
            </p>
            <RoomsEditor rooms={rooms} onChange={setRooms} compact showCount={false} />
            <RoomCoolingEditor rooms={rooms} onChange={setRooms} />
            <div style={{ marginTop: 16 }}>
              <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>Электропотребление фермы</h4>
              <FarmPowerEditor manualParams={form.manualParams} onChange={setSchemesManualParams} rooms={rooms} />
            </div>
          </div>
          <div className="toolbar" style={{ marginTop: 16 }}>
            <button type="button" className="btn" onClick={() => goToStep("general")}>← Ферма целиком</button>
            <button type="button" className="btn btn-primary" style={{ marginLeft: "auto" }} onClick={() => goToStep("consumables")}>
              Расходные материалы →
            </button>
          </div>
        </div>
      )}

      {step === "consumables" && (
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ marginTop: 0 }}>Расходные материалы</h3>
          <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
            Ссылка на корзину с расходниками (Ozon, Wildberries, поставщик) — сохранится в проекте и будет видна в спецификации.
          </p>
          <label className="field" style={{ display: "block", maxWidth: 640 }}>
            Ссылка на корзину / список расходников
            <input
              type="url"
              placeholder="https://…"
              value={form.manualParams?.consumablesCartUrl || ""}
              onChange={(e) => setManual("consumablesCartUrl", e.target.value)}
            />
          </label>
          {form.manualParams?.consumablesCartUrl && (
            <p style={{ fontSize: 13, marginTop: 12 }}>
              <a href={form.manualParams.consumablesCartUrl} target="_blank" rel="noreferrer">
                Открыть корзину ↗
              </a>
            </p>
          )}
          <div className="toolbar" style={{ marginTop: 20 }}>
            <button type="button" className="btn" onClick={() => goToStep("cooling")}>← Расчёт охлаждения</button>
            <button type="button" className="btn btn-primary" style={{ marginLeft: "auto" }} onClick={() => goToStep("review")}>
              Проверить →
            </button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ marginTop: 0 }}>Итого</h3>
          <ul style={{ fontSize: 14, lineHeight: 1.9 }}>
            <li>Название: <strong>{form.name || "—"}</strong></li>
            <li>Клиент: <strong>{form.client || "—"}</strong></li>
            <li>Город: <strong>{form.city || "—"}</strong></li>
            <li>Тип фермы: <strong>{form.type || "—"}</strong></li>
            <li>Тип проекта: <strong>{getProjectKindLabel(projectKind)}</strong></li>
            <li>
              Стеллажей:{" "}
              <strong>
                {stellages.reduce((n, st) => n + Math.max(1, Number(st.count) || 1), 0)}
              </strong>
              {stellages.length > 0 && (
                <span className="muted" style={{ fontSize: 12 }}>
                  {" "}
                  ({stellages.length} конфиг.)
                </span>
              )}
            </li>
            <li>
              Общая закупка (ферма целиком):{" "}
              <strong>
                {sections.reduce((n, sec) => n + activeLines(farmSectionLines[sec.id] || []).length, 0)}
              </strong>{" "}
              поз.
            </li>
            {sections.map((sec) => (
              <li key={sec.id} style={{ marginLeft: 12, fontSize: 13 }}>
                {sec.name}: <strong>{activeLines(farmSectionLines[sec.id] || []).length}</strong> поз.
              </li>
            ))}
            <li>
              Расходные материалы:{" "}
              <strong>
                {form.manualParams?.consumablesCartUrl ? "ссылка указана" : "не указаны"}
              </strong>
            </li>
            <li>
              Итоговая сумма (оценка):{" "}
              <strong>
                {reviewTotalSum.toLocaleString("ru-RU")} {form.currency || "₽"}
              </strong>
            </li>
            <li>
              Статус:{" "}
              <strong>
                {loadedProject
                  ? getProjectStatusLabel(loadedProject.status) || (isDraftProject(loadedProject) ? "В настройке" : "Черновик")
                  : "Ещё не создан (локальный черновик)"}
              </strong>
            </li>
            <li>Комнат: <strong>{rooms.length}</strong>
              {rooms.length > 0 && (
                <span className="muted" style={{ fontSize: 12 }}>
                  {" "}({rooms.map((r) => r.name).join(", ")})
                </span>
              )}
            </li>
            <li>
              Охлаждение (ферма): <strong>{Math.round(coolingCalc.totalKwSafety * 10) / 10} кВт</strong>
              {form.manualParams?.coolingPower ? ` (сохранено ${form.manualParams.coolingPower} кВт)` : ""}
            </li>
            {roomsCoolingRecKw > 0 && (
              <li>
                Кондиционеры по комнатам (рекомендуемо):{" "}
                <strong>{Math.round(roomsCoolingRecKw * 10) / 10} кВт</strong>
              </li>
            )}
            {form.manualParams?.consumablesCartUrl && (
              <li>
                Корзина расходников:{" "}
                <a href={form.manualParams.consumablesCartUrl} target="_blank" rel="noreferrer">
                  открыть ↗
                </a>
              </li>
            )}
          </ul>
          {!canFinalize && (
            <p style={{ color: "var(--danger)", fontSize: 13 }}>
              Нужны название проекта и клиент.
            </p>
          )}
          {canFinalize && !farmHasItems && stellages.every((s) => activeLines(s.items).length === 0) && (
            <p className="muted" style={{ fontSize: 13 }}>
              Закупка пока пустая — это нормально. Можно создать проект с readiness EMPTY и дополнить позиции позже.
            </p>
          )}
          <div className="toolbar" style={{ marginTop: 16 }}>
            <button type="button" className="btn" onClick={() => goToStep("consumables")}>← Назад</button>
            <button type="button" className="btn btn-primary" disabled={!canFinalize || saving} onClick={finalizeProject}>
              {saving
                ? editingFinishedProject
                  ? "Сохранение…"
                  : "Создание…"
                : editingFinishedProject
                  ? "Сохранить и открыть спецификацию"
                  : "Создать проект"}
            </button>
          </div>
        </div>
      )}

      {showFloorPlanPin && <FloorPlanPin schemes={uploadedSchemes} title="Схема помещения" />}
    </>
  );
}
