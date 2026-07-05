import { describe, it, expect } from 'vitest';
import {
  parseFrameDrawingSearchParams,
  hasFrameDrawingSaveTarget,
  buildFrameDrawingLink,
  buildFrameDrawingTitle,
  buildFrameDrawingSavePayload,
  frameDrawingBindingLabel,
} from '../shared/frameDrawingContext.js';
import { defaultFrameParams } from '../src/frameConstructor/framePresets.js';

describe('frameDrawingContext', () => {
  it('parseFrameDrawingSearchParams reads project and rack ids', () => {
    const ctx = parseFrameDrawingSearchParams(
      '?projectId=p1&rackId=st_abc&source=project_rack&rackLabel=Стеллаж%201',
    );
    expect(ctx.projectId).toBe('p1');
    expect(ctx.rackId).toBe('st_abc');
    expect(ctx.sourceType).toBe('project_rack');
    expect(ctx.rackLabel).toBe('Стеллаж 1');
  });

  it('hasFrameDrawingSaveTarget is true when projectId exists', () => {
    expect(hasFrameDrawingSaveTarget({ projectId: 'p1' })).toBe(true);
    expect(hasFrameDrawingSaveTarget({ presetId: 'pr1' })).toBe(true);
    expect(hasFrameDrawingSaveTarget({ drawingId: 'd1' })).toBe(true);
    expect(hasFrameDrawingSaveTarget({ moduleId: 'm1', sourceType: 'module_rack' })).toBe(true);
    expect(hasFrameDrawingSaveTarget({})).toBe(false);
  });

  it('buildFrameDrawingLink encodes query params', () => {
    const link = buildFrameDrawingLink({
      projectId: 'p1',
      rackId: 'st1',
      sourceType: 'project_rack',
    });
    expect(link).toContain('/planner/frame?');
    expect(link).toContain('projectId=p1');
    expect(link).toContain('rackId=st1');
  });

  it('buildFrameDrawingTitle uses dimensions from config', () => {
    const title = buildFrameDrawingTitle({
      ...defaultFrameParams,
      name: 'Новый каркас',
      rackType: 'nft',
      lengthMm: 3000,
      depthMm: 500,
      tierCount: 7,
    });
    expect(title).toContain('3000');
    expect(title).toContain('7');
  });

  it('buildFrameDrawingSavePayload includes frame config', () => {
    const payload = buildFrameDrawingSavePayload(defaultFrameParams, {
      projectId: 'p1',
      rackId: 'st1',
      sourceType: 'project_rack',
    });
    expect(payload.projectId).toBe('p1');
    expect(payload.stellageId).toBe('st1');
    expect(payload.frameConfigJson.lengthMm).toBe(3000);
    expect(payload.isClientVisible).toBe(true);
  });

  it('frameDrawingBindingLabel describes project rack', () => {
    expect(
      frameDrawingBindingLabel({ sourceType: 'project_rack', rackLabel: 'NFT-1' }),
    ).toContain('NFT-1');
  });
});
