import { describe, it, expect } from 'vitest';
import {
  buildModuleRackKey,
  drawingsForProjectStellage,
  drawingsForModuleRack,
  drawingStatusLabel,
  groupClientFrameDocuments,
} from '../shared/frameDrawingTargets.js';
import { MODULE_CATALOG_RACK_SLOT } from '../shared/moduleRackIds.js';

describe('frameDrawingTargets', () => {
  it('buildModuleRackKey uses rackId', () => {
    expect(buildModuleRackKey({ moduleId: 'mod1', rackId: 'st_abc' })).toBe('mod1:st_abc');
  });

  it('drawingsForProjectStellage returns newest first', () => {
    const list = drawingsForProjectStellage([
      { stellageId: 'st1', version: 1, updatedAt: '2020-01-01' },
      { stellageId: 'st1', version: 2, updatedAt: '2025-01-01' },
      { stellageId: 'st2', version: 1, updatedAt: '2025-01-01' },
    ], 'st1');
    expect(list).toHaveLength(2);
    expect(list[0].version).toBe(2);
  });

  it('drawingsForModuleRack filters by stable key', () => {
    const catalogKey = `m1:${MODULE_CATALOG_RACK_SLOT}`;
    const list = drawingsForModuleRack([
      { moduleId: 'm1', moduleRackKey: catalogKey, id: 'a' },
      { moduleId: 'm1', moduleRackKey: 'm1:other', id: 'b' },
    ], 'm1', catalogKey);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('a');
  });

  it('drawingStatusLabel reflects version count', () => {
    expect(drawingStatusLabel([])).toBe('Схема не создана');
    expect(drawingStatusLabel([{ id: '1' }])).toBe('Схема прикреплена');
    expect(drawingStatusLabel([{ id: '1' }, { id: '2' }])).toBe('Есть 2 версий');
  });

  it('groupClientFrameDocuments groups by binding label', () => {
    const groups = groupClientFrameDocuments([
      { id: 'f1', type: 'frame_drawing', filename: 'a.pdf', drawingSourceType: 'project_stellage', drawingTitle: 'Стеллаж 1' },
      { id: 'f2', type: 'pdf', filename: 'other.pdf' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(1);
  });
});
