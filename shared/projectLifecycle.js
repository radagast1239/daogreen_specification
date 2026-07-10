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

export function parseBuilderSearchParams(searchParams) {
  const sp = searchParams instanceof URLSearchParams
    ? searchParams
    : new URLSearchParams(searchParams || '');
  return {
    projectId: String(sp.get('projectId') || '').trim(),
    mode: String(sp.get('mode') || '').trim(),
    step: String(sp.get('step') || '').trim(),
    editRack: String(sp.get('editRack') || '').trim(),
    isDraftUrl: sp.get('mode') === 'draft' || Boolean(sp.get('projectId')),
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
