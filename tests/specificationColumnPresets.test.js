import { describe, expect, it } from "vitest";
import { DEFAULT_SPECIFICATION_COLUMN_PRESET, SPECIFICATION_COLUMN_PRESETS, specificationPresetHasColumn } from "../src/lib/specificationColumnPresets.js";

describe("specification column presets", () => {
  it("defaults to the approved compact main preset", () => {
    expect(DEFAULT_SPECIFICATION_COLUMN_PRESET).toBe("main");
    expect(SPECIFICATION_COLUMN_PRESETS.main.label).toBe("Основное");
    for (const column of ["select", "photo", "name", "unit", "qty", "price", "sum", "supplier", "purchaseStatus", "clientVisibility", "details"])
      expect(specificationPresetHasColumn("main", column)).toBe(true);
  });

  it("contains procurement and client workflows without invented fields", () => {
    for (const column of ["links", "purchaseStatus", "deliveryDays", "comments"])
      expect(specificationPresetHasColumn("purchase", column)).toBe(true);
    for (const column of ["clientVisibility", "hidden", "included", "group"])
      expect(specificationPresetHasColumn("client", column)).toBe(true);
  });

  it("keeps a complete parity fallback", () => {
    for (const column of ["vat", "room", "links", "clientComment", "type", "catalog", "delete"])
      expect(specificationPresetHasColumn("all", column)).toBe(true);
  });
});
