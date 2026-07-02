import { describe, expect, it } from "vitest";
import { mergedPurchaseRows } from "../src/store/helpers.js";
import { mergePipeCutsFromItems, pipeCutsClientNote } from "../shared/profilePipeCuts.js";
import { lineVisibleToClient, resolveItemType, isPurchasableLineType } from "../shared/itemTypes.js";
import { clientPurchaseItems } from "../src/lib/itemHelpers.js";

describe("mergePipeCutsFromItems", () => {
  it("суммирует одинаковые длины и сохраняет разные", () => {
    const cuts = mergePipeCutsFromItems([
      {
        name: "Труба профильная 20/20/1,5 мм",
        pipeCuts: [
          { lengthMm: 1300, qty: 12 },
          { lengthMm: 660, qty: 18 },
        ],
      },
      {
        name: "Труба профильная 20/20/1,5 мм",
        clientNote: "Сегменты: 1300 мм — 10 шт, 2400 мм — 4 шт",
      },
    ]);
    expect(cuts).toEqual([
      { lengthMm: 660, qty: 18 },
      { lengthMm: 1300, qty: 22 },
      { lengthMm: 2400, qty: 4 },
    ]);
    expect(pipeCutsClientNote(cuts)).toBe(
      "Сегменты: 660 мм — 18 шт, 1300 мм — 22 шт, 2400 мм — 4 шт"
    );
  });
});

describe("mergedPurchaseRows profile pipe", () => {
  it("склеивает сегменты всех стеллажей в одну строку clientNote", () => {
    const base = {
      name: "Труба профильная 20/20/1,5 мм",
      unit: "м.п.",
      supplier: "Местная металлобаза",
      price: 90,
      itemType: "material",
      includedInProject: true,
      visibleToClient: true,
    };
    const rows = mergedPurchaseRows([
      {
        ...base,
        id: "a",
        module: "Стеллаж 1",
        qty: 75,
        pipeCuts: [
          { lengthMm: 1300, qty: 12 },
          { lengthMm: 660, qty: 18 },
          { lengthMm: 1800, qty: 4 },
        ],
        clientNote: "Сегменты: 1300 мм — 12 шт, 660 мм — 18 шт, 1800 мм — 4 шт",
      },
      {
        ...base,
        id: "b",
        module: "Стеллаж 2",
        qty: 10,
        pipeCuts: [{ lengthMm: 1300, qty: 2 }],
        clientNote: "Сегменты: 1300 мм — 2 шт",
      },
      {
        ...base,
        id: "c",
        module: "Стеллаж 3",
        qty: 350,
        clientNote: "Сегменты: 1300 мм — 10 шт, 2400 мм — 4 шт",
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].qty).toBe(435);
    expect(rows[0].clientNote).toBe(
      "Сегменты: 660 мм — 18 шт, 1300 мм — 24 шт, 1800 мм — 4 шт, 2400 мм — 4 шт"
    );
    expect(rows[0].pipeCuts).toEqual([
      { lengthMm: 660, qty: 18 },
      { lengthMm: 1300, qty: 24 },
      { lengthMm: 1800, qty: 4 },
      { lengthMm: 2400, qty: 4 },
    ]);
  });
});

function hiddenFromClientReason(it) {
  const t = resolveItemType(it);
  if (t === "internal_note") return "internal_note";
  const included =
    it.includedInProject != null ? it.includedInProject !== false : it.enabled !== false;
  if (!included) return "not_included";
  if (it.visibleToClient === false) return "visible_to_client_false";
  return null;
}

describe("client spec coverage", () => {
  it("все закупаемые включённые позиции попадают в mergedPurchaseRows", () => {
    const project = {
      items: [
        { id: "1", name: "A", unit: "шт.", qty: 1, itemType: "material", includedInProject: true },
        { id: "2", name: "B", unit: "шт.", qty: 1, itemType: "note", includedInProject: true },
        {
          id: "3",
          name: "C",
          unit: "шт.",
          qty: 1,
          itemType: "material",
          includedInProject: false,
        },
        {
          id: "4",
          name: "D",
          unit: "шт.",
          qty: 1,
          itemType: "material",
          visibleToClient: false,
          includedInProject: true,
        },
      ],
    };
    const purchase = clientPurchaseItems(project);
    const merged = mergedPurchaseRows(purchase);
    const mergedIds = new Set(merged.flatMap((r) => r.sourceItems.map((i) => i.id)));
    expect(purchase.map((i) => i.id)).toEqual(["1"]);
    expect(mergedIds).toEqual(new Set(["1"]));

    const hiddenPurchasable = (project.items || []).filter(
      (it) => isPurchasableLineType(resolveItemType(it)) && !lineVisibleToClient(it)
    );
    expect(hiddenPurchasable.map((it) => ({ id: it.id, reason: hiddenFromClientReason(it) }))).toEqual([
      { id: "3", reason: "not_included" },
      { id: "4", reason: "visible_to_client_false" },
    ]);
  });
});
