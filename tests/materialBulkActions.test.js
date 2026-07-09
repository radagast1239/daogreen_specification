import { describe, expect, it } from "vitest";
import { buildBulkPatchPayload, formatBulkActionConfirmation } from "../shared/materialBulkActions.js";

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
    const types = ["responsible", "supplier", "clientSection", "showClient", "hideClient", "setReview"];
    for (const t of types) {
      const payload = buildBulkPatchPayload(t, "x", "y");
      expect(JSON.stringify(payload)).not.toMatch(/frame_bom|sourceKey|sourceType/i);
    }
  });
});
