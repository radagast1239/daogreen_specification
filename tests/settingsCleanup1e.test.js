import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  SETTINGS_TABS,
  adminKeyFingerprint,
  previewNames,
} from "../src/lib/settingsUi.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const settingsPage = fs.readFileSync(
  path.join(__dirname, "../src/pages/admin/SettingsPage.jsx"),
  "utf8"
);
const modulesPage = fs.readFileSync(
  path.join(__dirname, "../src/pages/admin/ModulesPage.jsx"),
  "utf8"
);
const layout = fs.readFileSync(
  path.join(__dirname, "../src/components/Layout.jsx"),
  "utf8"
);

describe("settingsUi helpers", () => {
  it("exposes overview/links/security/system tabs", () => {
    expect(SETTINGS_TABS.map((t) => t.id)).toEqual([
      "overview",
      "links",
      "security",
      "system",
    ]);
  });

  it("fingerprints only last 4 chars", () => {
    expect(adminKeyFingerprint("abcdefghijkl")).toBe("ijkl");
    expect(adminKeyFingerprint("ab")).toBe(null);
    expect(adminKeyFingerprint("")).toBe(null);
  });

  it("previews names without mutating", () => {
    const list = ["a", "b", "c", "d", "e"];
    expect(previewNames(list, 3)).toEqual(["a", "b", "c"]);
    expect(list).toHaveLength(5);
  });
});

describe("SettingsPage cleanup 1e", () => {
  it("retitles page and uses section tabs", () => {
    expect(settingsPage).toContain('title="Настройки"');
    expect(settingsPage).toContain("Ссылки, доступ и системные параметры приложения");
    expect(settingsPage).toContain("SETTINGS_TABS");
    expect(SETTINGS_TABS.some((t) => t.label === "Обзор")).toBe(true);
    expect(SETTINGS_TABS.some((t) => t.label === "Безопасность")).toBe(true);
    expect(layout).toContain("/settings");
  });

  it("links overview cards to brand/directories/farm/publish without local editors", () => {
    expect(settingsPage).toContain('to="/modules?tab=brand"');
    expect(settingsPage).toContain('to="/modules?tab=directories"');
    expect(settingsPage).toContain('to="/modules?tab=farm"');
    expect(settingsPage).toContain('to="/modules?tab=publish"');
    expect(settingsPage).toContain("Открыть клиент и бренд");
    expect(settingsPage).toContain("Открыть справочники");
    expect(settingsPage).toContain("Открыть структуру фермы");
    expect(settingsPage).toContain("Настроить разделы");
    expect(settingsPage).not.toContain("ClientSectionsEditor");
    expect(settingsPage).not.toContain("Новая категория");
    expect(settingsPage).not.toContain('["companyName"');
  });

  it("keeps a single client link TTL field and preserves save payload fields", () => {
    const ttlMatches = settingsPage.match(/clientLinkTtlDays/g) || [];
    expect(ttlMatches.length).toBeGreaterThanOrEqual(2);
    expect(settingsPage).toContain("Срок действия клиентской ссылки");
    expect(settingsPage).toContain("Применяется к новым клиентским ссылкам");
    expect(settingsPage).toContain("api.saveSettings");
    expect(settingsPage).toContain("clientSectionsToSettings");
    expect(settingsPage).toContain('success("Сохранено")');
  });

  it("hides server key and shows safe extra-key fingerprints", () => {
    expect(settingsPage).toContain("Основной доступ настроен на сервере");
    expect(settingsPage).not.toContain("ADMIN_KEY");
    expect(settingsPage).not.toContain("Primary (env)");
    expect(settingsPage).not.toContain("slice(0, 8)");
    expect(settingsPage).toContain("adminKeyFingerprint");
    expect(settingsPage).toContain("Дополнительные ключи доступа");
    expect(settingsPage).toContain("api.deleteAdminUser");
    expect(settingsPage).toContain("api.createAdminUser");
  });

  it("points system section to storage and keeps backup secondary", () => {
    expect(settingsPage).toContain('to="/storage"');
    expect(settingsPage).toContain("Открыть файлы и хранилище");
    expect(settingsPage).toContain("Скачать резервную копию");
    expect(settingsPage).toContain("api.downloadBackup");
    expect(settingsPage).toContain("TechDetails");
  });

  it("ModulesPage opens and syncs tab from query for settings deep links", () => {
    expect(modulesPage).toContain("resolveModulesTabFromSearch");
    expect(modulesPage).toContain("useSearchParams");
    expect(modulesPage).toContain("selectTab");
  });
});
