import { describe, expect, it } from "vitest";
import {
  buildBulkPatchPayload,
  buildReviewPatchPayload,
  DEFAULT_MATERIAL_CATEGORY,
  LEGACY_REVIEW_CATEGORY,
  REVIEW_CLIENT_SECTION,
  formatBulkActionConfirmation,
} from "../shared/materialBulkActions.js";
describe("materialBulkActions", () => {
  it("Bulk payload для responsible содержит только responsible", () => {
    const payload = buildBulkPatchPayload("responsible", "plumber");
    expect(payload).toEqual({ responsible: "plumber" });
    expect(Object.keys(payload).length).toBe(1);
  });

  it("Bulk payload для supplier содержит только supplier", () => {
    const payload = buildBulkPatchPayload("supplier", "Ozon");
    expect(payload).toEqual({ supplier: "Ozon" });
    expect(Object.keys(payload).length).toBe(1);
  });

  it("Bulk payload для clientSection содержит section и subsection", () => {
    const payload = buildBulkPatchPayload("clientSection", "stellage", "Крепёж");
    expect(payload).toEqual({ clientSection: "stellage", clientSubsection: "Крепёж" });
  });

  it("Форматирует подтверждение", () => {
    const text = formatBulkActionConfirmation("responsible", "plumber", null, 5);
    expect(text).toContain("Будет изменено 5 выбранных материалов.");
    expect(text).toContain("Ответственный = plumber");
  });

  it("bulk payloads never include frame_bom technical keys", () => {
    const types = ["responsible", "supplier", "clientSection", "showClient", "hideClient", "setReview", "clearReview"];
    for (const t of types) {
      const payload = buildBulkPatchPayload(t, "x", "y");
      expect(JSON.stringify(payload)).not.toMatch(/frame_bom|sourceKey|sourceType/i);
    }
  });

  it("setReview and clearReview preserve material category (1g.2.1)", () => {
    expect(buildBulkPatchPayload("setReview")).toEqual({
      clientSection: REVIEW_CLIENT_SECTION,
    });
    expect("category" in buildBulkPatchPayload("setReview")).toBe(false);
    expect(buildBulkPatchPayload("clearReview")).toEqual({
      clientSection: "",
    });
    expect("category" in buildBulkPatchPayload("clearReview")).toBe(false);
  });

  it("buildReviewPatchPayload legacy clearReview normalizes category", () => {
    const legacy = { category: LEGACY_REVIEW_CATEGORY, clientSection: REVIEW_CLIENT_SECTION };
    expect(buildReviewPatchPayload(legacy, "clearReview")).toEqual({
      clientSection: "",
      category: DEFAULT_MATERIAL_CATEGORY,
    });
    const normal = { category: "Электрика и свет", clientSection: REVIEW_CLIENT_SECTION };
    expect(buildReviewPatchPayload(normal, "clearReview")).toEqual({ clientSection: "" });
    expect("category" in buildReviewPatchPayload(normal, "clearReview")).toBe(false);
  });
});
