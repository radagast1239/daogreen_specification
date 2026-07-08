import { describe, it, expect } from 'vitest';
import {
  parseFrameDrawingSearchParams,
  hasFrameDrawingSaveTarget,
  buildFrameDrawingLink,
  buildFrameDrawingSavePayload,
  buildModuleRackKey,
  buildBuilderStellagesReturnPath,
  buildBuilderEditStellagesPath,
  buildProjectStellagesReturnPath,
  buildStellagesReturnLabel,
  buildSavedProjectFrameDrawingContext,
  buildBuilderFrameDrawingContext,
  canCreateFrameDrawingFromBuilder,
  resolveFramePdfExportUi,
  DRAFT_PROJECT_FRAME_DRAWING_DISABLED_REASON,
  DRAFT_PROJECT_FRAME_DRAWING_SECTION_HINT,
  STANDALONE_FRAME_SAVE_HINT,
} from '../shared/frameDrawingContext.js';
import { defaultFrameParams } from '../src/frameConstructor/framePresets.js';

describe('frameDrawingContext', () => {
  it('parseFrameDrawingSearchParams reads project and stellage ids', () => {
    const ctx = parseFrameDrawingSearchParams(
      '?projectId=p1&stellageId=st_abc&source=project_stellage&rackLabel=Стеллаж%201',
    );
    expect(ctx.projectId).toBe('p1');
    expect(ctx.rackId).toBe('st_abc');
    expect(ctx.stellageId).toBe('st_abc');
    expect(ctx.sourceType).toBe('project_stellage');
    expect(ctx.rackLabel).toBe('Стеллаж 1');
  });

  it('parseFrameDrawingSearchParams reads moduleId + moduleRackKey', () => {
    const ctx = parseFrameDrawingSearchParams(
      '?moduleId=mod1&moduleRackKey=mod1:st1&source=module_rack&rackLabel=Rack',
    );
    expect(ctx.moduleId).toBe('mod1');
    expect(ctx.moduleRackKey).toBe('mod1:st1');
    expect(ctx.sourceType).toBe('module_rack');
  });

  it('parseFrameDrawingSearchParams reads presetId', () => {
    const ctx = parseFrameDrawingSearchParams('?presetId=pr1&source=preset');
    expect(ctx.presetId).toBe('pr1');
    expect(ctx.sourceType).toBe('preset');
  });

  it('infers moduleRackKey from moduleId and rackId', () => {
    const ctx = parseFrameDrawingSearchParams('?moduleId=mod1&rackId=st1&source=module_rack');
    expect(ctx.moduleRackKey).toBe('mod1:st1');
  });

  it('hasFrameDrawingSaveTarget requires project, preset or existing drawing', () => {
    expect(hasFrameDrawingSaveTarget({ projectId: 'p1' })).toBe(true);
    expect(hasFrameDrawingSaveTarget({ presetId: 'pr1' })).toBe(true);
    expect(hasFrameDrawingSaveTarget({ drawingId: 'd1' })).toBe(true);
    expect(hasFrameDrawingSaveTarget({ moduleId: 'm1', sourceType: 'module_rack' })).toBe(false);
    expect(hasFrameDrawingSaveTarget({ moduleId: 'm1', moduleRackKey: 'm1:st1' })).toBe(false);
    expect(hasFrameDrawingSaveTarget({})).toBe(false);
  });

  it('draft builder cannot create frame drawing without saved projectId', () => {
    expect(canCreateFrameDrawingFromBuilder('')).toBe(false);
    expect(canCreateFrameDrawingFromBuilder('p1')).toBe(true);
    expect(DRAFT_PROJECT_FRAME_DRAWING_DISABLED_REASON).toMatch(/Сначала сохраните проект/);
    expect(DRAFT_PROJECT_FRAME_DRAWING_SECTION_HINT).toMatch(/после сохранения черновика/i);
  });

  it('saved project frame drawing link includes projectId and moduleRackKey', () => {
    const ctx = buildSavedProjectFrameDrawingContext(
      { id: 'p1', name: 'Farm A' },
      { id: 'st1', moduleId: 'mod1', name: 'Стеллаж 1' },
    );
    const link = buildFrameDrawingLink(ctx);
    expect(link).toContain('projectId=p1');
    expect(link).toContain('moduleRackKey=mod1%3Ast1');
    expect(link).toContain('returnTo=%2Fproject%2Fp1%3Fsection%3Dstellages');
    expect(ctx.returnTo).toBe('/project/p1?section=stellages');
  });

  it('builder frame drawing context uses wizard return path', () => {
    const ctx = buildBuilderFrameDrawingContext({
      projectId: 'p1',
      projectName: 'Farm A',
      stellage: { id: 'st1', moduleId: 'mod1', name: 'Стеллаж 1' },
    });
    expect(ctx.returnTo).toBe('/new?projectId=p1&mode=draft&step=stellages&editRack=mod1%3Ast1');
    expect(buildFrameDrawingLink(ctx)).toContain('returnTo=%2Fnew%3FprojectId%3Dp1%26mode%3Ddraft%26step%3Dstellages%26editRack%3Dmod1%253Ast1');
  });

  it('resolveFramePdfExportUi hides save actions without projectId', () => {
    const standalone = resolveFramePdfExportUi({
      moduleId: 'mod1',
      moduleRackKey: 'mod1:st1',
      sourceType: 'module_rack',
    });
    expect(standalone.showSavePdfButton).toBe(false);
    expect(standalone.showComboButton).toBe(false);
    expect(standalone.showDownloadOnly).toBe(true);
    expect(standalone.showStandaloneSaveHint).toBe(true);

    const saved = resolveFramePdfExportUi(
      {
        projectId: 'p1',
        moduleId: 'mod1',
        moduleRackKey: 'mod1:st1',
        returnTo: '/new?projectId=p1&step=stellages',
      },
      { canSavePdfAndBom: true },
    );
    expect(saved.showSavePdfButton).toBe(true);
    expect(saved.showComboButton).toBe(true);
    expect(saved.showStandaloneSaveHint).toBe(false);
    expect(saved.showReturnToProjectSetup).toBe(true);
    expect(STANDALONE_FRAME_SAVE_HINT).toMatch(/мастер настройки проекта/);
  });

  it('buildFrameDrawingLink encodes stellageId query param', () => {
    const link = buildFrameDrawingLink({
      projectId: 'p1',
      rackId: 'st1',
      sourceType: 'project_stellage',
      returnTo: '/project/p1',
    });
    expect(link).toContain('/planner/frame?');
    expect(link).toContain('projectId=p1');
    expect(link).toContain('stellageId=st1');
    expect(link).toContain('returnTo=');
  });

  it('parseFrameDrawingSearchParams ignores rackLabel for moduleRackKey', () => {
    const ctx = parseFrameDrawingSearchParams(
      '?moduleId=mod1&rackId=st1&rackLabel=Old%20Name&source=module_rack',
    );
    expect(ctx.moduleRackKey).toBe('mod1:st1');
    const renamed = parseFrameDrawingSearchParams(
      '?moduleId=mod1&rackId=st1&rackLabel=New%20Name&source=module_rack',
    );
    expect(renamed.moduleRackKey).toBe(ctx.moduleRackKey);
  });

  it('buildFrameDrawingSavePayload includes stable moduleRackKey', () => {
    const payload = buildFrameDrawingSavePayload(defaultFrameParams, {
      moduleId: 'mod1',
      rackId: 'st1',
      sourceType: 'module_rack',
    });
    expect(payload.moduleId).toBe('mod1');
    expect(payload.moduleRackKey).toBe(buildModuleRackKey({ moduleId: 'mod1', rackId: 'st1' }));
    expect(payload.sourceType).toBe('module_rack');
  });

  it('buildFrameDrawingSavePayload normalizes project_rack source', () => {
    const payload = buildFrameDrawingSavePayload(defaultFrameParams, {
      projectId: 'p1',
      rackId: 'st1',
      sourceType: 'project_rack',
    });
    expect(payload.sourceType).toBe('project_stellage');
    expect(payload.stellageId).toBe('st1');
  });

  it('existing drawing key stable after label change in save payload', () => {
    const base = { moduleId: 'mod1', rackId: 'st1', sourceType: 'module_rack', rackLabel: 'A' };
    const key1 = buildFrameDrawingSavePayload(defaultFrameParams, base).moduleRackKey;
    const key2 = buildFrameDrawingSavePayload(defaultFrameParams, { ...base, rackLabel: 'B' }).moduleRackKey;
    expect(key1).toBe(key2);
    expect(key1).toBe('mod1:st1');
  });

  it('builds stellages return paths and labels', () => {
    expect(buildBuilderStellagesReturnPath()).toBe('/new?step=stellages');
    expect(buildProjectStellagesReturnPath('p1')).toBe('/project/p1?section=stellages');
    expect(buildBuilderEditStellagesPath('p1')).toBe('/new?projectId=p1&mode=draft&step=stellages');
    expect(buildBuilderEditStellagesPath('p1', { editRack: 'mod1:st1' }))
      .toBe('/new?projectId=p1&mode=draft&step=stellages&editRack=mod1%3Ast1');
    expect(buildStellagesReturnLabel('/new?projectId=p1&step=stellages')).toBe('Вернуться к настройке проекта');
    expect(buildStellagesReturnLabel('/project/p1?section=stellages')).toBe('Вернуться к стеллажам проекта');
    expect(buildStellagesReturnLabel('/new?step=stellages')).toBe('Вернуться');
    expect(buildStellagesReturnLabel('/project/p1')).toBe('Вернуться');
  });

  it('buildFrameDrawingLink encodes constructorTab', () => {
    const link = buildFrameDrawingLink({
      projectId: 'p1',
      rackId: 'st1',
      constructorTab: 'cutlist',
    });
    expect(link).toContain('constructorTab=cutlist');
  });
});
