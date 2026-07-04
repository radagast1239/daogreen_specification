import { describe, it, expect } from "vitest";
import { purchaseMergeKey, findPurchaseDuplicateGroups } from "../shared/purchaseMerge.js";

const ac = (roomId, kw) => ({
  name: "Сплит-система / кондиционер",
  unit: "шт.",
  roomId,
  coolingKw: kw,
  splitSpecs: [{ qty: 1, coolingKw: kw }],
});

describe("purchaseMergeKey — cooling specs", () => {
  it("does not merge split systems from different rooms", () => {
    expect(purchaseMergeKey(ac("r1", 3.5))).not.toBe(purchaseMergeKey(ac("r2", 5.3)));
  });

  it("does not merge same room but different BTU/kW", () => {
    expect(purchaseMergeKey(ac("r1", 3.5))).not.toBe(purchaseMergeKey(ac("r1", 5.3)));
  });

  it("merges the identical split system of the same room", () => {
    expect(purchaseMergeKey(ac("r1", 3.5))).toBe(purchaseMergeKey(ac("r1", 3.5)));
  });

  it("split systems of different rooms are not duplicate groups", () => {
    const groups = findPurchaseDuplicateGroups([ac("r1", 3.5), ac("r2", 5.3), ac("r3", 14.4)]);
    expect(groups).toHaveLength(0);
  });

  it("keeps normal materials merged by name/unit/supplier/link", () => {
    const a = { name: "Насос дренажный", unit: "шт.", supplier: "S", link: "l" };
    const b = { name: "Насос дренажный", unit: "шт.", supplier: "S", link: "l" };
    expect(purchaseMergeKey(a)).toBe(purchaseMergeKey(b));
  });
});
