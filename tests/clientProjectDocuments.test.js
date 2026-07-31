import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const testId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tempDir = path.join(os.tmpdir(), `daogreen-test-${testId}`);
const tempDbPath = path.join(tempDir, 'daogreen-test.db');

let db;
let initDb;
let getDbPath;
let getClientProjectDocuments;
let syncDrawingFilesVisibility;
let seedCounter = 0;

function seedProject(id = 'proj1', { stellageConfigs = [{ id: 'st_1', name: 'Rack 1' }] } = {}) {
  seedCounter += 1;
  db.prepare(`
    INSERT INTO projects (id, name, client_token, stellage_configs)
    VALUES (?, 'Test project', ?, ?)
  `).run(id, `token-${id}-${seedCounter}`, JSON.stringify(stellageConfigs));
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
  frameConfigJson = '{}',
  version = 1,
  updatedAt = null,
}) {
  const now = updatedAt || new Date().toISOString();
  const configJson = typeof frameConfigJson === 'string'
    ? frameConfigJson
    : JSON.stringify(frameConfigJson);
  db.prepare(`
    INSERT INTO frame_drawings (
      id, project_id, stellage_id, module_rack_key, source_type, title, rack_type,
      frame_config_json, pdf_url, pdf_filename, file_id,
      is_client_visible, version, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, ?, ?, 'nft', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    drawingId,
    projectId,
    stellageId,
    sourceType,
    title,
    configJson,
    `/uploads/frame-drawings/${projectId}/${drawingId}.pdf`,
    `${drawingId}.pdf`,
    fileId,
    visible ? 1 : 0,
    version,
    now,
    now,
  );
}

beforeAll(async () => {
  fs.mkdirSync(tempDir, { recursive: true });
  process.env.DATABASE_PATH = tempDbPath;
  process.env.DB_PATH = tempDbPath;
  process.env.NODE_ENV = 'test';
  vi.resetModules();
  const dbMod = await import('../backend/src/db.js');
  const projectsMod = await import('../backend/src/routes/projects.js');
  const frameMod = await import('../backend/src/routes/frameDrawings.js');
  db = dbMod.db;
  initDb = dbMod.initDb;
  getDbPath = dbMod.getDbPath;
  getClientProjectDocuments = projectsMod.getClientProjectDocuments;
  syncDrawingFilesVisibility = frameMod.syncDrawingFilesVisibility;
  initDb();
});

beforeEach(() => {
  seedCounter = 0;
  db.prepare('DELETE FROM files').run();
  db.prepare('DELETE FROM frame_drawings').run();
  db.prepare('DELETE FROM projects').run();
  seedProject();
});

afterAll(() => {
  delete process.env.DATABASE_PATH;
  delete process.env.DB_PATH;
  vi.resetModules();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(tempDbPath + suffix);
    } catch {
      /* ignore */
    }
  }
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('getClientProjectDocuments', () => {
  it('returns only the latest visible frame drawing version for one stellage', () => {
    const oldFileId = insertFile({ id: 'old-file', type: 'frame_drawing', url: '/uploads/frame-drawings/proj1/old.pdf' });
    const newFileId = insertFile({ id: 'new-file', type: 'frame_drawing', url: '/uploads/frame-drawings/proj1/new.pdf' });
    insertDrawingWithFile({
      drawingId: 'old-drawing', fileId: oldFileId, stellageId: 'st_1', version: 1,
      updatedAt: '2026-07-16T10:00:00.000Z',
    });
    insertDrawingWithFile({
      drawingId: 'new-drawing', fileId: newFileId, stellageId: 'st_1', version: 2,
      updatedAt: '2026-07-17T10:00:00.000Z',
    });

    const docs = getClientProjectDocuments('proj1');

    expect(docs).toHaveLength(1);
    expect(docs[0].url).toBe('/uploads/frame-drawings/proj1/new.pdf');
    expect(docs[0].drawingVersion).toBe(2);
  });

  it('collapses split moduleRackKey/stellageId targets to one latest drawing', () => {
    const oldFileId = insertFile({ id: 'split-old', type: 'frame_drawing', url: '/uploads/frame-drawings/proj1/split-old.pdf' });
    const newFileId = insertFile({ id: 'split-new', type: 'frame_drawing', url: '/uploads/frame-drawings/proj1/split-new.pdf' });
    insertDrawingWithFile({
      drawingId: 'split-old-d',
      fileId: oldFileId,
      stellageId: 'st_1',
      version: 1,
      updatedAt: '2026-07-16T10:00:00.000Z',
    });
    db.prepare(`
      UPDATE frame_drawings SET module_rack_key = NULL WHERE id = ?
    `).run('split-old-d');
    insertDrawingWithFile({
      drawingId: 'split-new-d',
      fileId: newFileId,
      stellageId: 'st_1',
      version: 2,
      updatedAt: '2026-07-17T10:00:00.000Z',
    });
    db.prepare(`
      UPDATE frame_drawings SET module_rack_key = ? WHERE id = ?
    `).run('stellage:st_1', 'split-new-d');

    const docs = getClientProjectDocuments('proj1');
    const frames = docs.filter((d) => d.type === 'frame_drawing');
    expect(frames).toHaveLength(1);
    expect(frames[0].url).toBe('/uploads/frame-drawings/proj1/split-new.pdf');
  });

  it('excludes frame drawings bound to deleted stellages', () => {
    const liveFile = insertFile({ id: 'live-f', type: 'frame_drawing', url: '/uploads/frame-drawings/proj1/live.pdf' });
    const orphanFile = insertFile({ id: 'orphan-f', type: 'frame_drawing', url: '/uploads/frame-drawings/proj1/orphan.pdf' });
    insertDrawingWithFile({ drawingId: 'live-d', fileId: liveFile, stellageId: 'st_1', version: 1 });
    insertDrawingWithFile({ drawingId: 'orphan-d', fileId: orphanFile, stellageId: 'st_gone', version: 5 });

    const docs = getClientProjectDocuments('proj1');
    const frames = docs.filter((d) => d.type === 'frame_drawing');
    expect(frames).toHaveLength(1);
    expect(frames[0].stellageId).toBe('st_1');
  });

  it('uses isolated temp database, not production file', () => {
    expect(getDbPath()).toBe(tempDbPath);
    expect(getDbPath()).not.toMatch(/backend[\\/]data[\\/]daogreen\.db$/);
  });

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
    expect(docs[0].drawingTitle).toBe('Rack 1');
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

  it('keeps visible frame_drawing PDF when frame_config_json has constructionType', () => {
    db.prepare(`UPDATE projects SET stellage_configs = ? WHERE id = ?`).run(
      JSON.stringify([{ id: 'st_angle', name: 'Angle' }]),
      'proj1',
    );
    const fileId = syncDrawingFilesVisibility({
      projectId: 'proj1',
      isClientVisible: true,
      pdfFilename: 'angle-rack.pdf',
      pdfUrl: '/uploads/frame-drawings/proj1/angle-doc.pdf',
      title: 'Angle rack PDF',
    });
    insertDrawingWithFile({
      drawingId: 'angle_doc',
      fileId,
      visible: true,
      stellageId: 'st_angle',
      title: 'Angle rack PDF',
      frameConfigJson: {
        constructionType: 'perforated_angle',
        angleProfile: '30×30',
        angleStockLengthsMm: [2000, 2500],
        angleOverlapMm: 150,
        crossBeamFasteningMode: 'bolts_only',
      },
    });

    const docs = getClientProjectDocuments('proj1');
    expect(docs).toHaveLength(1);
    expect(docs[0].type).toBe('frame_drawing');
    expect(docs[0].url).toBe('/uploads/frame-drawings/proj1/angle-doc.pdf');
    expect(docs[0].filename).toBe('angle-rack.pdf');
    expect(docs[0].drawingTitle).toBe('Angle');
    expect(docs[0].frameConfig).toBeUndefined();
  });

  it('keeps both tube and angle frame drawings visible for the same project', () => {
    db.prepare(`UPDATE projects SET stellage_configs = ? WHERE id = ?`).run(
      JSON.stringify([
        { id: 'st_tube', name: 'Tube' },
        { id: 'st_angle', name: 'Angle' },
      ]),
      'proj1',
    );
    const tubeFileId = syncDrawingFilesVisibility({
      projectId: 'proj1',
      isClientVisible: true,
      pdfFilename: 'tube.pdf',
      pdfUrl: '/uploads/frame-drawings/proj1/tube.pdf',
      title: 'Tube rack',
    });
    const angleFileId = syncDrawingFilesVisibility({
      projectId: 'proj1',
      isClientVisible: true,
      pdfFilename: 'angle.pdf',
      pdfUrl: '/uploads/frame-drawings/proj1/angle.pdf',
      title: 'Angle rack',
    });
    insertDrawingWithFile({
      drawingId: 'doc_tube',
      fileId: tubeFileId,
      stellageId: 'st_tube',
      title: 'Tube rack',
      frameConfigJson: { constructionType: 'tube_crab', connectionType: 'crab' },
    });
    insertDrawingWithFile({
      drawingId: 'doc_angle',
      fileId: angleFileId,
      stellageId: 'st_angle',
      title: 'Angle rack',
      frameConfigJson: { constructionType: 'perforated_angle', angleProfile: '30×30' },
    });

    const docs = getClientProjectDocuments('proj1');
    expect(docs).toHaveLength(2);
    const urls = docs.map((d) => d.url).sort();
    expect(urls).toEqual([
      '/uploads/frame-drawings/proj1/angle.pdf',
      '/uploads/frame-drawings/proj1/tube.pdf',
    ]);
    expect(docs.every((d) => d.type === 'frame_drawing')).toBe(true);
    expect(docs.every((d) => d.frameConfig === undefined)).toBe(true);
  });
});
