import { describe, it, expect } from "vitest";
import { buildProjectItemsAfterBuilderSave } from "../shared/buildProjectItemsAfterBuilderSave.js";
import {
  projectItemIdentityKey,
  projectItemMaterialMatchKey,
  projectItemCompareKey,
} from "../shared/projectItemKey.js";
import { workingItemsPublishFingerprint } from "../shared/projectPublishedRelease.js";
import { compareProjectItems } from "../shared/projectCompare.js";
import { buildImportPreview } from "../shared/importFromProject.js";
import {
  mergeStellageEditorLines,
  farmSectionLinesFromProject,
  projectItemToBuilderLine,
} from "../src/lib/projectBuilderHydrate.js";
import { FRAME_BOM_SOURCE } from "../shared/frameBomProjectItems.js";
import {
  buildProjectItemFromMaterial,
  findDuplicateMaterialInModule,
} from "../src/lib/addProjectItemFromMaterial.js";
import { frameBomPreviewItemKey } from "../src/frameConstructor/FrameBomPurchasePreview.jsx";

const mat = {
  id: "m_dup",
  name: "Дубль-материал",
  unit: "шт.",
  basePrice: 100,
  link: "https://catalog/m_dup",
  linkAlt: "https://catalog/m_dup-alt",
  status: "active",
  category: "Крепёж",
};

function builderOwned(overrides) {
  return {
    includedInProject: true,
    enabled: true,
    visibleToClient: true,
    status: "not_bought",
    ...overrides,
  };
}

