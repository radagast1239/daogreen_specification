import { describe, it, expect } from 'vitest';
import {
  PROJECT_STATUS_DRAFT,
  PROJECT_STATUS_ACTIVE,
  isDraftProject,
  isActiveProject,
  buildBuilderDraftPath,
  projectOpenPath,
  projectOpenLabel,
  mergeBuilderWizardParams,
  resolveBuilderWizardStep,
  parseBuilderSearchParams,
} from '../shared/projectLifecycle.js';
import { buildBuilderEditStellagesPath } from '../shared/frameDrawingContext.js';

describe('projectLifecycle', () => {
  it('detects draft and active projects', () => {
    expect(isDraftProject({ status: PROJECT_STATUS_DRAFT })).toBe(true);
    expect(isActiveProject({ status: PROJECT_STATUS_ACTIVE })).toBe(true);
    expect(isActiveProject({ status: PROJECT_STATUS_DRAFT })).toBe(false);
    expect(isActiveProject({ status: 'archived' })).toBe(false);
    expect(isActiveProject({ status: 'in_progress' })).toBe(true);
    expect(isActiveProject({ status: 'ready_to_send' })).toBe(true);
  });

  it('builds draft wizard URLs', () => {
    expect(buildBuilderDraftPath('p1', { step: 'stellages', editRack: 'mod1:st1' }))
      .toBe('/new?projectId=p1&mode=draft&step=stellages&editRack=mod1%3Ast1');
    expect(buildBuilderEditStellagesPath('p1', { editRack: 'mod1:st1' }))
      .toBe('/new?projectId=p1&mode=draft&step=stellages&editRack=mod1%3Ast1');
  });

  it('routes open actions by lifecycle', () => {
    const draft = { id: 'p1', status: PROJECT_STATUS_DRAFT, manualParams: { builderWizard: { lastStep: 'cooling' } } };
    const active = { id: 'p2', status: PROJECT_STATUS_ACTIVE };
    expect(projectOpenPath(draft)).toBe('/new?projectId=p1&mode=draft&step=cooling');
    expect(projectOpenLabel(draft)).toBe('Продолжить настройку');
    expect(projectOpenPath(active)).toBe('/project/p2');
    expect(projectOpenLabel(active)).toBe('Открыть');
  });

  it('stores and resolves wizard step in manualParams', () => {
    const merged = mergeBuilderWizardParams({}, { lastStep: 'stellages' });
    expect(resolveBuilderWizardStep({ manualParams: merged })).toBe('stellages');
  });

  it('parses builder search params', () => {
    const parsed = parseBuilderSearchParams('projectId=p1&mode=draft&step=stellages&editRack=mod1:st1');
    expect(parsed.projectId).toBe('p1');
    expect(parsed.mode).toBe('draft');
    expect(parsed.step).toBe('stellages');
    expect(parsed.editRack).toBe('mod1:st1');
    expect(parsed.isDraftUrl).toBe(true);
  });
});
