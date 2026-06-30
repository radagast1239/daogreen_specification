import { describe, it, expect } from "vitest";
import {
  mergedRowPhotoUrl,
  itemRowPhotoUrl,
  PDF_PHOTO_COL_WIDTH_MM,
  firstPhotoFromItems,
  resolvePdfFetchUrl,
} from "../src/lib/pdfImageHelpers.js";

describe("pdfImageHelpers", () => {
  it("resolves merged row photo from row or any source item", () => {
    expect(
      mergedRowPhotoUrl({
        imageUrl: "/uploads/a.jpg",
        sourceItems: [{ imageUrl: "/uploads/b.jpg" }],
      })
    ).toContain("/uploads/a.jpg");

    expect(
      mergedRowPhotoUrl({
        sourceItems: [{ photoUrl: "/uploads/b.jpg" }],
      })
    ).toContain("/uploads/b.jpg");

    expect(
      mergedRowPhotoUrl({
        sourceItems: [{ photoUrl: "" }, { photoUrl: "/uploads/c.jpg" }],
      })
    ).toContain("/uploads/c.jpg");
  });

  it("picks first photo from source items", () => {
    expect(firstPhotoFromItems([{ imageUrl: "" }, { photoUrl: "/uploads/z.jpg" }])).toContain("/uploads/z.jpg");
  });

  it("resolves item photo url", () => {
    expect(itemRowPhotoUrl({ imageUrl: "/uploads/x.png" })).toContain("/uploads/x.png");
  });

  it("routes cross-origin urls through client media proxy", () => {
    const url = resolvePdfFetchUrl("https://cdn.example.com/item.jpg", { clientToken: "abc123" });
    expect(url).toContain("/api/client/p/abc123/media");
    expect(url).toContain(encodeURIComponent("https://cdn.example.com/item.jpg"));
  });

  it("uses compact photo column width", () => {
    expect(PDF_PHOTO_COL_WIDTH_MM).toBeGreaterThan(10);
    expect(PDF_PHOTO_COL_WIDTH_MM).toBeLessThan(20);
  });
});
