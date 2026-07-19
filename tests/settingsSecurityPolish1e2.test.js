import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  PRIMARY_ADMIN_USER_ID,
  filterExtraAdminUsers,
  isPrimaryAdminUser,
} from "../src/lib/settingsUi.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const settingsPage = fs.readFileSync(
  path.join(__dirname, "../src/pages/admin/SettingsPage.jsx"),
  "utf8"
);
const settingsUi = fs.readFileSync(
  path.join(__dirname, "../src/lib/settingsUi.js"),
  "utf8"
);
const modulesUi = fs.readFileSync(
  path.join(__dirname, "../src/components/modulesUi.jsx"),
  "utf8"
);
const authJs = fs.readFileSync(path.join(__dirname, "../backend/src/auth.js"), "utf8");

const sample = [
  {
    id: "env-primary",
    name: "Primary (env)",
    apiKey: "super-secret-env-key-abcdef",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "adm_1",
    name: "Оператор",
    apiKey: "user-extra-key-9999",
    createdAt: "2026-02-01T00:00:00.000Z",
  },
];

describe("settings security polish 1e2", () => {
  it("detects primary via stable env-primary id from auth seed", () => {
    expect(authJs).toContain("'env-primary'");
    expect(authJs).toContain("Primary (env)");
    expect(PRIMARY_ADMIN_USER_ID).toBe("env-primary");
    expect(isPrimaryAdminUser(sample[0])).toBe(true);
    expect(isPrimaryAdminUser(sample[1])).toBe(false);
    expect(isPrimaryAdminUser({ id: "x", name: "Primary (env)" })).toBe(false);
  });

  it("filters primary out of extra keys list", () => {
    const extra = filterExtraAdminUsers(sample);
    expect(extra).toHaveLength(1);
    expect(extra[0].id).toBe("adm_1");
    expect(extra[0].name).toBe("Оператор");
    expect(filterExtraAdminUsers([sample[0]])).toEqual([]);
  });

  it("Settings UI hides primary from extras and keeps user keys", () => {
    expect(settingsPage).toContain("filterExtraAdminUsers");
    expect(settingsPage).toContain("extraAdminUsers");
    expect(settingsPage).toContain("Основной доступ настроен на сервере");
    expect(settingsPage).not.toContain("ADMIN_KEY");
    expect(settingsPage).toContain("Дополнительные ключи не созданы");
    expect(settingsPage).toContain("isPrimaryAdminUser(u)");
    expect(settingsPage).toContain("api.createAdminUser");
    expect(settingsPage).toContain("api.deleteAdminUser");
    expect(settingsUi).toContain("PRIMARY_ADMIN_USER_ID");
  });

  it("keeps security and tech details closed by default", () => {
    expect(settingsPage).toContain("extraKeysOpen");
    expect(settingsPage).toContain("useState(false)");
    expect(settingsPage).toMatch(/open=\{extraKeysOpen\}/);
    expect(settingsPage).toContain("setExtraKeysOpen(true)");
    expect(settingsPage).toContain("<TechDetails summary=\"Техническая информация\">");
    expect(modulesUi).toContain('<details className="modules-tech">');
    expect(modulesUi).not.toMatch(/<details[^>]*\sopen/);
  });

  it("keeps compact save button for link TTL", () => {
    expect(settingsPage).toContain("settings-links-save");
    expect(settingsPage).toContain("saveLinkSettings");
  });
});
