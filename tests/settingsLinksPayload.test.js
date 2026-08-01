/**
 * T6 follow-up — SettingsPage links-tab must PATCH an explicit allowlist payload,
 * never the full GET /settings object (legacy farmSectionOrder/Names, etc.).
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  LINKS_TAB_SETTINGS_KEYS,
  buildLinksSettingsPayload,
} from "../src/lib/settingsUi.js";
import { validateSettingsPatch } from "../backend/src/services/settingsSchema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const settingsPageSrc = fs.readFileSync(
  path.join(__dirname, "../src/pages/admin/SettingsPage.jsx"),
  "utf8",
);

const FULL_GET_LIKE_FORM = {
  // links-tab editable
  clientLinkTtlDays: "30",
  // other-tab / overview fields that used to ride along via ...form
  companyName: "Daogreen",
  contactPhone: "+7",
  contactEmail: "a@b.c",
  contactTelegram: "@tg",
  brandColor: "#116355",
  brandAccentColor: "#7fc9a8",
  brandBgColor: "#f0f7f4",
  logoUrl: "/uploads/public/logo.png",
  clientHeroEyebrow: "eyebrow",
  clientTrustLines: JSON.stringify(["line"]),
  clientVisibleTabs: JSON.stringify(["overview"]),
  clientPdfColumns: JSON.stringify(["name"]),
  clientPdfFooter: "footer",
  clientPdfShowQr: "true",
  materialCategories: JSON.stringify(["Каркас"]),
  clientSectionsJson: JSON.stringify([{ id: "purchase", label: "Закупка" }]),
  publishRules: JSON.stringify({ requirePrice: true }),
  clientLinkTemplate: "Hello",
  refTags: JSON.stringify(["электрика"]),
  refUnits: JSON.stringify(["шт."]),
  refPurchaseStatuses: JSON.stringify([{ id: "bought", label: "Куплено" }]),
  refResponsibleRoles: JSON.stringify([{ id: "manager", label: "Менеджер" }]),
  refFarmTypes: JSON.stringify(["NFT"]),
  refStellageGroups: JSON.stringify([{ id: "karkas", label: "Каркас" }]),
  refFarmSectionGroups: JSON.stringify([{ id: "other", label: "Прочее" }]),
  farmSections: JSON.stringify([{ id: "sec_1", name: "Каркас" }]),
  farmSectionCatalogs: JSON.stringify({ sec_1: [] }),
  farmSectionVersions: JSON.stringify({ sec_1: [] }),
  stellageModuleCatalogs: JSON.stringify({}),
  stellageModuleMeta: JSON.stringify({}),
  // legacy read-only (GET always returns these)
  farmSectionOrder: "sec_1,sec_2",
  farmSectionNames: JSON.stringify({ sec_1: "A" }),
  // server-owned
  migration_client_visible_default_v2: "done",
  adminSessionVersion: "3",
  // unknown
  attackerKey: "nope",
};

describe("buildLinksSettingsPayload", () => {
  it("A. narrows a full GET-like form to links-tab editable keys only", () => {
    const payload = buildLinksSettingsPayload(FULL_GET_LIKE_FORM);
    expect(Object.keys(payload).sort()).toEqual([...LINKS_TAB_SETTINGS_KEYS].sort());
    expect(payload).toEqual({ clientLinkTtlDays: "30" });
  });

  it("B. excludes legacy farmSectionOrder / farmSectionNames", () => {
    const payload = buildLinksSettingsPayload(FULL_GET_LIKE_FORM);
    expect(payload).not.toHaveProperty("farmSectionOrder");
    expect(payload).not.toHaveProperty("farmSectionNames");
  });

  it("C. excludes server-owned keys", () => {
    const payload = buildLinksSettingsPayload(FULL_GET_LIKE_FORM);
    expect(payload).not.toHaveProperty("migration_client_visible_default_v2");
    expect(payload).not.toHaveProperty("adminSessionVersion");
  });

  it("D. excludes other-tab settings", () => {
    const payload = buildLinksSettingsPayload(FULL_GET_LIKE_FORM);
    for (const key of [
      "publishRules",
      "clientLinkTemplate",
      "materialCategories",
      "clientSectionsJson",
      "refTags",
      "farmSections",
      "farmSectionCatalogs",
      "stellageModuleCatalogs",
      "companyName",
      "brandColor",
      "clientTrustLines",
      "attackerKey",
    ]) {
      expect(payload).not.toHaveProperty(key);
    }
  });

  it("E. preserves the links-tab control value", () => {
    expect(buildLinksSettingsPayload({ clientLinkTtlDays: "7" })).toEqual({
      clientLinkTtlDays: "7",
    });
    expect(buildLinksSettingsPayload({ clientLinkTtlDays: 14 })).toEqual({
      clientLinkTtlDays: "14",
    });
    expect(buildLinksSettingsPayload({})).toEqual({ clientLinkTtlDays: "0" });
    expect(buildLinksSettingsPayload({ clientLinkTtlDays: "" })).toEqual({
      clientLinkTtlDays: "0",
    });
  });

  it("F. does not mutate the source form", () => {
    const form = { ...FULL_GET_LIKE_FORM };
    const before = JSON.stringify(form);
    buildLinksSettingsPayload(form);
    expect(JSON.stringify(form)).toBe(before);
  });

  it("G. is deterministic", () => {
    const a = buildLinksSettingsPayload(FULL_GET_LIKE_FORM);
    const b = buildLinksSettingsPayload(FULL_GET_LIKE_FORM);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("H. passes backend validateSettingsPatch", () => {
    const payload = buildLinksSettingsPayload(FULL_GET_LIKE_FORM);
    const result = validateSettingsPatch(payload);
    expect(result.ok).toBe(true);
    expect(result.forbiddenKeys).toBeUndefined();
    expect(result.invalidKeys).toBeUndefined();
    expect(result.values.get("clientLinkTtlDays")).toBe("30");
  });

  it("I. reproduces the old ...form failure and shows the fix", () => {
    const legacySpread = {
      ...FULL_GET_LIKE_FORM,
      materialCategories: JSON.stringify(["Каркас"]),
      clientSectionsJson: JSON.stringify([{ id: "purchase", label: "Закупка" }]),
    };
    const oldResult = validateSettingsPatch(legacySpread);
    expect(oldResult.ok).toBe(false);
    expect(oldResult.forbiddenKeys).toEqual(
      expect.arrayContaining(["farmSectionOrder", "farmSectionNames"]),
    );

    const newResult = validateSettingsPatch(buildLinksSettingsPayload(FULL_GET_LIKE_FORM));
    expect(newResult.ok).toBe(true);
  });

  it("J. SettingsPage save handler wires buildLinksSettingsPayload (not ...form)", () => {
    expect(settingsPageSrc).toContain("buildLinksSettingsPayload");
    expect(settingsPageSrc).toMatch(/buildLinksSettingsPayload\s*\(\s*form\s*\)/);
    // The links save must not spread the full form into the PATCH body.
    const saveBlock = settingsPageSrc.slice(
      settingsPageSrc.indexOf("const saveLinkSettings"),
      settingsPageSrc.indexOf("const addAdminKey"),
    );
    expect(saveBlock).toContain("buildLinksSettingsPayload(form)");
    expect(saveBlock).not.toMatch(/\.\.\.\s*form\b/);
    expect(saveBlock).not.toContain("materialCategories");
    expect(saveBlock).not.toContain("clientSectionsToSettings");
  });
});
