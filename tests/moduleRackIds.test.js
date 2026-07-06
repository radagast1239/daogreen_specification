import { describe, it, expect } from 'vitest';
import {
  buildModuleRackKey,
  moduleCatalogRackId,
  moduleMetaFrameRackId,
  ensureModuleMetaFrameRackIds,
  moduleRackKeyUsesIndexFallback,
  MODULE_CATALOG_RACK_SLOT,
} from '../shared/moduleRackIds.js';
import { buildFrameDrawingSavePayload } from '../shared/frameDrawingContext.js';
import { defaultFrameParams } from '../src/frameConstructor/framePresets.js';

describe('moduleRackIds', () => {
  it('buildModuleRackKey uses module_id + rack.id only', () => {
    expect(buildModuleRackKey({ moduleId: 'mod_nft', rackId: 'st_abc' })).toBe('mod_nft:st_abc');
  });

  it('key unchanged when module display name changes', () => {
    const rackId = 'st_stable';
    const before = buildModuleRackKey({ moduleId: 'mod1', rackId });
  const after = buildModuleRackKey({ moduleId: 'mod1', rackId });
    expect(before).toBe(after);
    expect(before).toBe('mod1:st_stable');
  });

  it('rackLabel does not affect buildModuleRackKey', () => {
    const key = buildModuleRackKey({ moduleId: 'mod1', rackId: 'mr_1' });
    expect(key).toBe('mod1:mr_1');
    expect(buildModuleRackKey({ moduleId: 'mod1', rackId: 'mr_1' })).toBe(key);
  });

  it('moduleCatalogRackId is stable and not derived from name', () => {
    expect(moduleCatalogRackId('mod_a')).toBe(MODULE_CATALOG_RACK_SLOT);
    expect(moduleCatalogRackId('mod_b')).toBe(MODULE_CATALOG_RACK_SLOT);
  });

  it('ensureModuleMetaFrameRackIds assigns frameRackId to legacy meta', () => {
    const next = ensureModuleMetaFrameRackIds({ mod1: { photoUrl: '/x.jpg' } });
    expect(next.mod1.frameRackId).toBe(MODULE_CATALOG_RACK_SLOT);
    expect(next.mod1.photoUrl).toBe('/x.jpg');
  });

  it('moduleMetaFrameRackId returns persisted frameRackId', () => {
    const meta = { mod1: { frameRackId: 'custom_mr' } };
    expect(moduleMetaFrameRackId(meta, 'mod1')).toBe('custom_mr');
  });

  it('index fallback is flagged as risky', () => {
    const key = buildModuleRackKey({ moduleId: 'mod1', rackIndex: 2 });
    expect(key).toBe('mod1:idx:2');
    expect(moduleRackKeyUsesIndexFallback(key)).toBe(true);
    expect(moduleRackKeyUsesIndexFallback('mod1:st_1')).toBe(false);
  });

  it('save payload uses rack id not label for module_rack_key', () => {
    const payload = buildFrameDrawingSavePayload(defaultFrameParams, {
      moduleId: 'mod1',
      rackId: 'st_99',
      sourceType: 'module_rack',
      rackLabel: 'Переименованный стеллаж',
    });
    expect(payload.moduleRackKey).toBe('mod1:st_99');
    expect(payload.title).toContain('Переименованный');
  });

  it('returns empty key without moduleId or rackId', () => {
    expect(buildModuleRackKey({ moduleId: 'mod1' })).toBe('');
  });
});
