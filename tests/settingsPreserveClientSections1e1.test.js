import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  resolveModulesTabFromSearch,
  modulesTabToSearchParams,
} from "../src/lib/modulesTabUrl.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const settingsPage = fs.readFileSync(
  path.join(__dirname, "../src/pages/admin/SettingsPage.jsx"),
  "utf8"
);
const publishTab = fs.readFileSync(
  path.join(__dirname, "../src/pages/admin/PublishRulesTab.jsx"),
  "utf8"
);
const modulesPage = fs.readFileSync(
  path.join(__dirname, "../src/pages/admin/ModulesPage.jsx"),
  "utf8"
);
const editor = fs.readFileSync(
  path.join(__dirname, "../src/components/admin/ClientSectionsEditor.jsx"),
  "utf8"
);

describe("settings 1e.1 client sections preserve", () => {
  it("keeps ClientSectionsEditor on publish tab with same save helpers", () => {
    expect(publishTab).toContain('import ClientSectionsEditor from "../../components/admin/ClientSectionsEditor.jsx"');
    expect(publishTab).toContain("Разделы закупки для клиента");
    expect(publishTab).toContain("Настройте названия, порядок, подразделы и видимость разделов в клиентской выдаче");
    expect(publishTab).toContain("<ClientSectionsEditor sections={clientSections} onChange={setClientSections} />");
    expect(publishTab).toContain("clientSectionsToSettings");
    expect(publishTab).toContain("applyClientSectionsFromSettings");
    expect(publishTab).toContain("api.saveSettings(payload)");
    expect(editor).toContain("export default function ClientSectionsEditor");
  });

  it("Settings overview links client sections to publish and farm separately", () => {
    expect(settingsPage).toContain("Разделы клиентской выдачи");
    expect(settingsPage).toContain('to="/modules?tab=publish"');
    expect(settingsPage).toContain("Настроить разделы");
    expect(settingsPage).toContain("Разделы фермы");
    expect(settingsPage).toContain('to="/modules?tab=farm"');
    expect(settingsPage).not.toContain("ClientSectionsEditor");
  });

  it("ModulesPage syncs tab with URL query for clicks and history", () => {
    expect(modulesPage).toContain("useSearchParams");
    expect(modulesPage).toContain("selectTab");
    expect(modulesPage).toContain("resolveModulesTabFromSearch");
    expect(modulesPage).toContain("modulesTabToSearchParams");
    expect(modulesPage).toContain("{ replace: false }");
    expect(resolveModulesTabFromSearch("?tab=publish")).toBe("publish");
    expect(resolveModulesTabFromSearch("tab=brand")).toBe("brand");
    expect(resolveModulesTabFromSearch("?tab=nope")).toBe("farm");
    expect(resolveModulesTabFromSearch("")).toBe("farm");
    const next = modulesTabToSearchParams("directories", "tab=farm&x=1");
    expect(next.get("tab")).toBe("directories");
    expect(next.get("x")).toBe("1");
    const back = modulesTabToSearchParams("farm", next);
    expect(back.get("tab")).toBe("farm");
  });
});
