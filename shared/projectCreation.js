/** Guided creation of a real client project (pure helpers, no DB). */

import { PROJECT_STATUS, resolveProjectStatusForSave } from "./projectStatus.js";

export const PROJECT_KIND = {
  CLIENT: "client",
  TEST: "test",
  TEMPLATE: "template",
};

export const PROJECT_KIND_OPTIONS = [
  { id: PROJECT_KIND.CLIENT, label: "Реальный клиентский", badge: "Клиентский" },
  { id: PROJECT_KIND.TEST, label: "Тестовый", badge: "Тестовый" },
  { id: PROJECT_KIND.TEMPLATE, label: "Шаблон", badge: "Шаблон" },
];

export const CREATE_SCENARIO = {
  EMPTY: "empty",
  GENERAL_PURCHASE: "general_purchase",
  BUILDER: "builder",
};

export const CREATE_SCENARIO_OPTIONS = [
  {
    id: CREATE_SCENARIO.EMPTY,
    label: "Пустой проект",
    detail: "Без стеллажей, комнат и позиций. Спецификацию заполните позже.",
  },
  {
    id: CREATE_SCENARIO.GENERAL_PURCHASE,
    label: "Начать с общей закупки",
    detail: "Открыть проект и перейти к разделам общей закупки.",
  },
  {
    id: CREATE_SCENARIO.BUILDER,
    label: "Перейти к проектировщику",
    detail: "После создания открыть мастер стеллажей и разделов.",
  },
];

export function suggestProjectName({ client = "", city = "" } = {}) {
  const c = String(client || "").trim();
  const cityPart = String(city || "").trim();
  if (!c && !cityPart) return "Вертикальная ферма";
  if (c && cityPart) return `Вертикальная ферма — ${c} — ${cityPart}`;
  if (c) return `Вертикальная ферма — ${c}`;
  return `Вертикальная ферма — ${cityPart}`;
}

export function getProjectKindLabel(kind) {
  const row = PROJECT_KIND_OPTIONS.find((o) => o.id === kind);
  return row?.label || PROJECT_KIND_OPTIONS[0].label;
}

export function getProjectKindBadge(kind) {
  const row = PROJECT_KIND_OPTIONS.find((o) => o.id === kind);
  return row?.badge || "";
}

export function resolveProjectKind(project) {
  const raw = String(project?.manualParams?.projectKind || "").trim();
  if (PROJECT_KIND_OPTIONS.some((o) => o.id === raw)) return raw;
  return "";
}

function trimStr(v) {
  return String(v ?? "").trim();
}

function toFiniteNumber(v, fallback = 0) {
  if (v === "" || v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Normalize wizard form → API createProject body.
 * Never includes items/racks/rooms content; status = workflow Черновик (active).
 */
export function buildNewProjectPayload(formState = {}) {
  const name = trimStr(formState.name);
  const client = trimStr(formState.client);
  const city = trimStr(formState.city);
  const type = trimStr(formState.type) || "проточка";
  const comment = trimStr(formState.comment);
  const internalNote = trimStr(formState.internalNote);
  const responsible = trimStr(formState.responsible);
  const kind = PROJECT_KIND_OPTIONS.some((o) => o.id === formState.projectKind)
    ? formState.projectKind
    : PROJECT_KIND.CLIENT;
  const scenario = CREATE_SCENARIO_OPTIONS.some((o) => o.id === formState.scenario)
    ? formState.scenario
    : CREATE_SCENARIO.EMPTY;

  const notes = [internalNote, comment].filter(Boolean).join("\n").trim();

  const baseManual =
    formState.manualParams && typeof formState.manualParams === "object"
      ? { ...formState.manualParams }
      : {};

  const manualParams = {
    ...baseManual,
    projectKind: kind,
    createScenario: scenario,
    notes: notes || baseManual.notes || "",
    showCreateOnboarding: true,
  };
  if (responsible) manualParams.responsible = responsible;
  else delete manualParams.responsible;

  return {
    name,
    client,
    city,
    type,
    area: toFiniteNumber(formState.area, 0),
    height: toFiniteNumber(formState.height, 0),
    sowingArea: toFiniteNumber(formState.sowingArea, 0),
    currency: trimStr(formState.currency) || "₽",
    vat: !!formState.vat,
    comment: comment || "",
    status: resolveProjectStatusForSave(PROJECT_STATUS.ACTIVE),
    selectedModules: [],
    zones: [],
    stellageConfigs: [],
    rooms: [],
    items: [],
    manualParams,
  };
}

export function validateNewProjectForm(formState = {}) {
  const errors = {};
  if (!trimStr(formState.name)) errors.name = "Укажите название проекта";
  if (!trimStr(formState.client)) errors.client = "Укажите клиента / компанию";
  return errors;
}

export function canSubmitNewProject(formState = {}) {
  return Object.keys(validateNewProjectForm(formState)).length === 0;
}

/** Post-create navigation path (relative). */
export function resolveCreateProjectRedirect(project, scenario) {
  const id = project?.id;
  if (!id) return "/";
  const sc = scenario || project?.manualParams?.createScenario || CREATE_SCENARIO.EMPTY;
  if (sc === CREATE_SCENARIO.BUILDER) {
    return `/new?projectId=${encodeURIComponent(id)}&step=stellages&mode=edit`;
  }
  if (sc === CREATE_SCENARIO.GENERAL_PURCHASE) {
    return `/project/${encodeURIComponent(id)}?created=1&focus=general`;
  }
  return `/project/${encodeURIComponent(id)}?created=1`;
}

export function shouldShowCreateOnboarding(project, searchParams) {
  if (project?.manualParams?.showCreateOnboarding === false) return false;
  if (searchParams?.get?.("created") === "1") return true;
  return project?.manualParams?.showCreateOnboarding === true;
}

/**
 * Single-flight guard for final create. Success keeps lock (no second create).
 * Error releases lock for one retry.
 */
export function createProjectSubmitGuard() {
  let inFlight = false;
  return {
    get busy() {
      return inFlight;
    },
    async run(fn) {
      if (inFlight) return { ok: false, skipped: true, result: null };
      inFlight = true;
      try {
        const result = await fn();
        return { ok: true, skipped: false, result };
      } catch (err) {
        inFlight = false;
        throw err;
      }
    },
  };
}
