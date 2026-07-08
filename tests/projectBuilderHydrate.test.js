import { describe, it, expect } from 'vitest';
import {
  stellagesFromProject,
  stellagesForProjectSave,
  hydrateBuilderFromProject,
  validateStellageForFrameDrawing,
  projectItemToBuilderLine,
} from '../src/lib/projectBuilderHydrate.js';
import {
  buildBuilderEditStellagesPath,
  buildBuilderFrameDrawingContext,
  buildFrameDrawingLink,
  buildStellagesReturnLabel,
  isBuilderWizardReturnPath,
  resolveFramePdfExportUi,
  STANDALONE_FRAME_SAVE_HINT,
} from '../shared/frameDrawingContext.js';

describe('projectBuilderHydrate', () => {
  const project = {
    id: 'p1',
    name: 'Тестовая ферма',
    type: 'проточка',
    client: 'Клиент',
    items: [
      {
        id: 'st1__ln1',
        materialId: 'm1',
        name: 'Труба',
        unit: 'м',
        qty: 20,
        section: 'Стеллаж 1',
        module: 'Стеллаж 1',
        includedInProject: true,
        enabled: true,
      },
    ],
    stellageConfigs: [
      {
        id: 'st1',
        name: 'Стеллаж 1',
        count: 2,
        moduleId: 'mod1',
        moduleName: 'NFT',
      },
    ],
    rooms: [],
    manualParams: {},
  };

  it('hydrates stellages from saved project items', () => {
    const stellages = stellagesFromProject(project);
    expect(stellages).toHaveLength(1);
    expect(stellages[0].id).toBe('st1');
    expect(stellages[0].items[0].qty).toBe(10);
    expect(stellages[0].items[0].included).toBe(true);
  });

  it('includes current draft in save payload list', () => {
    const draft = {
      id: 'st2',
      name: 'Стеллаж 2',
      moduleId: 'mod1',
      moduleName: 'NFT',
      items: [{ id: 'ln2', name: 'Краб', included: true, qty: 4 }],
    };
    const merged = stellagesForProjectSave(stellagesFromProject(project), draft);
    expect(merged).toHaveLength(2);
    expect(merged[1].id).toBe('st2');
  });

  it('validates stellage before frame drawing', () => {
    expect(validateStellageForFrameDrawing({ name: '', items: [] })).toMatch(/название/i);
    expect(validateStellageForFrameDrawing({
      name: 'A',
      items: [{ name: 'X', included: true, qty: 1 }],
    })).toBe('');
  });

  it('hydrates builder form from project', () => {
    const hydrated = hydrateBuilderFromProject(project);
    expect(hydrated.form.name).toBe('Тестовая ферма');
    expect(hydrated.stellages[0].name).toBe('Стеллаж 1');
  });

  it('projectItemToBuilderLine divides qty by stellage count', () => {
    const line = projectItemToBuilderLine({ id: 'st1__ln1', name: 'A', qty: 6 }, { stCount: 3 });
    expect(line.qty).toBe(2);
  });
});

describe('builder frame drawing wizard flow', () => {
  it('builds builder edit return path', () => {
    expect(buildBuilderEditStellagesPath('p1')).toBe('/new?projectId=p1&step=stellages');
    expect(isBuilderWizardReturnPath('/new?projectId=p1&step=stellages')).toBe(true);
    expect(buildStellagesReturnLabel('/new?projectId=p1&step=stellages')).toBe('Вернуться к настройке проекта');
  });

  it('saved project frame drawing link uses builder returnTo', () => {
    const ctx = buildBuilderFrameDrawingContext({
      projectId: 'p1',
      projectName: 'Farm',
      stellage: { id: 'st1', moduleId: 'mod1', name: 'Стеллаж 1' },
    });
    const link = buildFrameDrawingLink(ctx);
    expect(link).toContain('projectId=p1');
    expect(link).toContain('moduleRackKey=mod1%3Ast1');
    expect(link).toContain('returnTo=%2Fnew%3FprojectId%3Dp1%26step%3Dstellages');
    expect(ctx.returnTo).toBe('/new?projectId=p1&step=stellages');
  });

  it('resolveFramePdfExportUi shows builder return label target', () => {
    const ui = resolveFramePdfExportUi({
      projectId: 'p1',
      returnTo: '/new?projectId=p1&step=stellages',
    }, { canSavePdfAndBom: true });
    expect(ui.showReturnToProjectSetup).toBe(true);
    expect(ui.showStandaloneSaveHint).toBe(false);
    const standalone = resolveFramePdfExportUi({ moduleId: 'm1', moduleRackKey: 'm1:st1' });
    expect(standalone.showSavePdfButton).toBe(false);
    expect(standalone.showStandaloneSaveHint).toBe(true);
    expect(STANDALONE_FRAME_SAVE_HINT).toMatch(/мастер настройки проекта/);
  });
});
