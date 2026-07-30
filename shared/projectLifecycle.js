/** Project lifecycle: draft wizard vs active HQ project */

import { isProjectStatusActiveLifecycle } from "./projectStatus.js";

export const PROJECT_STATUS_DRAFT = 'draft';
export const PROJECT_STATUS_ACTIVE = 'active';
export const PROJECT_STATUS_ARCHIVED = 'archived';

export function isDraftProject(project) {
  return String(project?.status || '') === PROJECT_STATUS_DRAFT;
}

export function isActiveProject(project) {
  return isProjectStatusActiveLifecycle(project?.status);
}

export function builderWizardFromManualParams(manualParams = {}) {
  return manualParams?.builderWizard && typeof manualParams.builderWizard === 'object'
    ? manualParams.builderWizard
    : {};
}

export function mergeBuilderWizardParams(manualParams = {}, patch = {}) {
  return {
    ...manualParams,
    builderWizard: {
      ...builderWizardFromManualParams(manualParams),
      ...patch,
    },
  };
}

export function resolveBuilderWizardStep(project, fallback = 'stellages') {
  const step = String(builderWizardFromManualParams(project?.manualParams).lastStep || '').trim();
  return step || fallback;
}

export function buildBuilderDraftPath(projectId, { step = 'stellages', editRack, mode = 'draft' } = {}) {
  const id = String(projectId || '').trim();
  const params = new URLSearchParams();
  if (id) params.set('projectId', id);
  if (mode) params.set('mode', mode);
  if (step) params.set('step', step);
  const rack = String(editRack || '').trim();
  if (rack) params.set('editRack', rack);
  return `/new?${params.toString()}`;
}

/** Open finished (non-draft) project in the wizard without demoting to draft URL. */
export function buildBuilderEditPath(projectId, { step = 'review', editRack } = {}) {
  return buildBuilderDraftPath(projectId, { step, editRack, mode: 'edit' });
}

/** Continue draft or re-open finished project in builder. */
export function buildBuilderContinuePath(project, { step } = {}) {
  const id = project?.id;
  if (!id) return '/new';
  const resolved = step || resolveBuilderWizardStep(project, isDraftProject(project) ? 'stellages' : 'review');
  if (isDraftProject(project)) {
    return buildBuilderDraftPath(id, { step: resolved, mode: 'draft' });
  }
  return buildBuilderEditPath(id, { step: resolved });
}

export function parseBuilderSearchParams(searchParams) {
  const sp = searchParams instanceof URLSearchParams
    ? searchParams
    : new URLSearchParams(searchParams || '');
  const mode = String(sp.get('mode') || '').trim();
  return {
    projectId: String(sp.get('projectId') || '').trim(),
    mode,
    step: String(sp.get('step') || '').trim(),
    editRack: String(sp.get('editRack') || '').trim(),
    isDraftUrl: mode === 'draft' || (Boolean(sp.get('projectId')) && mode !== 'edit'),
    isEditUrl: mode === 'edit',
  };
}

export function projectOpenPath(project) {
  if (isDraftProject(project)) {
    return buildBuilderDraftPath(project.id, {
      step: resolveBuilderWizardStep(project),
    });
  }
  return `/project/${project.id}`;
}

export function projectOpenLabel(project) {
  return isDraftProject(project) ? 'Продолжить настройку' : 'Открыть';
}

export function projectLifecycleBadge(project) {
  if (isDraftProject(project)) return 'В настройке';
  return '';
}
