import { describe, expect, it } from "vitest";
import { buildPdfCoverData, pickPriorityPurchaseItems } from "../src/lib/clientPdfExport.js";

describe("buildPdfCoverData", () => {
  it("возвращает основные поля обложки", () => {
    const project = { name: "Ферма А", client: "ООО Рост", city: "Москва", version: 2, currency: "₽" };
    const items = [
      { name: "Насос", qty: 1, price: 1000, unit: "шт.", itemType: "material", enabled: true },
      { name: "Труба", qty: 2, price: 500, unit: "м", itemType: "material", enabled: true },
    ];
    const branding = { contactPhone: "+7 900", contactEmail: "a@b.ru", companyName: "Daogreen" };
    const cover = buildPdfCoverData(project, items, branding);

    expect(cover.title).toBe("Спецификация закупки");
    expect(cover.projectName).toBe("Ферма А");
    expect(cover.client).toBe("ООО Рост");
    expect(cover.city).toBe("Москва");
    expect(cover.version).toBe(2);
    expect(cover.totalAmount).toContain("₽");
    expect(cover.itemCount).toBe(2);
    expect(cover.contacts).toContain("+7 900");
    expect(cover.usageLines.length).toBeGreaterThan(0);
  });

  it("не падает на пустом project/items", () => {
    const cover = buildPdfCoverData({}, [], {});
    expect(cover.projectName).toBe("—");
    expect(cover.client).toBe("—");
    expect(cover.city).toBe("—");
    expect(cover.itemCount).toBe(0);
    expect(cover.priorityFallback).toContain("уточняется");
  });
});

describe("pickPriorityPurchaseItems", () => {
  it("сначала берёт позиции с purchasePriority", () => {
    const items = [
      { name: "Обычная", unit: "шт.", itemType: "material", enabled: true },
      {
        name: "Срочная",
        unit: "шт.",
        purchasePriority: "urgent",
        itemType: "material",
        enabled: true,
      },
    ];
    const lines = pickPriorityPurchaseItems(items);
    expect(lines.some((l) => l.includes("Срочная"))).toBe(true);
    expect(lines.some((l) => l.includes("Срочно"))).toBe(true);
  });

  it("затем позиции с deliveryDays > 7", () => {
    const items = [
      { name: "Долгая поставка", unit: "шт.", deliveryDays: 14, itemType: "material", enabled: true },
    ];
    const lines = pickPriorityPurchaseItems(items);
    expect(lines[0]).toContain("Долгая поставка");
    expect(lines[0]).toContain("14 дн.");
  });

  it("затем климат / электрика / сантехника", () => {
    const items = [
      {
        name: "Сплит",
        unit: "шт.",
        responsible: "climate",
        itemType: "material",
        enabled: true,
      },
    ];
    const lines = pickPriorityPurchaseItems(items);
    expect(lines[0]).toContain("Сплит");
  });

  it("ограничивает список семью строками", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      name: `P${i}`,
      unit: "шт.",
      purchasePriority: "urgent",
      itemType: "material",
      enabled: true,
    }));
    expect(pickPriorityPurchaseItems(items).length).toBeLessThanOrEqual(7);
  });
});
