import { describe, it, expect } from "vitest";
import {
  actualPurchaseTotal,
  overlayLivePurchaseFields,
  publishedPlannedTotal,
} from "../shared/publishedPurchaseTotals.js";

describe("publishedPurchaseTotals", () => {
  const snapshot = [
    {
      id: "it1",
      qty: 2,
      price: 100,
      actualPrice: null,
      visibleToClient: true,
      includedInProject: true,
      enabled: true,
      vatRate: 0,
    },
  ];

  it("planned total uses snapshot price", () => {
    expect(publishedPlannedTotal(snapshot)).toBe(200);
  });

  it("actual total uses live actualPrice overlay without changing planned", () => {
    const overlaid = overlayLivePurchaseFields(snapshot, [{ id: "it1", actualPrice: 75 }]);
    expect(publishedPlannedTotal(overlaid)).toBe(200);
    expect(actualPurchaseTotal(overlaid)).toBe(150);
  });

  it("snapshot commercial fields stay when catalog would change", () => {
    const frozen = [{ ...snapshot[0], supplier: "A", link: "https://old" }];
    const overlaid = overlayLivePurchaseFields(frozen, [
      { id: "it1", actualPrice: 80, supplier: "NEW", link: "https://new" },
    ]);
    expect(overlaid[0].supplier).toBe("A");
    expect(overlaid[0].link).toBe("https://old");
    expect(overlaid[0].actualPrice).toBe(80);
  });
});
