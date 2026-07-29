import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
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
import { applyPublishedProjectMeta } from "../shared/publishedClientMeta.js";
import { buildNewProjectPayload } from "../shared/projectCreation.js";
import { stripProjectForClone } from "../shared/projectItemClone.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

  it("applies snapshotted clientLanguage onto the client DTO", () => {
    expect(applyPublishedProjectMeta({ name: "N", clientLanguage: "en" }).clientLanguage).toBe("en");
    expect(applyPublishedProjectMeta({ name: "N" }).clientLanguage).toBe("ru");
  });

  it("duplicate keeps clientLanguage (clone strip preserves manualParams)", () => {
    const cloned = stripProjectForClone({
      id: "p1",
      clientToken: "tok",
      manualParams: { clientLanguage: "en", note: "x" },
      items: [],
    });
    expect(cloned.manualParams.clientLanguage).toBe("en");
  });

  it("new release freezes EN; old release stays immutable when live language changes", () => {
    const frozen = buildReleaseSnapshotPayload(
      { id: "p", manualParams: { clientLanguage: "en" } },
      [],
    );
    expect(frozen.projectMeta.clientLanguage).toBe("en");
    const parsed = parseReleaseSnapshot(frozen);
    expect(parsed.projectMeta.clientLanguage).toBe("en");
    // Live working copy can change after publish — client still sees frozen snapshot language.
    const live = { id: "p", manualParams: { clientLanguage: "ru" } };
    expect(projectClientLanguage(live)).toBe("ru");
    expect(parseReleaseSnapshot(frozen).projectMeta.clientLanguage).toBe("en");
  });

  it("UI regression: language selector lives on publish workspace pane, not SpecTab keep-mounted pane", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../src/pages/admin/SpecEditorPage.jsx"),
      "utf8",
    );
    const publishIdx = src.indexOf('data-workspace-pane="publish"');
    const specTabIdx = src.indexOf('data-workspace-pane="spec-tab"');
    const langIdx = src.indexOf("Язык клиентской версии");
    const hintIdx = src.indexOf("Язык новой клиентской ссылки и документов");
    expect(publishIdx).toBeGreaterThan(-1);
    expect(specTabIdx).toBeGreaterThan(publishIdx);
    expect(langIdx).toBeGreaterThan(publishIdx);
    expect(langIdx).toBeLessThan(specTabIdx);
    expect(hintIdx).toBeGreaterThan(langIdx);
    expect(hintIdx).toBeLessThan(specTabIdx);
    expect(src).toContain('data-testid="client-language-card"');
    // Immutable client link page must not host the admin language switcher.
    const clientPage = fs.readFileSync(
      path.join(__dirname, "../src/pages/client/ClientProjectPage.jsx"),
      "utf8",
    );
    expect(clientPage).not.toContain("Язык клиентской версии");
    expect(clientPage).not.toContain('saveManualParam("clientLanguage"');
  });
});