describe("stable project item identity", () => {
  describe("builder save — duplicate materialId", () => {
    it("keeps two builder-owned rows with same materialId/section and distinct ids", () => {
      const section = "Стеллаж A";
      const existing = [
        builderOwned({
          id: "st_a__ln_1",
          materialId: "m_dup",
          name: "Дубль-материал",
          section,
          module: section,
          sourceKey: "sk_1",
          qty: 2,
          price: 111,
          link: "https://a1",
          priceOverridden: true,
          linkOverridden: true,
        }),
        builderOwned({
          id: "st_a__ln_2",
          materialId: "m_dup",
          name: "Дубль-материал",
          section,
          module: section,
          sourceKey: "sk_2",
          qty: 5,
          price: 222,
          link: "https://a2",
          priceOverridden: true,
          linkOverridden: true,
        }),
      ];
      const generated = [
        {
          id: "st_a__ln_1",
          materialId: "m_dup",
          name: "Дубль-материал",
          section,
          module: section,
          sourceKey: "sk_1",
          qty: 2,
          price: 100,
          link: "https://catalog/m_dup",
        },
        {
          id: "st_a__ln_2",
          materialId: "m_dup",
          name: "Дубль-материал",
          section,
          module: section,
          sourceKey: "sk_2",
          qty: 5,
          price: 100,
          link: "https://catalog/m_dup",
        },
      ];
      const result = buildProjectItemsAfterBuilderSave({
        existingItems: existing,
        generatedBuilderItems: generated,
        builderContext: {
          activeStellageIds: new Set(["st_a"]),
          farmSectionNames: new Set(),
        },
        materials: [mat],
      });

      const a = result.items.find((it) => it.id === "st_a__ln_1");
      const b = result.items.find((it) => it.id === "st_a__ln_2");
      expect(a).toBeTruthy();
      expect(b).toBeTruthy();
      expect(a.qty).toBe(2);
      expect(b.qty).toBe(5);
      expect(a.price).toBe(111);
      expect(b.price).toBe(222);
      expect(a.link).toBe("https://a1");
      expect(b.link).toBe("https://a2");
      expect(result.removedBuilderIds).not.toContain("st_a__ln_1");
      expect(result.removedBuilderIds).not.toContain("st_a__ln_2");
    });

    it("does not delete second row when materialId fallback is ambiguous", () => {
      const section = "Общая закупка на ферму";
      const existing = [
        builderOwned({
          id: "it_old_1",
          materialId: "m_dup",
          name: "Дубль-материал",
          section,
          module: section,
          qty: 1,
          price: 10,
        }),
        builderOwned({
          id: "it_old_2",
          materialId: "m_dup",
          name: "Дубль-материал",
          section,
          module: section,
          qty: 9,
          price: 90,
        }),
      ];
      // Generated rows have new ids — no exact id / logical key match.
      const generated = [
        {
          id: "it_gen_x",
          materialId: "m_dup",
          name: "Дубль-материал",
          section,
          module: section,
          qty: 1,
          price: 100,
        },
        {
          id: "it_gen_y",
          materialId: "m_dup",
          name: "Дубль-материал",
          section,
          module: section,
          qty: 9,
          price: 100,
        },
      ];
      const result = buildProjectItemsAfterBuilderSave({
        existingItems: existing,
        generatedBuilderItems: generated,
        builderContext: {
          farmSectionNames: new Set([section]),
          activeStellageIds: new Set(),
        },
        materials: [mat],
      });

      expect(result.removedBuilderIds).not.toContain("it_old_1");
      expect(result.removedBuilderIds).not.toContain("it_old_2");
      const kept = result.items.filter((it) => it.materialId === "m_dup" && it.section === section);
      expect(kept.length).toBeGreaterThanOrEqual(2);
      const byId = new Map(result.items.map((it) => [it.id, it]));
      expect(byId.get("it_old_1")?.qty).toBe(1);
      expect(byId.get("it_old_2")?.qty).toBe(9);
    });

    it("second save is idempotent for duplicate builder rows", () => {
      const section = "Стеллаж A";
      const existing = [
        builderOwned({
          id: "st_a__ln_1",
          materialId: "m_dup",
          section,
          module: section,
          qty: 2,
          price: 111,
          link: "https://a1",
          priceOverridden: true,
          linkOverridden: true,
        }),
        builderOwned({
          id: "st_a__ln_2",
          materialId: "m_dup",
          section,
          module: section,
          qty: 5,
          price: 222,
          link: "https://a2",
          priceOverridden: true,
          linkOverridden: true,
        }),
      ];
      const generated = existing.map((it) => ({
        ...it,
        price: 100,
        link: mat.link,
        priceOverridden: false,
        linkOverridden: false,
      }));
      const ctx = {
        activeStellageIds: new Set(["st_a"]),
        farmSectionNames: new Set(),
      };
      const first = buildProjectItemsAfterBuilderSave({
        existingItems: existing,
        generatedBuilderItems: generated,
        builderContext: ctx,
        materials: [mat],
      });
      const second = buildProjectItemsAfterBuilderSave({
        existingItems: first.items,
        generatedBuilderItems: generated,
        builderContext: ctx,
        materials: [mat],
      });
      expect(second.items.map((it) => it.id).sort()).toEqual(
        first.items.map((it) => it.id).sort(),
      );
      expect(second.items.find((it) => it.id === "st_a__ln_1").price).toBe(111);
      expect(second.items.find((it) => it.id === "st_a__ln_2").price).toBe(222);
    });
  });

  describe("hydrate — duplicate materialId", () => {
    it("hydrates two saved rows of same materialId in one rack with separate overrides", () => {
      const catalogLines = [{ id: "ln_cat", materialId: "m_dup", name: "Дубль-материал", qty: 1, included: true }];
      const manualItems = [
        {
          id: "st_a__ln_1",
          materialId: "m_dup",
          name: "Дубль-материал",
          qty: 2,
          price: 111,
          link: "https://a1",
          includedInProject: true,
          enabled: true,
          priceOverridden: true,
          linkOverridden: true,
        },
        {
          id: "st_a__ln_2",
          materialId: "m_dup",
          name: "Дубль-материал",
          qty: 7,
          price: 777,
          link: "https://a2",
          includedInProject: true,
          enabled: true,
          priceOverridden: true,
          linkOverridden: true,
        },
      ];
      const lines = mergeStellageEditorLines({
        catalogLines,
        manualItems,
        frameBomItems: [],
        stCount: 1,
        materials: [mat],
      });
      const matched = lines.filter((ln) => ln.materialId === "m_dup" && ln.included !== false);
      expect(matched.length).toBe(2);
      const prices = matched.map((ln) => ln.price).sort((a, b) => a - b);
      const qtys = matched.map((ln) => ln.qty).sort((a, b) => a - b);
      const links = matched.map((ln) => ln.link).sort();
      expect(prices).toEqual([111, 777]);
      expect(qtys).toEqual([2, 7]);
      expect(links).toEqual(["https://a1", "https://a2"]);
    });

    it("reload → hydrate preserves distinct line ids via projectItemToBuilderLine round markers", () => {
      const items = [
        builderOwned({
          id: "st_a__it_keep_1",
          materialId: "m_dup",
          section: "Стеллаж A",
          module: "Стеллаж A",
          qty: 2,
          price: 111,
        }),
        builderOwned({
          id: "st_a__it_keep_2",
          materialId: "m_dup",
          section: "Стеллаж A",
          module: "Стеллаж A",
          qty: 3,
          price: 333,
        }),
      ];
      const lines = items.map((it) => projectItemToBuilderLine(it, { materials: [mat] }));
      expect(lines.map((ln) => ln.id).sort()).toEqual(["it_keep_1", "it_keep_2"]);
      expect(lines.find((ln) => ln.id === "it_keep_1").price).toBe(111);
      expect(lines.find((ln) => ln.id === "it_keep_2").price).toBe(333);
    });
  });

  describe("rack isolation and farm-wide", () => {
    it("keeps same materialId separate across two racks", () => {
      const a = mergeStellageEditorLines({
        catalogLines: [{ id: "ln", materialId: "m_dup", name: mat.name, qty: 1, included: true }],
        manualItems: [
          {
            id: "st_a__ln1",
            materialId: "m_dup",
            qty: 2,
            price: 10,
            link: "https://rack-a",
            includedInProject: true,
            enabled: true,
          },
        ],
        materials: [mat],
      });
      const b = mergeStellageEditorLines({
        catalogLines: [{ id: "ln", materialId: "m_dup", name: mat.name, qty: 1, included: true }],
        manualItems: [
          {
            id: "st_b__ln1",
            materialId: "m_dup",
            qty: 9,
            price: 90,
            link: "https://rack-b",
            includedInProject: true,
            enabled: true,
          },
        ],
        materials: [mat],
      });
      expect(a.find((ln) => ln.materialId === "m_dup").qty).toBe(2);
      expect(a.find((ln) => ln.materialId === "m_dup").price).toBe(10);
      expect(b.find((ln) => ln.materialId === "m_dup").qty).toBe(9);
      expect(b.find((ln) => ln.materialId === "m_dup").price).toBe(90);
      expect(a.find((ln) => ln.materialId === "m_dup").link).toBe("https://rack-a");
      expect(b.find((ln) => ln.materialId === "m_dup").link).toBe("https://rack-b");
    });

    it("does not mix rack row with farm-wide same materialId", () => {
      const farmSec = { id: "farm1", name: "Ферма целиком" };
      const project = {
        stellageConfigs: [{ id: "st_a", name: "Стеллаж A", moduleName: "NFT" }],
        items: [
          builderOwned({
            id: "st_a__ln1",
            materialId: "m_dup",
            section: "Стеллаж A",
            module: "Стеллаж A",
            qty: 2,
            price: 10,
          }),
          builderOwned({
            id: "it_farm_dup",
            materialId: "m_dup",
            section: "Ферма целиком",
            module: "Ферма целиком",
            qty: 4,
            price: 40,
            link: "https://farm",
          }),
        ],
      };
      const farmLines = farmSectionLinesFromProject(
        project,
        [farmSec],
        { farm1: [{ materialId: "m_dup", qty: 1, included: true }] },
        [mat],
      ).farm1;
      const farm = farmLines.find((ln) => ln.materialId === "m_dup");
      expect(farm.qty).toBe(4);
      expect(farm.price).toBe(40);
      expect(farm.link).toBe("https://farm");
    });
  });

  describe("manual + Frame BOM", () => {
    it("keeps manual and frame BOM with same materialId separate", () => {
      const lines = mergeStellageEditorLines({
        catalogLines: [{ id: "ln", materialId: "m_dup", name: mat.name, qty: 1, included: true }],
        manualItems: [
          {
            id: "st_a__manual",
            materialId: "m_dup",
            qty: 3,
            price: 30,
            link: "https://manual",
            source: "manual",
            includedInProject: true,
            enabled: true,
          },
        ],
        frameBomItems: [
          {
            id: "it_fbom_1",
            materialId: "m_dup",
            name: mat.name,
            qty: 8,
            price: 8,
            link: "https://bom",
            source: FRAME_BOM_SOURCE,
            status: "not_bought",
            actualPrice: null,
          },
        ],
        materials: [mat],
      });
      const manual = lines.find((ln) => String(ln.source || "") === "manual");
      const bom = lines.find((ln) => ln.source === FRAME_BOM_SOURCE);
      expect(manual).toBeTruthy();
      expect(bom).toBeTruthy();
      expect(manual.qty).toBe(3);
      expect(manual.price).toBe(30);
      expect(manual.link).toBe("https://manual");
      expect(bom.qty).toBe(8);
      expect(bom.link).toBe("https://bom");
      expect(manual.link).not.toBe(bom.link);
    });
  });

  describe("duplicate manual add", () => {
    it("confirmed duplicate gets new id, source=manual, independent overrides", () => {
      const first = buildProjectItemFromMaterial(mat, "Раздел", { sortOrder: 0 });
      expect(findDuplicateMaterialInModule([first], mat.id, "Раздел")).toBeTruthy();
      const second = buildProjectItemFromMaterial(mat, "Раздел", {
        sortOrder: 1,
        asManualDuplicate: true,
      });
      expect(second.id).toBeTruthy();
      expect(second.id).not.toBe(first.id);
      expect(second.source).toBe("manual");
      expect(second.materialId).toBe(mat.id);
      expect(second.status).toBe("not_bought");
      expect(second.actualPrice).toBeNull();
      expect(second.priceOverridden).toBe(false);
      expect(first.source).not.toBe("manual");
    });
  });

  describe("published fingerprint", () => {
    const base = [
      {
        id: "it_1",
        materialId: "m_dup",
        name: mat.name,
        qty: 1,
        price: 10,
        actualPrice: null,
        visibleToClient: true,
        includedInProject: true,
      },
      {
        id: "it_2",
        materialId: "m_dup",
        name: mat.name,
        qty: 2,
        price: 20,
        actualPrice: null,
        visibleToClient: true,
        includedInProject: true,
      },
    ];

    it("adding a duplicate materialId changes fingerprint", () => {
      const before = workingItemsPublishFingerprint(base.slice(0, 1));
      const after = workingItemsPublishFingerprint(base);
      expect(after).not.toBe(before);
    });

    it("removing one duplicate row changes fingerprint", () => {
      const before = workingItemsPublishFingerprint(base);
      const after = workingItemsPublishFingerprint(base.slice(0, 1));
      expect(after).not.toBe(before);
    });

    it("changing price/qty of only the second duplicate changes fingerprint", () => {
      const before = workingItemsPublishFingerprint(base);
      const after = workingItemsPublishFingerprint([
        base[0],
        { ...base[1], qty: 99, price: 999 },
      ]);
      expect(after).not.toBe(before);
    });

    it("fingerprint sort is order-independent", () => {
      const a = workingItemsPublishFingerprint(base);
      const b = workingItemsPublishFingerprint([base[1], base[0]]);
      expect(a).toBe(b);
    });
  });

  describe("import / compare", () => {
    it("import preview distinguishes two rows of same materialId in different racks", () => {
      const sourceItems = [
        { id: "s1", materialId: "m_dup", name: mat.name, module: "Стеллаж A", section: "Стеллаж A", qty: 1 },
        { id: "s2", materialId: "m_dup", name: mat.name, module: "Стеллаж B", section: "Стеллаж B", qty: 2 },
      ];
      const preview = buildImportPreview({
        sourceItems,
        targetItems: [],
        kind: "selected",
        itemIds: ["s1", "s2"],
      });
      expect(preview.added.length).toBe(2);
      expect(projectItemCompareKey(sourceItems[0])).not.toBe(projectItemCompareKey(sourceItems[1]));
    });

    it("project compare does not collapse duplicates with different ids", () => {
      const baseItems = [
        { id: "a1", materialId: "m_dup", name: mat.name, module: "X", qty: 1, price: 10 },
        { id: "a2", materialId: "m_dup", name: mat.name, module: "X", qty: 5, price: 50 },
      ];
      const otherItems = [
        { id: "a1", materialId: "m_dup", name: mat.name, module: "X", qty: 1, price: 10 },
        { id: "a2", materialId: "m_dup", name: mat.name, module: "X", qty: 5, price: 50 },
      ];
      const cmp = compareProjectItems(baseItems, otherItems);
      expect(cmp.added).toHaveLength(0);
      expect(cmp.removed).toHaveLength(0);
      const onlySecondChanged = compareProjectItems(
        [baseItems[0], { ...baseItems[1], qty: 99 }],
        otherItems,
      );
      expect(onlySecondChanged.changed.some((c) => c.id === "a2")).toBe(true);
      expect(onlySecondChanged.changed.some((c) => c.id === "a1")).toBe(false);
    });
  });

  describe("identity helpers", () => {
    it("identity key prefers id; material match is material-centric", () => {
      const a = { id: "it_1", materialId: "m_dup", section: "A", qty: 1 };
      const b = { id: "it_2", materialId: "m_dup", section: "A", qty: 2 };
      expect(projectItemIdentityKey(a)).toBe("id:it_1");
      expect(projectItemIdentityKey(b)).toBe("id:it_2");
      expect(projectItemMaterialMatchKey(a)).toBe(projectItemMaterialMatchKey(b));
      expect(projectItemCompareKey(a)).not.toBe(projectItemCompareKey(b));
    });
  });

  describe("FrameBom UI keys", () => {
    it("does not create duplicate React keys for same materialId without item.key", () => {
      const items = [
        { materialId: "m_dup", name: "A", bomKey: "bk1", moduleRackKey: "mod:st1" },
        { materialId: "m_dup", name: "B", bomKey: "bk2", moduleRackKey: "mod:st1" },
      ];
      const keys = items.map((it, i) => frameBomPreviewItemKey(it, i));
      expect(new Set(keys).size).toBe(2);
      expect(keys.every((k) => k !== "m_dup")).toBe(true);
    });
  });
});
