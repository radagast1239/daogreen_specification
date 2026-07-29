import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import {
  freezeItemDisplayFields,
  itemDisplayName,
  materialTranslationSourcePayload,
  normalizeMaterialTranslationStatus,
} from "../shared/materialTranslations.js";

function sha256(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

describe("materialTranslations helpers", () => {
  it("normalizes statuses and builds stable source payload", () => {
    expect(normalizeMaterialTranslationStatus("translated")).toBe("translated");
    expect(normalizeMaterialTranslationStatus("nope")).toBe("fallback_original");
    const a = materialTranslationSourcePayload({
      name: "Насос",
      description: "note",
      unit: "шт.",
      category: "Насосы",
      subcategory: "",
    });
    const b = materialTranslationSourcePayload({
      name: "Насос",
      description: "note",
      unit: "шт.",
      category: "Насосы",
      subcategory: "",
    });
    expect(a).toBe(b);
    expect(sha256(a)).toHaveLength(64);
  });

  it("freezes RU display from originals", () => {
    const frozen = freezeItemDisplayFields(
      { name: "Насос", unit: "шт.", clientNote: "x", category: "Насосы", materialId: "m1" },
      { language: "ru" },
    );
    expect(frozen.displayName).toBe("Насос");
    expect(frozen.translationStatus).toBe("original_ru");
  });

  it("freezes EN from translation and falls back when hash stale", () => {
    const withTr = freezeItemDisplayFields(
      { name: "Насос", unit: "шт.", clientNote: "заметка", category: "Насосы", materialId: "m1" },
      {
        language: "en",
        translation: {
          name: "Pump",
          description: "note",
          unit: "pcs",
          category: "Pumps",
          translationStatus: "translated",
          sourceHash: "abc",
        },
        material: { name: "Насос", unit: "шт.", clientNote: "заметка", category: "Насосы", subcategory: "" },
        sourceHashFn: sha256,
      },
    );
    expect(withTr.displayName).toBe("Насос");
    expect(withTr.translationStatus).toBe("fallback_original");

    const hash = sha256(
      materialTranslationSourcePayload({
        name: "Насос",
        description: "заметка",
        unit: "шт.",
        category: "Насосы",
        subcategory: "",
      }),
    );
    const ok = freezeItemDisplayFields(
      { name: "Насос", unit: "шт.", clientNote: "заметка", category: "Насосы", materialId: "m1" },
      {
        language: "en",
        translation: {
          name: "Pump",
          description: "EN note",
          unit: "pcs",
          category: "Pumps",
          translationStatus: "translated",
          sourceHash: hash,
        },
        material: { name: "Насос", unit: "шт.", clientNote: "заметка", category: "Насосы", subcategory: "" },
        sourceHashFn: sha256,
      },
    );
    expect(ok.displayName).toBe("Pump");
    expect(ok.displayUnit).toBe("pcs");
    expect(ok.translationStatus).toBe("translated");
  });

  it("uses manual EN fields for rows without materialId", () => {
    const frozen = freezeItemDisplayFields(
      { name: "Custom", nameEn: "Custom EN", unit: "шт.", unitEn: "pcs" },
      { language: "en" },
    );
    expect(frozen.displayName).toBe("Custom EN");
    expect(itemDisplayName(frozen, "en")).toBe("Custom EN");
  });
});

describe("material translation data file", () => {
  it("covers 177 unique material ids", () => {
    const dataPath = path.resolve("backend/data/materialTranslations.en.json");
    expect(fs.existsSync(dataPath)).toBe(true);
    const payload = JSON.parse(fs.readFileSync(dataPath, "utf8"));
    expect(payload.locale).toBe("en");
    expect(payload.translations).toHaveLength(177);
    const ids = new Set(payload.translations.map((t) => t.materialId));
    expect(ids.size).toBe(177);
    const statuses = {};
    for (const t of payload.translations) {
      statuses[t.status] = (statuses[t.status] || 0) + 1;
      expect(t.sourceHash).toMatch(/^[a-f0-9]{64}$/);
      expect(t.sourceNameRu).toBeTruthy();
    }
    expect((statuses.translated || 0) + (statuses.needs_review || 0)).toBeGreaterThan(150);
  });
});
