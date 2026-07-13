import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Materials quality bulk supplier", () => {
  it("uses the suppliers API and a select with name string values including no supplier", () => {
    const source = readFileSync("src/pages/admin/MaterialsQualityPage.jsx", "utf8");
    expect(source).toContain("api.getSuppliers()");
    expect(source).toContain("{bulkAction === \"supplier\" && (");
    expect(source).toContain("<select");
    expect(source).toContain('<option value="">Без поставщика</option>');
    expect(source).toContain("value={supplier.name}");
  });
});
