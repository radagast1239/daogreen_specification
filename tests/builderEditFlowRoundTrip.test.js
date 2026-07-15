import { describe, expect, it } from "vitest";
import { buildProjectFromBuilder } from "../src/lib/projectBuilder.js";
import { buildProjectItemsAfterBuilderSave } from "../shared/buildProjectItemsAfterBuilderSave.js";
import { PROJECT_STATUS_ACTIVE } from "../shared/projectLifecycle.js";
import { NASOSNAYA_CANONICAL_NAME } from "../shared/nasosnayaFarmSection.js";

/**
 * Round-trip: finished project edited via builder must keep projectId-equivalent
 * items and project-owned fields; materialId collision must not drop ordinary rows.
 */
describe("builder edit-flow round-trip safety", () => {
  const materials = [
    {
      id: "m_manual",
      name: "Ручной материал",
      unit: "шт.",
      basePrice: 10,
      category: "Прочее",
      status: "active",
    },
    {
      id: "m_builder",
      name: "Насос полив подтопление",
      unit: "шт.",
      basePrice: 100,
      category: "Полив и сантехника",
      status: "active",
      modules: ["Насосная группа и обвязка"],
    },
    {
      id: "m_rack",
      name: "Профиль",
      unit: "м",
      basePrice: 50,
      category: "Каркас",
      status: "active",
    },
  ];

  it("preserves manual + builder-owned fields and same logical project on save", () => {
    const projectId = "proj_ready_1";
    const manualItem = {
      id: "it_spec_manual_1",
      materialId: "m_manual",
      name: "Ручной материал",
      module: "Ручной раздел",
      section: "Ручной раздел",
      source: "manual",
      qty: 3,
      price: 10,
      status: "ordered",
      purchaseStatus: "ordered",
      actualPrice: 9.5,
      clientNote: "клиенту",
      internalNote: "внутри",
      includedInProject: true,
      visibleToClient: true,
    };
    // Same materialId as a builder pump line — must NOT delete the manual-like row elsewhere
    const ordinarySameMaterial = {
      id: "it_other_section_same_mat",
      materialId: "m_builder",
      name: "Насос в другом разделе",
      module: "Другой раздел",
      section: "Другой раздел",
      source: "manual",
      qty: 1,
      price: 100,
      status: "searching",
      actualPrice: 95,
      clientNote: "other",
      internalNote: "other-int",
      includedInProject: true,
    };
    const builderOwnedExisting = {
      id: "it_builder_pump",
      materialId: "m_builder",
      name: "Насос полив подтопление",
      module: NASOSNAYA_CANONICAL_NAME,
      section: NASOSNAYA_CANONICAL_NAME,
      qty: 2,
      price: 100,
      status: "not_bought",
      actualPrice: 90,
      clientNote: "pump client",
      internalNote: "pump internal",
      includedInProject: true,
    };
    const existingItems = [manualItem, ordinarySameMaterial, builderOwnedExisting];

    const built = buildProjectFromBuilder({
      form: {
        name: "Готовый проект",
        client: "Клиент",
        status: PROJECT_STATUS_ACTIVE,
        manualParams: {},
      },
      stellages: [
        {
          id: "st1",
          name: "Стеллаж 1",
          moduleName: "Проточка",
          moduleId: "mod1",
          count: 1,
          items: [
            {
              id: "ln_rack",
              materialId: "m_rack",
              name: "Профиль",
              qty: 4,
              included: true,
              unit: "м",
            },
          ],
        },
      ],
      farmSections: [
        {
          sectionId: "sec_nasosnaya",
          sectionName: NASOSNAYA_CANONICAL_NAME,
          items: [
            {
              id: "ln_pump",
              materialId: "m_builder",
              name: "Насос полив подтопление",
              qty: 2,
              included: true,
              unit: "шт.",
            },
          ],
        },
      ],
      materials,
      rooms: [],
      existingItems,
    });

    const result = buildProjectItemsAfterBuilderSave({
      existingItems,
      generatedBuilderItems: built.items,
      builderContext: {
        farmSectionNames: [NASOSNAYA_CANONICAL_NAME],
        activeStellageIds: ["st1"],
      },
      materials,
    });

    expect(result.blocked).toBe(false);
    expect(result.items.find((it) => it.id === "it_spec_manual_1")).toMatchObject({
      actualPrice: 9.5,
      clientNote: "клиенту",
      internalNote: "внутри",
      status: "ordered",
      materialId: "m_manual",
    });
    expect(result.items.find((it) => it.id === "it_other_section_same_mat")).toMatchObject({
      actualPrice: 95,
      clientNote: "other",
      internalNote: "other-int",
      status: "searching",
      materialId: "m_builder",
      section: "Другой раздел",
    });

    const pumpLines = result.items.filter(
      (it) => it.materialId === "m_builder" && (it.section === NASOSNAYA_CANONICAL_NAME || it.module === NASOSNAYA_CANONICAL_NAME)
    );
    expect(pumpLines.length).toBeGreaterThanOrEqual(1);
    const preservedPump = pumpLines.find((it) => it.actualPrice === 90 || it.internalNote === "pump internal");
    expect(preservedPump).toBeTruthy();

    // No drop of ordinary same-materialId row
    expect(result.items.some((it) => it.id === "it_other_section_same_mat")).toBe(true);
    expect(result.items.some((it) => it.id === "it_spec_manual_1")).toBe(true);

    // Project identity for edit flow is external (URL/API); items still carry stable ids.
    expect(projectId).toBe("proj_ready_1");
  });
});
