import { describe, it, expect } from 'vitest';
import {
  stellagesFromProject,
  stellagesForProjectSave,
  shouldPersistStellageDraft,
  isMeaningfulRackDraft,
  hydrateBuilderFromProject,
  validateStellageForFrameDrawing,
  projectItemToBuilderLine,
  mergeStellageBuilderLines,
  mergeStellageEditorLines,
  findStellageByEditRack,
  preserveFrameBomProjectItems,
  mergeFrameBomQtyFromBuilderLines,
  frameBomProjectItemToBuilderLine,
  FRAME_BOM_SOURCE_LABEL,
  farmSectionLinesFromProject,
} from '../src/lib/projectBuilderHydrate.js';
import { hydrateCatalogEditorLine } from '../src/lib/specLineCore.js';
import { syncFastenersFromCrabs } from '../shared/fastenerRules.js';
import {
  buildBuilderEditStellagesPath,
  buildBuilderFrameDrawingContext,
  buildFrameDrawingLink,
  buildStellagesReturnLabel,
  isBuilderWizardReturnPath,
  resolveFramePdfExportUi,
  STANDALONE_FRAME_SAVE_HINT,
} from '../shared/frameDrawingContext.js';
import { FRAME_BOM_SOURCE, mergeFrameBomIntoProjectItems } from '../shared/frameBomProjectItems.js';

