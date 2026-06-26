import { describe, expect, it } from "vitest";
import { purchaseMergeKey, findPurchaseDuplicateGroups } from "../shared/purchaseMerge.js";

describe("purchaseMerge", () => {
  it("склеивает по purchaseKey", () => {
    const key = purchaseMergeKey({ name: "Болт", unit: "шт.", purchaseKey: "bolt-m6" });
    expect(key).toBe("bolt-m6");
  });

  it("склеивает по имени+ед+поставщик+ссылка", () => {
    const a = purchaseMergeKey({ name: "Труба", unit: "м", supplier: "Леруа", link: "http://x" });
    const b = purchaseMergeKey({ name: "  труба  ", unit: "м", supplier: "Леруа", link: "http://x" });
    expect(a).toBe(b);
  });

  it("находит группы дублей", () => {
    const groups = findPurchaseDuplicateGroups([
      { name: "A", unit: "шт." },
      { name: "A", unit: "шт." },
      { name: "B", unit: "шт." },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });
});
