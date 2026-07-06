import { describe, it, expect } from 'vitest';
import {
  parseFrameDrawingSearchParams,
  hasFrameDrawingSaveTarget,
  buildFrameDrawingLink,
  buildFrameDrawingSavePayload,
  buildModuleRackKey,
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

  it('hasFrameDrawingSaveTarget is true when projectId exists', () => {
    expect(hasFrameDrawingSaveTarget({ projectId: 'p1' })).toBe(true);
    expect(hasFrameDrawingSaveTarget({ presetId: 'pr1' })).toBe(true);
    expect(hasFrameDrawingSaveTarget({ drawingId: 'd1' })).toBe(true);
    expect(hasFrameDrawingSaveTarget({ moduleId: 'm1', sourceType: 'module_rack' })).toBe(true);
    expect(hasFrameDrawingSaveTarget({})).toBe(false);
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
});
