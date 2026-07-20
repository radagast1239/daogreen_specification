import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  formatPhotoPageSubtitle,
  formatUnlinkedCardValue,
  materialPhotoCounts,
  resolveUnlinkedPhotoCount,
} from "../src/lib/photoStatistics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const photosPage = fs.readFileSync(
  path.join(__dirname, "../src/pages/admin/PhotosPage.jsx"),
  "utf8"
);

describe("photoStatistics 1g.3", () => {
  it("materialPhotoCounts splits with/without photo", () => {
    const counts = materialPhotoCounts([
      { id: "a", imageUrl: "/x.jpg" },
      { id: "b", photoUrl: "/y.jpg" },
      { id: "c" },
    ]);
    expect(counts).toEqual({ total: 3, withPhoto: 2, withoutPhoto: 1 });
  });

  it("resolveUnlinkedPhotoCount is null before scan", () => {
    expect(resolveUnlinkedPhotoCount(null)).toBeNull();
    expect(resolveUnlinkedPhotoCount(undefined)).toBeNull();
  });

  it("known unlinked count = 0 displays as 0", () => {
    expect(resolveUnlinkedPhotoCount({ unmatched: [] })).toBe(0);
    expect(formatUnlinkedCardValue(0)).toBe("0");
    expect(formatPhotoPageSubtitle({ withPhoto: 177, withoutPhoto: 0, unlinkedCount: 0 })).toBe(
      "177 с фото · 0 без фото · 0 не привязано"
    );
  });

  it("known unlinked count > 0 displays correctly", () => {
    expect(resolveUnlinkedPhotoCount({ unmatched: ["a.jpg", "b.jpg"] })).toBe(2);
    expect(formatUnlinkedCardValue(2)).toBe("2");
    expect(formatPhotoPageSubtitle({ withPhoto: 10, withoutPhoto: 5, unlinkedCount: 2 })).toBe(
      "10 с фото · 5 без фото · 2 не привязано"
    );
  });

  it("unknown count displays as Не проверено", () => {
    expect(formatUnlinkedCardValue(null)).toBe("Не проверено");
    expect(formatPhotoPageSubtitle({ withPhoto: 177, withoutPhoto: 0, unlinkedCount: null })).toBe(
      "177 с фото · 0 без фото · непривязанные файлы не проверены"
    );
  });

  it("subtitle never leaves empty value after colon or shows undefined/null/NaN", () => {
    const cases = [
      formatPhotoPageSubtitle({ withPhoto: 177, withoutPhoto: 0, unlinkedCount: null }),
      formatPhotoPageSubtitle({ withPhoto: 177, withoutPhoto: 0, unlinkedCount: 0 }),
      formatPhotoPageSubtitle({ withPhoto: 1, withoutPhoto: 2, unlinkedCount: 3 }),
    ];
    for (const s of cases) {
      expect(s).not.toMatch(/:\s*$/);
      expect(s).not.toMatch(/undefined|null|NaN/i);
      expect(s.length).toBeGreaterThan(10);
    }
  });

  it("PhotosPage third card is Не привязано, not Всего материалов", () => {
    expect(photosPage).toContain(">Не привязано<");
    expect(photosPage).not.toContain("Всего материалов");
    expect(photosPage).toContain("formatUnlinkedCardValue");
    expect(photosPage).toContain("resolveUnlinkedPhotoCount");
  });

  it("after mock scan value updates from unknown to known", () => {
    let result = null;
    expect(resolveUnlinkedPhotoCount(result)).toBeNull();
    expect(formatUnlinkedCardValue(resolveUnlinkedPhotoCount(result))).toBe("Не проверено");

    result = { matched: [{ materialId: "m1" }], unmatched: ["orphan.jpg"], total: 2 };
    const count = resolveUnlinkedPhotoCount(result);
    expect(count).toBe(1);
    expect(formatUnlinkedCardValue(count)).toBe("1");
    expect(formatPhotoPageSubtitle({ withPhoto: 177, withoutPhoto: 0, unlinkedCount: count })).toContain(
      "1 не привязано"
    );
  });
});
