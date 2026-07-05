import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db, initDb } from '../backend/src/db.js';
import {
  rowToDrawing,
  syncDrawingFilesVisibility,
  removeDrawingFilesRow,
  isFrameDrawingUploadPath,
  safeDeleteFrameDrawingPdf,
} from '../backend/src/routes/frameDrawings.js';

let seedCounter = 0;

function seedProject(id = 'proj1') {
  seedCounter += 1;
  db.prepare(`
    INSERT INTO projects (id, name, client_token)
    VALUES (?, 'Test project', ?)
  `).run(id, `token-${id}-${seedCounter}`);
}

function insertDrawing(overrides = {}) {
  const id = overrides.id || 'fd1';
  const projectId = overrides.project_id ?? 'proj1';
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO frame_drawings (
      id, project_id, module_id, stellage_id, preset_id, source_type,
      title, rack_type, frame_config_json, pdf_url, pdf_filename, file_id,
      is_client_visible, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    projectId,
    overrides.module_id ?? null,
    overrides.stellage_id ?? null,
    overrides.preset_id ?? null,
    overrides.source_type ?? 'project_rack',
    overrides.title ?? 'Test drawing',
    overrides.rack_type ?? 'nft',
    overrides.frame_config_json ?? '{"lengthMm":3000}',
    overrides.pdf_url ?? '/uploads/frame-drawings/proj1/fd1.pdf',
    overrides.pdf_filename ?? 'test.pdf',
    overrides.file_id ?? null,
    overrides.is_client_visible ?? 1,
    overrides.version ?? 1,
    now,
    now,
  );
  return id;
}

beforeEach(() => {
  initDb();
  db.prepare('DELETE FROM files').run();
  db.prepare('DELETE FROM frame_drawings').run();
  db.prepare('DELETE FROM projects').run();
  seedProject();
});