describe('projectBuilderHydrate', () => {
  it('keeps farm-wide project price and links marked as overrides after reload', () => {
    const materials = [{
      id: 'm-farm',
      name: 'Расходник',
      unit: 'шт.',
      basePrice: 100,
      link: 'https://catalog.example/item',
      linkAlt: 'https://catalog.example/item-alt',
    }];
    const sections = [{ id: 'farm-sec', name: 'Расходники запуска' }];
    const farmCatalogs = {
      'farm-sec': [{ materialId: 'm-farm', qty: 1, included: true }],
    };
    const project = {
      items: [{
        id: 'farm-item',
        materialId: 'm-farm',
        name: 'Расходник',
        unit: 'шт.',
        section: 'Расходники запуска',
        module: 'Расходники запуска',
        qty: 3,
        price: 125,
        link: 'https://project.example/item',
        linkAlt: 'https://project.example/item-alt',
        includedInProject: true,
        enabled: true,
      }],
      stellageConfigs: [],
    };

    const [line] = farmSectionLinesFromProject(project, sections, farmCatalogs, materials)['farm-sec'];
    expect(line).toMatchObject({
      price: 125,
      priceOverridden: true,
      link: 'https://project.example/item',
      linkOverridden: true,
      linkAlt: 'https://project.example/item-alt',
      linkAltOverridden: true,
    });
    expect(materials[0].basePrice).toBe(100);
  });

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

  const stellageCatalogs = {
    mod1: [
      { id: 'ln1', materialId: 'm1', name: 'Труба', unit: 'м', qty: 5 },
      { id: 'ln2', materialId: 'm2', name: 'Краб', unit: 'шт.', qty: 4 },
      { id: 'ln3', materialId: 'm3', name: 'Муфта', unit: 'шт.', qty: 2 },
    ],
  };
  const materials = [
    { id: 'm1', name: 'Труба', unit: 'м', category: 'Прочее', basePrice: 80, supplier: 'ТрубыРу', link: 'https://tube', imageUrl: '/m1.jpg' },
    { id: 'm2', name: 'Краб', unit: 'шт.', category: 'Прочее', basePrice: 40, supplier: 'КрабыРу', photoUrl: '/m2.jpg' },
    { id: 'm3', name: 'Муфта', unit: 'шт.', category: 'Прочее' },
  ];

  it('hydrates stellages from saved project items', () => {
    const stellages = stellagesFromProject(project);
    expect(stellages).toHaveLength(1);
    expect(stellages[0].id).toBe('st1');
    expect(stellages[0].items[0].qty).toBe(10);
    expect(stellages[0].items[0].included).toBe(true);
  });

  it('merges full catalog with saved selections on hydrate', () => {
    const stellages = stellagesFromProject(project, { stellageCatalogs, materials });
    expect(stellages[0].items).toHaveLength(3);
    expect(stellages[0].items.find((ln) => ln.name === 'Труба')?.included).toBe(true);
    expect(stellages[0].items.find((ln) => ln.name === 'Краб')?.included).toBe(false);
    expect(stellages[0].items.find((ln) => ln.name === 'Муфта')?.included).toBe(false);
  });

  it('mergeStellageBuilderLines restores unchecked catalog lines', () => {
    const st = {
      id: 'st1',
      moduleId: 'mod1',
      moduleName: 'NFT',
      items: [{ id: 'ln1', materialId: 'm1', name: 'Труба', included: true, qty: 10 }],
    };
    const merged = mergeStellageBuilderLines(st, stellageCatalogs, materials);
    expect(merged).toHaveLength(3);
    expect(merged.find((ln) => ln.name === 'Краб')?.included).toBe(false);
  });

  it('does not persist empty auto-draft as a second rack', () => {
    const draft = {
      id: 'st2',
      name: 'Стеллаж 2',
      moduleId: 'mod1',
      moduleName: 'NFT',
      items: [{ id: 'ln2', name: 'Краб', included: false, qty: 4 }],
    };
    const merged = stellagesForProjectSave(stellagesFromProject(project), draft);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('st1');
  });

  it('editingExisting alone does not invent empty Стеллаж 2', () => {
    const emptyEditing = {
      id: 'st2',
      name: 'Стеллаж 2',
      moduleId: 'mod1',
      editingExisting: true,
      items: [{ id: 'ln2', name: 'Краб', included: false, qty: 4 }],
    };
    expect(isMeaningfulRackDraft(emptyEditing)).toBe(false);
    expect(shouldPersistStellageDraft(emptyEditing, [{ id: 'st1' }])).toBe(false);
    expect(stellagesForProjectSave(stellagesFromProject(project), emptyEditing)).toHaveLength(1);
  });

  it('persists draft with included lines or wasInProjectList checkout', () => {
    const withIncluded = {
      id: 'st2',
      name: 'Стеллаж 2',
      moduleId: 'mod1',
      items: [{ id: 'ln2', name: 'Краб', included: true, qty: 4 }],
    };
    expect(isMeaningfulRackDraft(withIncluded)).toBe(true);
    expect(stellagesForProjectSave(stellagesFromProject(project), withIncluded)).toHaveLength(2);

    const editing = {
      id: 'st1',
      name: 'Стеллаж 1',
      moduleId: 'mod1',
      editingExisting: true,
      wasInProjectList: true,
      items: [{ id: 'ln1', name: 'Труба', included: false, qty: 1 }],
    };
    const mergedEdit = stellagesForProjectSave([], editing);
    expect(mergedEdit).toHaveLength(1);
    expect(mergedEdit[0].id).toBe('st1');
    expect(mergedEdit[0].editingExisting).toBeUndefined();
    expect(mergedEdit[0].wasInProjectList).toBeUndefined();
  });

  it('forcePersistForFrame saves rack opened for scheme even without included lines', () => {
    const draft = {
      id: 'st2',
      name: 'Стеллаж 2',
      moduleId: 'mod1',
      forcePersistForFrame: true,
      hasFrameDrawing: true,
      items: [{ id: 'ln2', name: 'Краб', included: false, qty: 4 }],
    };
    expect(isMeaningfulRackDraft(draft)).toBe(true);
    const merged = stellagesForProjectSave([], draft);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('st2');
    expect(merged[0].forcePersistForFrame).toBeUndefined();
  });

  it('validates stellage before frame drawing without requiring selected items', () => {
    expect(validateStellageForFrameDrawing({ name: '', items: [] })).toMatch(/название/i);
    expect(validateStellageForFrameDrawing({
      name: 'A',
      items: [],
    })).toBe('');
    expect(validateStellageForFrameDrawing({
      name: 'A',
      items: [{ name: 'X', included: true, qty: 0 }],
    })).toMatch(/количество/i);
  });

  it('hydrates builder form from project', () => {
    const hydrated = hydrateBuilderFromProject(project);
    expect(hydrated.form.name).toBe('Тестовая ферма');
    expect(hydrated.stellages[0].name).toBe('Стеллаж 1');
  });

  it('keeps explicit empty rooms array (no default rooms invent)', () => {
    const hydrated = hydrateBuilderFromProject({
      ...project,
      rooms: [],
      stellageConfigs: [],
      items: [],
    });
    expect(hydrated.rooms).toEqual([]);
    expect(hydrated.stellages).toEqual([]);
  });

  it('projectItemToBuilderLine divides qty by stellage count', () => {
    const line = projectItemToBuilderLine({ id: 'st1__ln1', name: 'A', qty: 6 }, { stCount: 3 });
    expect(line.qty).toBe(2);
  });

  it('infers project-local price and link overrides from the catalog snapshot', () => {
    const materials = [{ id: 'm1', basePrice: 100, link: 'https://catalog.example/a', linkAlt: '' }];
    const line = projectItemToBuilderLine({
      id: 'st1__ln1', materialId: 'm1', name: 'A', qty: 1, price: 85,
      link: 'https://project.example/a', linkAlt: 'https://project.example/alt',
    }, { materials });
    expect(line.priceOverridden).toBe(true);
    expect(line.linkOverridden).toBe(true);
    expect(line.linkAltOverridden).toBe(true);
  });

  it('does not mark catalog values as project overrides after reset', () => {
    const materials = [{ id: 'm1', basePrice: 100, link: 'https://catalog.example/a', linkAlt: 'https://catalog.example/alt' }];
    const line = projectItemToBuilderLine({
      id: 'st1__ln1', materialId: 'm1', name: 'A', qty: 1, price: 100,
      link: 'https://catalog.example/a', linkAlt: 'https://catalog.example/alt',
    }, { materials });
    expect(line.priceOverridden).toBe(false);
    expect(line.linkOverridden).toBe(false);
    expect(line.linkAltOverridden).toBe(false);
  });

  it('findStellageByEditRack matches rack id or moduleRackKey', () => {
    const stellages = [{ id: 'st1', moduleId: 'mod1', name: 'A' }];
    expect(findStellageByEditRack(stellages, 'st1')?.id).toBe('st1');
    expect(findStellageByEditRack(stellages, 'mod1:st1')?.id).toBe('st1');
  });

  it('preserveFrameBomProjectItems keeps legacy frame BOM rows without source field', () => {
    const builderItems = [{ id: 'st1__ln1', name: 'Труба' }];
    const loadedItems = [
      ...builderItems,
      {
        id: 'it_fbom_legacy',
        sourceKey: 'frame_bom:d1:mod1:st1:profile_tube_20x20',
        sourceObjectIds: { moduleRackKey: 'mod1:st1', bomKey: 'profile_tube_20x20' },
        pipeCuts: [{ lengthMm: 1000, qty: 2 }],
        name: 'BOM tube',
      },
    ];
    const merged = preserveFrameBomProjectItems(builderItems, loadedItems);
    expect(merged).toHaveLength(2);
    expect(merged[1].id).toBe('it_fbom_legacy');
  });

  it('preserveFrameBomProjectItems keeps frame_bom lines on builder save', () => {
    const builderItems = [{ id: 'st1__ln1', name: 'Труба' }];
    const loadedItems = [
      ...builderItems,
      { id: 'fbom1', source: FRAME_BOM_SOURCE, name: 'BOM tube' },
    ];
    const merged = preserveFrameBomProjectItems(builderItems, loadedItems);
    expect(merged).toHaveLength(2);
    expect(merged[1].source).toBe(FRAME_BOM_SOURCE);
  });

  it('frame_bom without catalog match is skipped when material missing from catalog', () => {
    const withBom = {
      ...project,
      items: [{
        id: 'fbom1',
        source: FRAME_BOM_SOURCE,
        sourceObjectIds: { moduleRackKey: 'mod1:st1' },
        section: 'Стеллаж 1',
        name: 'Болт М6×20',
        materialId: 'm073',
        qty: 10,
        includedInProject: true,
      }],
    };
    const catalogWithBolt = [
      ...materials,
      { id: 'm073', name: 'Болт М6×20', unit: 'шт.', basePrice: 5, supplier: 'Крепёж', link: 'https://bolt', imageUrl: '/bolt.jpg' },
    ];
    const stellages = stellagesFromProject(withBom, { stellageCatalogs: {}, materials: catalogWithBolt });
    const bolt = stellages[0].items.find((ln) => ln.materialId === 'm073');
    expect(bolt?.included).toBe(true);
    expect(bolt?.price).toBe(5);
    expect(bolt?.supplier).toBe('Крепёж');
    expect(bolt?.imageUrl).toBe('/bolt.jpg');

    const missing = stellagesFromProject(withBom, { stellageCatalogs: {}, materials });
    expect(missing[0].items.some((ln) => ln.materialId === 'm073')).toBe(false);
  });

  it('frame_bom items mark matching catalog rows checked with BOM qty and pipeCuts', () => {
    const withBom = {
      ...project,
      items: [
        {
          id: 'fbom_tube',
          source: FRAME_BOM_SOURCE,
          sourceType: FRAME_BOM_SOURCE,
          sourceKey: 'frame_bom:d1:mod1:st1:profile_tube_20x20',
          sourceObjectIds: { moduleRackKey: 'mod1:st1' },
          materialId: 'm1',
          name: 'Труба',
          unit: 'м',
          qty: 88.32,
          section: 'Стеллаж 1',
          pipeCuts: [{ lengthMm: 3200, qty: 6 }],
          includedInProject: true,
        },
        {
          id: 'fbom_crab',
          source: FRAME_BOM_SOURCE,
          sourceType: FRAME_BOM_SOURCE,
          sourceKey: 'frame_bom:d1:mod1:st1:crab_t',
          sourceObjectIds: { moduleRackKey: 'mod1:st1' },
          materialId: 'm2',
          name: 'Краб',
          unit: 'шт.',
          qty: 252,
          section: 'Стеллаж 1',
          includedInProject: true,
        },
      ],
    };
    const stellages = stellagesFromProject(withBom, { stellageCatalogs, materials });
    const tube = stellages[0].items.find((ln) => ln.materialId === 'm1');
    const crab = stellages[0].items.find((ln) => ln.materialId === 'm2');
    const unchecked = stellages[0].items.find((ln) => ln.materialId === 'm3');
    expect(tube?.included).toBe(true);
    expect(tube?.qty).toBe(88.32);
    expect(tube?.pipeCuts).toEqual([{ lengthMm: 3200, qty: 6 }]);
    expect(tube?.source).toBe(FRAME_BOM_SOURCE);
    expect(tube?.sourceLabel).toBe(FRAME_BOM_SOURCE_LABEL);
    expect(tube?.price).toBe(80);
    expect(tube?.supplier).toBe('ТрубыРу');
    expect(tube?.imageUrl).toBe('/m1.jpg');
    expect(crab?.included).toBe(true);
    expect(crab?.qty).toBe(252);
    expect(crab?.price).toBe(40);
    expect(crab?.photoUrl).toBe('/m2.jpg');
    expect(unchecked?.included).toBe(false);
    expect(stellages[0].items).toHaveLength(3);
  });

  it('frame_bom item not in catalog is not added as fake row', () => {
    const lines = mergeStellageEditorLines({
      catalogLines: [{ id: 'ln1', materialId: 'm1', name: 'Труба', unit: 'м', qty: 0 }],
      manualItems: [],
      frameBomItems: [{
        id: 'fbom_bolt',
        source: FRAME_BOM_SOURCE,
        materialId: 'm073',
        name: 'Болт М6×20',
        unit: 'шт.',
        qty: 312,
      }],
      materials,
    });
    expect(lines).toHaveLength(1);
    expect(lines.some((ln) => ln.materialId === 'm073')).toBe(false);
  });

  it('manual selected items and frame_bom items coexist without duplicate materialId', () => {
    const lines = mergeStellageEditorLines({
      catalogLines: [
        { id: 'ln1', materialId: 'm1', name: 'Труба', unit: 'м', qty: 5 },
        { id: 'ln3', materialId: 'm3', name: 'Муфта', unit: 'шт.', qty: 2 },
      ],
      manualItems: [{
        id: 'st1__ln3',
        materialId: 'm3',
        name: 'Муфта',
        qty: 4,
        includedInProject: true,
      }],
      frameBomItems: [{
        id: 'fbom_tube',
        source: FRAME_BOM_SOURCE,
        materialId: 'm1',
        name: 'Труба',
        qty: 20,
        pipeCuts: [{ lengthMm: 1000, qty: 2 }],
      }],
    });
    expect(lines.filter((ln) => ln.materialId === 'm1')).toHaveLength(1);
    expect(lines.find((ln) => ln.materialId === 'm1')?.included).toBe(true);
    expect(lines.find((ln) => ln.materialId === 'm1')?.qty).toBe(20);
    expect(lines.find((ln) => ln.materialId === 'm3')?.included).toBe(true);
    expect(lines.find((ln) => ln.materialId === 'm3')?.qty).toBe(4);
  });

  const fastenerMaterials = [
    { id: 'm073', name: 'Болт М6×20', unit: 'шт.', category: 'Каркас' },
    { id: 'm074', name: 'Гайка М6', unit: 'шт.', category: 'Каркас' },
    { id: 'm075', name: 'Шайба гроверная М6', unit: 'шт.', category: 'Каркас' },
    { id: 'm072', name: 'Краб-система Г-образная 20×20', unit: 'шт.', category: 'Каркас' },
    { id: 'm036', name: 'Труба профильная 20/20/1,5 мм', unit: 'м', category: 'Каркас' },
  ];

  const fastenerCatalog = [
    { id: 'ln_bolt', materialId: 'm073', qty: 22, defaultQty: 22 },
    { id: 'ln_nut', materialId: 'm074', qty: 22, defaultQty: 22 },
    { id: 'ln_washer', materialId: 'm075', qty: 22, defaultQty: 22 },
    { id: 'ln_crab', materialId: 'm072', qty: 4, defaultQty: 4 },
    { id: 'ln_tube', materialId: 'm036', qty: 10, defaultQty: 10 },
  ];

  function tableDisplayLines(lines, materials) {
    return syncFastenersFromCrabs(
      lines.map((ln) => hydrateCatalogEditorLine(ln, materials)),
      materials,
    );
  }

  it('frame_bom overlay sets qty and defaultQty for table display', () => {
    const frameBomItems = [
      { id: 'fb1', source: FRAME_BOM_SOURCE, materialId: 'm073', name: 'Болт М6×20', unit: 'шт.', qty: 312 },
      { id: 'fb2', source: FRAME_BOM_SOURCE, materialId: 'm074', name: 'Гайка М6', unit: 'шт.', qty: 312 },
      { id: 'fb3', source: FRAME_BOM_SOURCE, materialId: 'm075', name: 'Шайба гроверная М6', unit: 'шт.', qty: 312 },
    ];
    const merged = mergeStellageEditorLines({
      catalogLines: fastenerCatalog.slice(0, 3),
      manualItems: [],
      frameBomItems,
      materials: fastenerMaterials,
    });
    const displayed = tableDisplayLines(merged, fastenerMaterials);
    expect(displayed.find((ln) => ln.materialId === 'm073')?.qty).toBe(312);
    expect(displayed.find((ln) => ln.materialId === 'm074')?.qty).toBe(312);
    expect(displayed.find((ln) => ln.materialId === 'm075')?.qty).toBe(312);
    expect(merged.find((ln) => ln.materialId === 'm073')?.defaultQty).toBe(312);
  });

  it('BOM summary qty matches hydrated editor line qty after table hydrate', () => {
    const bomItem = {
      id: 'fb_bolt',
      source: FRAME_BOM_SOURCE,
      materialId: 'm073',
      name: 'Болт М6×20',
      unit: 'шт.',
      qty: 312,
    };
    const summaryQty = bomItem.qty;
    const merged = mergeStellageEditorLines({
      catalogLines: [fastenerCatalog[0]],
      manualItems: [],
      frameBomItems: [bomItem],
      materials: fastenerMaterials,
    });
    const displayed = tableDisplayLines(merged, fastenerMaterials)[0];
    expect(displayed.qty).toBe(summaryQty);
  });

  it('frame_bom m036 pipeCuts override template pipeCuts in editor', () => {
    const bomCuts = [
      { lengthMm: 3200, qty: 6 },
      { lengthMm: 1470, qty: 32 },
      { lengthMm: 460, qty: 48 },
    ];
    const merged = mergeStellageEditorLines({
      catalogLines: [fastenerCatalog[4]],
      manualItems: [],
      frameBomItems: [{
        id: 'fb_tube',
        source: FRAME_BOM_SOURCE,
        materialId: 'm036',
        name: 'Труба профильная 20/20/1,5 мм',
        unit: 'м',
        qty: 88.32,
        pipeCuts: bomCuts,
      }],
      materials: fastenerMaterials,
    });
    const displayed = hydrateCatalogEditorLine(merged[0], fastenerMaterials);
    expect(displayed.qty).toBe(88.32);
    expect(displayed.pipeCuts).toEqual(bomCuts);
  });

  it('syncFastenersFromCrabs does not override frame_bom fastener qty', () => {
    const lines = [
      { materialId: 'm072', name: 'Краб-система Г-образная', qty: 4, defaultQty: 4, included: true },
      {
        materialId: 'm073',
        name: 'Болт М6×20',
        qty: 312,
        defaultQty: 312,
        included: true,
        source: FRAME_BOM_SOURCE,
        sourceType: FRAME_BOM_SOURCE,
      },
    ];
    const out = syncFastenersFromCrabs(lines, fastenerMaterials);
    expect(out.find((ln) => ln.materialId === 'm073')?.qty).toBe(312);
  });

  it('mergeFrameBomQtyFromBuilderLines applies editor qty to preserved project items', () => {
    const rackKey = 'mod1:st1';
    const preserved = preserveFrameBomProjectItems(
      [{ id: 'st1__ln1', name: 'Труба' }],
      [{
        id: 'fb_bolt',
        source: FRAME_BOM_SOURCE,
        materialId: 'm073',
        moduleRackKey: rackKey,
        qty: 312,
      }],
    );
    const stellages = [{
      id: 'st1',
      moduleId: 'mod1',
      items: [{
        materialId: 'm073',
        qty: 400,
        source: FRAME_BOM_SOURCE,
        sourceType: FRAME_BOM_SOURCE,
        moduleRackKey: rackKey,
      }],
    }];
    const merged = mergeFrameBomQtyFromBuilderLines(preserved, stellages);
    expect(merged.find((it) => it.materialId === 'm073')?.qty).toBe(400);
  });

  it('mergeFrameBomQtyFromBuilderLines scopes qty by rack, not materialId only', () => {
    const st1Key = 'mod1:st1';
    const st2Key = 'mod1:st2';
    const items = [
      {
        id: 'fb_st1',
        materialId: 'm073',
        moduleRackKey: st1Key,
        source: FRAME_BOM_SOURCE,
        sourceType: FRAME_BOM_SOURCE,
        qty: 10,
        pipeCuts: ['1000', '2000'],
      },
      {
        id: 'fb_st2',
        materialId: 'm073',
        moduleRackKey: st2Key,
        source: FRAME_BOM_SOURCE,
        sourceType: FRAME_BOM_SOURCE,
        qty: 22,
        pipeCuts: ['3000', '4000'],
      },
    ];
    const stellages = [
      {
        id: 'st1',
        moduleId: 'mod1',
        items: [{
          materialId: 'm073',
          moduleRackKey: st1Key,
          source: FRAME_BOM_SOURCE,
          sourceType: FRAME_BOM_SOURCE,
          qty: 99,
          pipeCuts: ['1000', '2000'],
        }],
      },
      {
        id: 'st2',
        moduleId: 'mod1',
        items: [{
          materialId: 'm073',
          moduleRackKey: st2Key,
          source: FRAME_BOM_SOURCE,
          sourceType: FRAME_BOM_SOURCE,
          qty: 55,
          pipeCuts: ['3000', '4000'],
        }],
      },
    ];
    const merged = mergeFrameBomQtyFromBuilderLines(items, stellages);
    const st1 = merged.find((it) => it.id === 'fb_st1');
    const st2 = merged.find((it) => it.id === 'fb_st2');
    expect(st1?.qty).toBe(99);
    expect(st1?.pipeCuts).toEqual(['1000', '2000']);
    expect(st2?.qty).toBe(55);
    expect(st2?.pipeCuts).toEqual(['3000', '4000']);
  });

  it('mergeFrameBomQtyFromBuilderLines fail-closed when rack lineage missing', () => {
    const items = [{
      id: 'fb_amb',
      materialId: 'm073',
      source: FRAME_BOM_SOURCE,
      sourceType: FRAME_BOM_SOURCE,
      qty: 10,
      pipeCuts: ['1000'],
    }];
    const stellages = [{
      items: [{
        materialId: 'm073',
        source: FRAME_BOM_SOURCE,
        sourceType: FRAME_BOM_SOURCE,
        qty: 999,
        pipeCuts: ['9999'],
      }],
    }];
    const merged = mergeFrameBomQtyFromBuilderLines(items, stellages);
    expect(merged[0].qty).toBe(10);
    expect(merged[0].pipeCuts).toEqual(['1000']);
  });

  it('mergeFrameBomQtyFromBuilderLines keeps ordinary line when same materialId in frame BOM', () => {
    const rackKey = 'mod1:st1';
    const items = [
      {
        id: 'fb_pipe',
        materialId: 'm073',
        moduleRackKey: rackKey,
        source: FRAME_BOM_SOURCE,
        sourceType: FRAME_BOM_SOURCE,
        qty: 10,
      },
      {
        id: 'ord_pipe',
        materialId: 'm073',
        source: 'builder',
        qty: 3,
      },
    ];
    const stellages = [{
      id: 'st1',
      moduleId: 'mod1',
      items: [{
        materialId: 'm073',
        moduleRackKey: rackKey,
        source: FRAME_BOM_SOURCE,
        sourceType: FRAME_BOM_SOURCE,
        qty: 44,
      }],
    }];
    const merged = mergeFrameBomQtyFromBuilderLines(items, stellages);
    expect(merged.find((it) => it.id === 'fb_pipe')?.qty).toBe(44);
    expect(merged.find((it) => it.id === 'ord_pipe')?.qty).toBe(3);
  });

  it('frameBomProjectItemToBuilderLine sets defaultQty equal to BOM qty', () => {
    const line = frameBomProjectItemToBuilderLine({
      materialId: 'm073',
      name: 'Болт М6×20',
      qty: 312,
      unit: 'шт.',
    });
    expect(line.qty).toBe(312);
    expect(line.defaultQty).toBe(312);
  });

  it('after rack-scoped replace editor shows only latest BOM quantities', () => {
    const v1Items = mergeFrameBomIntoProjectItems([], [{
      key: 'crab_g',
      materialId: 'm072',
      name: 'Краб G',
      unit: 'шт.',
      qty: 100,
    }], {
      projectId: 'p1',
      drawingId: 'd_v1',
      moduleRackKey: 'mod1:st1',
      stellageId: 'st1',
    }).items;

    const v2Items = mergeFrameBomIntoProjectItems(v1Items, [{
      key: 'profile_tube_20x20',
      materialId: 'm036',
      name: 'Труба',
      unit: 'м',
      qty: 70,
    }], {
      projectId: 'p1',
      drawingId: 'd_v2',
      moduleRackKey: 'mod1:st1',
      stellageId: 'st1',
    }).items;

    const rackBom = v2Items.filter((it) => it.source === FRAME_BOM_SOURCE);
    expect(rackBom).toHaveLength(1);
    expect(rackBom[0].materialId).toBe('m036');
    expect(rackBom[0].qty).toBe(70);
    expect(v2Items.some((it) => it.materialId === 'm072')).toBe(false);

    const stellages = stellagesFromProject(
      { items: v2Items, stellageConfigs: [{ id: 'st1', moduleId: 'mod1', name: 'Стеллаж 1', count: 1 }] },
      {
        stellageCatalogs: {
          mod1: [
            { id: 'ln1', materialId: 'm036', name: 'Труба', unit: 'м', qty: 10, defaultQty: 10 },
            { id: 'ln2', materialId: 'm072', name: 'Краб', unit: 'шт.', qty: 4, defaultQty: 4 },
          ],
        },
        materials,
      },
    );
    const tube = stellages[0].items.find((ln) => ln.materialId === 'm036');
    const crab = stellages[0].items.find((ln) => ln.materialId === 'm072');
    expect(tube?.included).toBe(true);
    expect(tube?.qty).toBe(70);
    expect(crab?.included).toBeFalsy();
  });

  it('shouldPersistStellageDraft rejects blank auto draft', () => {
    expect(shouldPersistStellageDraft({
      id: 'st2',
      name: 'Стеллаж 2',
      items: [{ included: false }],
    }, [{ id: 'st1' }])).toBe(false);
    expect(shouldPersistStellageDraft({
      id: 'st2',
      name: 'Стеллаж 2',
      editingExisting: true,
      items: [{ included: false }],
    }, [])).toBe(false);
    expect(shouldPersistStellageDraft({
      id: 'st2',
      name: 'Стеллаж 2',
      editingExisting: true,
      wasInProjectList: true,
      items: [{ included: false }],
    }, [])).toBe(true);
  });
});

