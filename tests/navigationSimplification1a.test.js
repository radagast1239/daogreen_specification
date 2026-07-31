import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const layout = fs.readFileSync(path.join(__dirname, "../src/components/Layout.jsx"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "../src/App.jsx"), "utf8");

describe("navigation simplification 1a", () => {
  it("keeps all previous sidebar routes", () => {
    for (const route of [
      "/",
      "/projects/in-progress",
      "/clients",
      "/materials",
      "/modules",
      "/suppliers",
      "/reports",
      "/archive",
      "/storage",
      "/settings",
      "/new",
      "/planner",
      "/planner/frame",
    ]) {
      expect(layout).toContain(`to: "${route}"`);
    }
  });

  it("uses simplified labels and groups", () => {
    expect(layout).toContain("Шаблоны и справочники");
    expect(layout).not.toContain("Модули и шаблоны");
    expect(layout).toContain("+ Создать проект");
    expect(layout).not.toContain('label: "Новый проект"');
    expect(layout).toContain('label: "Проекты"');
    expect(layout).toContain('label: "База"');
    expect(layout).toContain('label: "Проектирование"');
    expect(layout).toContain("Система");
    expect(layout).toContain("Калькуляторы");
  });

  it("keeps create-project and clients routes in App", () => {
    expect(app).toContain('path="/new"');
    expect(app).toContain('path="/clients"');
    expect(app).toContain('path="/modules"');
    expect(app).toContain('path="/projects/in-progress"');
    expect(app).toContain('path="/archive"');
  });
});
