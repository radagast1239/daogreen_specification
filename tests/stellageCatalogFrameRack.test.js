import { describe, it, expect } from 'vitest';
import { parseStellageModuleMeta } from '../src/lib/stellageCatalogConfig.js';
import { MODULE_CATALOG_RACK_SLOT } from '../shared/moduleRackIds.js';

describe('stellageCatalogConfig frame rack ids', () => {
  it('parseStellageModuleMeta assigns frameRackId to legacy entries', () => {
    const meta = parseStellageModuleMeta(JSON.stringify({ mod1: { photoUrl: '/a.jpg' } }));
    expect(meta.mod1.frameRackId).toBe(MODULE_CATALOG_RACK_SLOT);
    expect(meta.mod1.photoUrl).toBe('/a.jpg');
  });
});