describe('frame_drawings db', () => {
  it('rowToDrawing maps snake_case row to API shape', () => {
    insertDrawing({ id: 'd1', stellage_id: 'st_1', title: 'NFT 3m' });
    const row = db.prepare('SELECT * FROM frame_drawings WHERE id = ?').get('d1');
    const drawing = rowToDrawing(row);
    expect(drawing.id).toBe('d1');
    expect(drawing.projectId).toBe('proj1');
    expect(drawing.stellageId).toBe('st_1');
    expect(drawing.frameConfig.lengthMm).toBe(3000);
    expect(drawing.isClientVisible).toBe(true);
  });

  it('lists drawings by project_id', () => {
    insertDrawing({ id: 'a', stellage_id: 'st_a' });
    insertDrawing({ id: 'b', stellage_id: 'st_b' });
    seedProject('other');
    insertDrawing({ id: 'c', project_id: 'other', stellage_id: 'st_c' });

    const rows = db
      .prepare('SELECT * FROM frame_drawings WHERE project_id = ? ORDER BY id')
      .all('proj1');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('finds duplicate project_id + stellage_id', () => {
    insertDrawing({ id: 'first', stellage_id: 'st_dup' });
    const dup = db
      .prepare('SELECT id FROM frame_drawings WHERE project_id = ? AND stellage_id = ?')
      .get('proj1', 'st_dup');
    expect(dup.id).toBe('first');
  });

  it('creates files row for client-visible project drawing', () => {
    const fileId = syncDrawingFilesVisibility({
      projectId: 'proj1',
      isClientVisible: true,
      pdfFilename: 'rack.pdf',
      pdfUrl: '/uploads/frame-drawings/proj1/fd1.pdf',
      title: 'NFT rack',
    });
    expect(fileId).toBeTruthy();

    const docs = db
      .prepare("SELECT id, type, filename, url FROM files WHERE project_id = ? AND type = 'frame_drawing'")
      .all('proj1');
    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe(fileId);
    expect(docs[0].filename).toBe('rack.pdf');
    expect(docs[0].url).toBe('/uploads/frame-drawings/proj1/fd1.pdf');
  });

  it('hidden drawing does not create files row', () => {
    const fileId = syncDrawingFilesVisibility({
      projectId: 'proj1',
      isClientVisible: false,
      pdfFilename: 'hidden.pdf',
      pdfUrl: '/uploads/frame-drawings/proj1/hidden.pdf',
      title: 'Hidden',
    });
    expect(fileId).toBeNull();

    const clientDocs = db
      .prepare("SELECT * FROM files WHERE project_id = ? AND type = 'frame_drawing'")
      .all('proj1');
    expect(clientDocs).toHaveLength(0);
  });

  it('PATCH true→false removes files row', () => {
    const fileId = syncDrawingFilesVisibility({
      projectId: 'proj1',
      isClientVisible: true,
      pdfFilename: 'visible.pdf',
      pdfUrl: '/uploads/frame-drawings/proj1/v.pdf',
      title: 'Visible',
    });
    expect(db.prepare('SELECT id FROM files WHERE id = ?').get(fileId)).toBeTruthy();

    const nextFileId = syncDrawingFilesVisibility({
      projectId: 'proj1',
      isClientVisible: false,
      fileId,
      pdfFilename: 'visible.pdf',
      pdfUrl: '/uploads/frame-drawings/proj1/v.pdf',
      title: 'Visible',
    });
    expect(nextFileId).toBeNull();
    expect(db.prepare('SELECT id FROM files WHERE id = ?').get(fileId)).toBeUndefined();
  });

  it('PATCH false→true creates files row', () => {
    insertDrawing({ id: 'hidden2', is_client_visible: 0, file_id: null });

    const fileId = syncDrawingFilesVisibility({
      projectId: 'proj1',
      isClientVisible: true,
      fileId: null,
      pdfFilename: 'now-visible.pdf',
      pdfUrl: '/uploads/frame-drawings/proj1/hidden2.pdf',
      title: 'Now visible',
    });
    expect(fileId).toBeTruthy();
    expect(db.prepare('SELECT filename FROM files WHERE id = ?').get(fileId).filename).toBe('now-visible.pdf');
  });

  it('sync updates files when title or pdf path changes', () => {
    const fileId = syncDrawingFilesVisibility({
      projectId: 'proj1',
      isClientVisible: true,
      pdfFilename: 'old.pdf',
      pdfUrl: '/uploads/frame-drawings/proj1/old.pdf',
      title: 'Old title',
    });

    syncDrawingFilesVisibility({
      projectId: 'proj1',
      isClientVisible: true,
      fileId,
      pdfFilename: 'new.pdf',
      pdfUrl: '/uploads/frame-drawings/proj1/new.pdf',
      title: 'New title',
    });

    const file = db.prepare('SELECT filename, url FROM files WHERE id = ?').get(fileId);
    expect(file.filename).toBe('new.pdf');
    expect(file.url).toBe('/uploads/frame-drawings/proj1/new.pdf');
  });

  it('DELETE removes files row', () => {
    const fileId = syncDrawingFilesVisibility({
      projectId: 'proj1',
      isClientVisible: true,
      pdfFilename: 'del.pdf',
      pdfUrl: '/uploads/frame-drawings/proj1/del.pdf',
      title: 'Delete me',
    });
    insertDrawing({ id: 'del1', file_id: fileId });

    removeDrawingFilesRow(fileId);
    db.prepare('DELETE FROM frame_drawings WHERE id = ?').run('del1');

    expect(db.prepare('SELECT id FROM frame_drawings WHERE id = ?').get('del1')).toBeUndefined();
    expect(db.prepare('SELECT id FROM files WHERE id = ?').get(fileId)).toBeUndefined();
  });

  it('isFrameDrawingUploadPath accepts only frame-drawings paths', () => {
    expect(isFrameDrawingUploadPath('/uploads/frame-drawings/proj1/x.pdf')).toBe(true);
    expect(isFrameDrawingUploadPath('/uploads/other/x.pdf')).toBe(false);
  });

  it('safeDeleteFrameDrawingPdf removes file under frame-drawings only', () => {
    const testDir = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../backend/uploads/frame-drawings/test-proj',
    );
    const absPath = path.join(testDir, 'test-del.pdf');
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(absPath, '%PDF-test');

    safeDeleteFrameDrawingPdf('/uploads/frame-drawings/test-proj/test-del.pdf');
    expect(fs.existsSync(absPath)).toBe(false);

    safeDeleteFrameDrawingPdf('/uploads/other/not-frame.pdf');
  });

  it('filters preset drawings by preset_id', () => {
    insertDrawing({ id: 'pr1', project_id: null, preset_id: 'preset_a', source_type: 'preset' });
    insertDrawing({ id: 'pr2', project_id: null, preset_id: 'preset_b', source_type: 'preset' });

    const rows = db
      .prepare('SELECT * FROM frame_drawings WHERE preset_id = ?')
      .all('preset_a');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('pr1');
  });
});