describe('builder frame drawing wizard flow', () => {
  it('builds builder edit return path with editRack', () => {
    expect(buildBuilderEditStellagesPath('p1')).toBe('/new?projectId=p1&mode=draft&step=stellages');
    expect(buildBuilderEditStellagesPath('p1', { editRack: 'mod1:st1' }))
      .toBe('/new?projectId=p1&mode=draft&step=stellages&editRack=mod1%3Ast1');
    expect(isBuilderWizardReturnPath('/new?projectId=p1&step=stellages')).toBe(true);
    expect(buildStellagesReturnLabel('/new?projectId=p1&step=stellages')).toBe('Вернуться к настройке проекта');
  });

  it('saved project frame drawing link uses builder returnTo with editRack', () => {
    const ctx = buildBuilderFrameDrawingContext({
      projectId: 'p1',
      projectName: 'Farm',
      stellage: { id: 'st1', moduleId: 'mod1', name: 'Стеллаж 1' },
    });
    const link = buildFrameDrawingLink(ctx);
    expect(link).toContain('projectId=p1');
    expect(link).toContain('moduleRackKey=mod1%3Ast1');
    expect(link).toContain('returnTo=%2Fnew%3FprojectId%3Dp1%26mode%3Ddraft%26step%3Dstellages%26editRack%3Dmod1%253Ast1');
    expect(ctx.returnTo).toBe('/new?projectId=p1&mode=draft&step=stellages&editRack=mod1%3Ast1');
  });

  it('resolveFramePdfExportUi shows builder return label target', () => {
    const ui = resolveFramePdfExportUi({
      projectId: 'p1',
      returnTo: '/new?projectId=p1&step=stellages&editRack=mod1:st1',
    }, { canSavePdfAndBom: true });
    expect(ui.showReturnToProjectSetup).toBe(true);
    expect(ui.showStandaloneSaveHint).toBe(false);
    const standalone = resolveFramePdfExportUi({ moduleId: 'm1', moduleRackKey: 'm1:st1' });
    expect(standalone.showSavePdfButton).toBe(false);
    expect(standalone.showStandaloneSaveHint).toBe(true);
    expect(STANDALONE_FRAME_SAVE_HINT).toMatch(/мастер настройки проекта/);
  });
});
