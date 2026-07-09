import { describe, expect, it } from "vitest";
import {
  PURCHASE_STATUS,
  PURCHASE_STATUS_LABELS,
  normalizePurchaseStatus,
  getPurchaseStatusLabel,
  shouldShowInClientPurchase,
  shouldCountInPurchaseBudget,
  shouldWarnBeforePublish,
  isPurchaseStatusCompleted,
  buildPurchaseStatusSummary,
} from "../shared/purchaseStatusRules.js";

describe("purchaseStatusRules", () => {
  it("normalizes all canonical statuses and aliases", () => {
    for (const id of Object.values(PURCHASE_STATUS)) {
      expect(normalizePurchaseStatus(id)).toBe(id);
      expect(normalizePurchaseStatus({ status: id })).toBe(id);
      expect(normalizePurchaseStatus({ purchaseStatus: id })).toBe(id);
      expect(normalizePurchaseStatus({ purchase_status: id })).toBe(id);
    }
    expect(normalizePurchaseStatus("")).toBe(PURCHASE_STATUS.NOT_BOUGHT);
    expect(normalizePurchaseStatus(null)).toBe(PURCHASE_STATUS.NOT_BOUGHT);
  });

  it("provides Russian labels for every status", () => {
    for (const id of Object.values(PURCHASE_STATUS)) {
      const label = getPurchaseStatusLabel(id);
      expect(label).toBeTruthy();
      expect(label).toBe(PURCHASE_STATUS_LABELS[id]);
      expect(label).not.toMatch(/not_bought|need_help|replacement_check/);
    }
  });

  it("shouldShowInClientPurchase is true for all statuses", () => {
    for (const id of Object.values(PURCHASE_STATUS)) {
      expect(shouldShowInClientPurchase({ status: id })).toBe(true);
    }
  });

  it("shouldCountInPurchaseBudget excludes have and not_fit", () => {
    expect(shouldCountInPurchaseBudget({ status: "have" })).toBe(false);
    expect(shouldCountInPurchaseBudget({ status: "not_fit" })).toBe(false);
    expect(shouldCountInPurchaseBudget({ status: "bought" })).toBe(true);
    expect(shouldCountInPurchaseBudget({ status: "not_bought" })).toBe(true);
  });

  it("shouldWarnBeforePublish for attention statuses", () => {
    expect(shouldWarnBeforePublish("need_help")).toBe(true);
    expect(shouldWarnBeforePublish("replacement_check")).toBe(true);
    expect(shouldWarnBeforePublish("not_fit")).toBe(true);
    expect(shouldWarnBeforePublish("searching")).toBe(true);
    expect(shouldWarnBeforePublish("bought")).toBe(false);
    expect(shouldWarnBeforePublish("have")).toBe(false);
  });

  it("isPurchaseStatusCompleted for bought/delivered/have", () => {
    expect(isPurchaseStatusCompleted("bought")).toBe(true);
    expect(isPurchaseStatusCompleted("delivered")).toBe(true);
    expect(isPurchaseStatusCompleted("have")).toBe(true);
    expect(isPurchaseStatusCompleted("ordered")).toBe(false);
  });

  it("buildPurchaseStatusSummary handles mixed merged rows", () => {
    const single = buildPurchaseStatusSummary([{ status: "bought" }]);
    expect(single.mixed).toBe(false);
    expect(single.statusLabel).toBe("Куплено");

    const mixed = buildPurchaseStatusSummary([
      { status: "bought" },
      { status: "not_bought" },
    ]);
    expect(mixed.mixed).toBe(true);
    expect(mixed.statusSummary).toContain("Смешанный статус");
    expect(mixed.statusSummary).toContain("Куплено");
    expect(mixed.statusSummary).toContain("Не куплено");
  });
});
