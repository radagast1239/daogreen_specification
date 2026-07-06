import { describe, it, expect, beforeEach } from 'vitest';
import { db, initDb } from '../backend/src/db.js';
import { getClientProjectDocuments } from '../backend/src/routes/projects.js';
import { syncDrawingFilesVisibility } from '../backend/src/routes/frameDrawings.js';

let seedCounter = 0;

function seedProject(id = 'proj1') {
  seedCounter += 1;
  db.prepare(`
    INSERT INTO projects (id, name, client_token)
    VALUES (?, 'Test project', ?)
  `).run(id, `token-${id}-${seedCounter}`);
}

function insertFile(overrides = {}) {
  const id = overrides.id || `file-${seedCounter}`;
  db.prepare(`
    INSERT INTO files (id, project_id, type, filename, url)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.project_id ?? 'proj1',
    overrides.type ?? 'pdf',
    overrides.filename ?? 'doc.pdf',
    overrides.url ?? '/uploads/doc.pdf',
  );
  return id;
}

function insertDrawingWithFile({
  drawingId,
  fileId,
  visible = true,
  projectId = 'proj1',
  stellageId = 'st_1',
  title = 'Rack',
  sourceType = 'project_stellage',
}) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO frame_drawings (
      id, project_id, stellage_id, module_rack_key, source_type, title, rack_type,
      frame_config_json, pdf_url, pdf_filename, file_id,
      is_client_visible, version, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, ?, ?, 'nft', '{}', ?, ?, ?, ?, 1, ?, ?)
  `).run(
    drawingId,
    projectId,
    stellageId,
    sourceType,
    title,
    `/uploads/frame-drawings/${projectId}/${drawingId}.pdf`,
    `${drawingId}.pdf`,
    fileId,
    visible ? 1 : 0,
    now,
    now,
  );
}

beforeEach(() => {
  initDb();
  db.prepare('DELETE FROM files').run();
  db.prepare('DELETE FROM frame_drawings').run();
  db.prepare('DELETE FROM projects').run();
  seedProject();
});

describe('getClientProjectDocuments', () => {
  it('includes visible frame_drawing with /uploads URL (not admin API)', () => {
    const fileId = syncDrawingFilesVisibility({
      projectId: 'proj1',
      isClientVisible: true,
      pdfFilename: 'rack.pdf',
      pdfUrl: '/uploads/frame-drawings/proj1/d1.pdf',
      title: 'NFT rack',
    });
    insertDrawingWithFile({ drawingId: 'd1', fileId, visible: true, title: 'NFT rack' });

    const docs = getClientProjectDocuments('proj1');
    expect(docs).toHaveLength(1);
    expect(docs[0].type).toBe('frame_drawing');
    expect(docs[0].url).toMatch(/^\/uploads\//);
    expect(docs[0].url).not.toContain('/api/frame-drawings');
    expect(docs[0].drawingTitle).toBe('NFT rack');
    expect(docs[0].stellageId).toBe('st_1');
    expect(docs[0].drawingSourceType).toBe('project_stellage');
  });

  it('excludes hidden frame_drawing even if stale files row exists', () => {
    const fileId = insertFile({
      id: 'stale-file',
      type: 'frame_drawing',
      filename: 'hidden.pdf',
      url: '/uploads/frame-drawings/proj1/hidden.pdf',
    });
    insertDrawingWithFile({ drawingId: 'hidden', fileId, visible: false });

    const docs = getClientProjectDocuments('proj1');
    expect(docs).toHaveLength(0);
  });

  it('includes non-frame documents regardless of frame_drawings', () => {
    insertFile({ id: 'plan', type: 'pdf', filename: 'plan.pdf', url: '/uploads/plan.pdf' });

    const docs = getClientProjectDocuments('proj1');
    expect(docs).toHaveLength(1);
    expect(docs[0].filename).toBe('plan.pdf');
  });

  it('returns only documents for the requested project', () => {
    insertFile({ id: 'p1-doc', project_id: 'proj1', filename: 'a.pdf' });
    seedProject('proj2');
    insertFile({ id: 'p2-doc', project_id: 'proj2', filename: 'b.pdf' });

    const docs = getClientProjectDocuments('proj1');
    expect(docs).toHaveLength(1);
    expect(docs[0].filename).toBe('a.pdf');
  });

  it('excludes frame_drawing without frame_drawings link', () => {
    insertFile({
      id: 'orphan',
      type: 'frame_drawing',
      filename: 'orphan.pdf',
      url: '/uploads/frame-drawings/proj1/orphan.pdf',
    });

    const docs = getClientProjectDocuments('proj1');
    expect(docs).toHaveLength(0);
  });
});
