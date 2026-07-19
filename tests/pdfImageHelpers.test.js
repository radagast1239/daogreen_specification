import { describe, it, expect } from "vitest";
import {
  mergedRowPhotoUrl,
  itemRowPhotoUrl,
  PDF_PHOTO_COL_WIDTH_MM,
  firstPhotoFromItems,
  resolvePdfFetchUrl,
  isAllowedImageContentType,
  isPdfImageDataUrl,
  loadImageDataUrl,
  mapWithConcurrency,
  PDF_IMAGE_FETCH_TIMEOUT_MS,
  PDF_IMAGE_CONCURRENCY,
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

  it("принимает только image/* content-type, отклоняет html и мусор", () => {
    expect(isAllowedImageContentType("image/png")).toBe(true);
    expect(isAllowedImageContentType("image/jpeg; charset=binary")).toBe(true);
    expect(isAllowedImageContentType("IMAGE/WEBP")).toBe(true);
    expect(isAllowedImageContentType("text/html")).toBe(false);
    expect(isAllowedImageContentType("text/html; charset=utf-8")).toBe(false);
    expect(isAllowedImageContentType("application/json")).toBe(false);
    expect(isAllowedImageContentType("")).toBe(false);
    expect(isAllowedImageContentType(null)).toBe(false);
    expect(isAllowedImageContentType(undefined)).toBe(false);
  });

  it("data-URL картинки должен начинаться с data:image/", () => {
    expect(isPdfImageDataUrl("data:image/png;base64,iVBOR")).toBe(true);
    expect(isPdfImageDataUrl("data:image/jpeg;base64,/9j/4AA")).toBe(true);
    expect(isPdfImageDataUrl("data:text/html;base64,PGh0bWw+")).toBe(false);
    expect(isPdfImageDataUrl("<!doctype html><html lang=\"ru\">")).toBe(false);
    expect(isPdfImageDataUrl("")).toBe(false);
    expect(isPdfImageDataUrl(null)).toBe(false);
    expect(isPdfImageDataUrl(undefined)).toBe(false);
  });

  it("loadImageDataUrl возвращает null для пустых значений без исключений", async () => {
    await expect(loadImageDataUrl(null)).resolves.toBeNull();
    await expect(loadImageDataUrl(undefined)).resolves.toBeNull();
    await expect(loadImageDataUrl("")).resolves.toBeNull();
  });

  it("resolvePdfFetchUrl не бросает исключение на мусорном вводе", () => {
    expect(() => resolvePdfFetchUrl("!!!garbage")).not.toThrow();
    expect(() => resolvePdfFetchUrl("")).not.toThrow();
    expect(resolvePdfFetchUrl("")).toBe("");
  });

  it("ограничивает параллельность загрузки фото и держит короткий таймаут", async () => {
    expect(PDF_IMAGE_FETCH_TIMEOUT_MS).toBeLessThanOrEqual(5000);
    expect(PDF_IMAGE_CONCURRENCY).toBeLessThanOrEqual(8);
    const order = [];
    let active = 0;
    let maxActive = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(`start-${n}`);
      await new Promise((r) => setTimeout(r, 20));
      active -= 1;
      order.push(`end-${n}`);
      return n * 10;
    });
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(order.filter((x) => x.startsWith("start-"))).toHaveLength(6);
  });
});
