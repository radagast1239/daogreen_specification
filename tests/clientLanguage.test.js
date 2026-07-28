import { describe, expect, it } from "vitest";
import {
  normalizeProjectClientLanguage,
  projectClientLanguage,
  resolveClientLanguagePatch,
  validateProjectClientLanguage,
} from "../shared/projectClientLanguage.js";
import {
  clientI18nKeys,
  t,
  tError,
  tStatus,
  tUnit,
} from "../shared/clientI18n.js";
import {
  buildReleaseSnapshotPayload,
  parseReleaseSnapshot,
} from "../shared/projectPublishedRelease.js";
import { buildNewProjectPayload } from "../shared/projectCreation.js";

describe("client language model", () => {
  it("defaults legacy projects and new projects to RU", () => {
    expect(normalizeProjectClientLanguage()).toBe("ru");
    expect(projectClientLanguage({ manualParams: {} })).toBe("ru");
    expect(buildNewProjectPayload({ name: "N", client: "C" }).manualParams.clientLanguage).toBe("ru");
  });

  it("accepts only ru and en and detects conflicting sources", () => {
    expect(validateProjectClientLanguage("en")).toBe("en");
    expect(resolveClientLanguagePatch({ manualParams: { clientLanguage: "ru" } })).toBe("ru");
    expect(() => validateProjectClientLanguage("de")).toThrow();
    try {
      resolveClientLanguagePatch({ clientLanguage: "en", manualParams: { clientLanguage: "ru" } });
      expect.fail("expected language conflict");
    } catch (error) {
      expect(error.code).toBe("PROJECT_CLIENT_LANGUAGE_INVALID");
    }
  });
});

describe("client i18n foundation", () => {
  it("has identical RU and EN semantic keys", () => {
    expect(clientI18nKeys("ru")).toEqual(clientI18nKeys("en"));
  });

  it("interpolates, localizes system values, and preserves custom values", () => {
    expect(t("en", "client.excel.filenameTemplate", { name: "Farm", version: "" }))
      .toBe("Specification_Farm");
    expect(tUnit("en", "шт.")).toBe("pcs");
    expect(tUnit("en", "ящик")).toBe("ящик");
    expect(tStatus("en", "custom status")).toBe("custom status");
    expect(tError("en", "unknown-backend-code").title).toBeTruthy();
  });
});

describe("release client language", () => {
  it("freezes language and treats legacy releases as RU", () => {
    const ru = buildReleaseSnapshotPayload({ id: "p", manualParams: { clientLanguage: "ru" } }, []);
    const en = buildReleaseSnapshotPayload({ id: "p", manualParams: { clientLanguage: "en" } }, []);
    expect(ru.projectMeta.clientLanguage).toBe("ru");
    expect(en.projectMeta.clientLanguage).toBe("en");
    expect(parseReleaseSnapshot({ items: [], projectMeta: { id: "legacy" } }).projectMeta.clientLanguage)
      .toBe("ru");
  });
});
