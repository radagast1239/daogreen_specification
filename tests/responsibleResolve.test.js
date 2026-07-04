import { describe, expect, it, beforeEach } from "vitest";
import { configureClientSections, DEFAULT_CLIENT_SECTIONS } from "../shared/clientSections.js";
import {
  resolveResponsibleFull,
  fillMissingResponsible,
  fallbackResponsibleBySection,
  isConcreteResponsible,
  rowsForResponsibleRole,
  SECTION_RESPONSIBLE_FALLBACK,
} from "../src/lib/responsibleResolve.js";

beforeEach(() => {
  configureClientSections(DEFAULT_CLIENT_SECTIONS);
});

const item = (over = {}) => ({ name: "X", clientSection: "", responsible: "", category: "", ...over });

describe("isConcreteResponsible", () => {
  it("general и пусто = не назначено", () => {
    expect(isConcreteResponsible("")).toBe(false);
    expect(isConcreteResponsible(null)).toBe(false);
    expect(isConcreteResponsible("general")).toBe(false);
  });
  it("конкретная роль = назначено", () => {
    expect(isConcreteResponsible("plumber")).toBe(true);
    expect(isConcreteResponsible("installer")).toBe(true);
  });
});

describe("resolveResponsibleFull — приоритет", () => {
  it("project responsible имеет высший приоритет над material default", () => {
    expect(resolveResponsibleFull(item({ responsible: "installer" }), { materialDefault: "plumber" })).toBe("installer");
  });

  it("material default используется, если у позиции пусто", () => {
    expect(resolveResponsibleFull(item({ responsible: "" }), { materialDefault: "plumber" })).toBe("plumber");
  });

  it("general у позиции не блокирует material default", () => {
    expect(resolveResponsibleFull(item({ responsible: "general" }), { materialDefault: "electrician" })).toBe("electrician");
  });

  it("fallback по разделу, если нет ни позиции, ни material default", () => {
    expect(resolveResponsibleFull(item({ clientSection: "electrics" }))).toBe("electrician");
  });
});

describe("fallback по клиентскому разделу", () => {
  it("профильная труба (stellage) → монтажник", () => {
    expect(resolveResponsibleFull(item({ clientSection: "stellage" }))).toBe("installer");
    expect(resolveResponsibleFull(item({ clientSection: "stellage" }))).not.toBe("plumber");
  });

  it("труба ПП / насос / бак / полив / дренаж / водоподготовка → сантехник", () => {
    for (const s of ["irrigation", "drainage", "pumps", "tanks", "water_prep"]) {
      expect(resolveResponsibleFull(item({ clientSection: s }))).toBe("plumber");
    }
  });

  it("кабель / щит / датчики / освещение → электрик", () => {
    for (const s of ["electrics", "automation", "lighting"]) {
      expect(resolveResponsibleFull(item({ clientSection: s }))).toBe("electrician");
    }
  });

  it("монтажные разделы (каркас, лотки, инструмент, работы) → монтажник", () => {
    for (const s of ["stellage", "trays_channels", "manipulation", "tools", "works_delivery"]) {
      expect(resolveResponsibleFull(item({ clientSection: s }))).toBe("installer");
    }
  });

  it("климатический раздел → климат", () => {
    expect(resolveResponsibleFull(item({ clientSection: "climate" }))).toBe("climate");
  });

  it("fallbackResponsibleBySection возвращает null для неизвестного раздела", () => {
    expect(fallbackResponsibleBySection("__nope__")).toBe(null);
  });

  it("карта fallback покрывает все четыре специализации", () => {
    const roles = new Set(Object.values(SECTION_RESPONSIBLE_FALLBACK));
    expect(roles.has("plumber")).toBe(true);
    expect(roles.has("electrician")).toBe(true);
    expect(roles.has("installer")).toBe(true);
    expect(roles.has("climate")).toBe(true);
  });
});

describe("rowsForResponsibleRole — единая фильтрация для PDF/Excel/специалистов", () => {
  // склеенная строка: набор source-items
  const mergedRow = (name, srcs) => ({
    name,
    sourceItems: srcs.map((s) => ({ clientSection: "", responsible: "", category: "", ...s })),
  });

  const rows = [
    mergedRow("Труба ПП", [{ clientSection: "irrigation" }]),
    mergedRow("Насос", [{ clientSection: "pumps" }]),
    mergedRow("Бак", [{ clientSection: "tanks" }]),
    mergedRow("Профильная труба", [{ clientSection: "stellage" }]),
    mergedRow("Краб-система", [{ clientSection: "stellage" }]),
    mergedRow("Болты/гайки/шайбы", [{ category: "Каркас и крепёж" }]),
    mergedRow("Лоток", [{ clientSection: "trays_channels" }]),
    mergedRow("Работы", [{ clientSection: "works_delivery" }]),
    mergedRow("Щит", [{ clientSection: "electrics" }]),
    mergedRow("Датчик", [{ clientSection: "automation" }]),
    mergedRow("Кабель", [{ clientSection: "electrics" }]),
  ];

  const names = (role) => rowsForResponsibleRole(rows, role).map((r) => r.name);

  it("сантехник: трубы/насосы/баки, но НЕ профиль/крепёж", () => {
    const plumber = names("plumber");
    expect(plumber).toContain("Труба ПП");
    expect(plumber).toContain("Насос");
    expect(plumber).toContain("Бак");
    expect(plumber).not.toContain("Профильная труба");
    expect(plumber).not.toContain("Краб-система");
    expect(plumber).not.toContain("Болты/гайки/шайбы");
  });

  it("монтажник: профиль/крабы/крепёж/лотки/работы", () => {
    const installer = names("installer");
    expect(installer).toContain("Профильная труба");
    expect(installer).toContain("Краб-система");
    expect(installer).toContain("Болты/гайки/шайбы");
    expect(installer).toContain("Лоток");
    expect(installer).toContain("Работы");
    expect(installer.length).toBeGreaterThan(0);
  });

  it("электрик: щит/кабель/датчики, без сантехники и каркаса", () => {
    const electric = names("electrician");
    expect(electric).toContain("Щит");
    expect(electric).toContain("Кабель");
    expect(electric).toContain("Датчик");
    expect(electric).not.toContain("Насос");
    expect(electric).not.toContain("Профильная труба");
  });

  it("строка попадает к роли, если хотя бы один source-item этой роли", () => {
    const mixed = [mergedRow("Смешанная", [{ clientSection: "stellage" }, { clientSection: "pumps" }])];
    expect(rowsForResponsibleRole(mixed, "plumber")).toHaveLength(1);
    expect(rowsForResponsibleRole(mixed, "installer")).toHaveLength(1);
  });

  it("климат: позиции с разделом климата", () => {
    const cl = mergedRow("Кондей", [{ clientSection: "climate" }]);
    expect(rowsForResponsibleRole([...rows, cl], "climate").map((r) => r.name)).toContain("Кондей");
  });

  it("client-позиции идут к роли client и НЕ смешиваются со специалистами", () => {
    const clientRows = [
      mergedRow("Клиентская позиция", [{ responsible: "client" }]),
      mergedRow("Труба ПП", [{ clientSection: "irrigation" }]),
      mergedRow("Профильная труба", [{ clientSection: "stellage" }]),
    ];
    expect(rowsForResponsibleRole(clientRows, "client").map((r) => r.name)).toEqual(["Клиентская позиция"]);
    for (const role of ["plumber", "electrician", "installer", "climate"]) {
      expect(rowsForResponsibleRole(clientRows, role).map((r) => r.name)).not.toContain("Клиентская позиция");
    }
  });
});

describe("fillMissingResponsible", () => {
  it("копирует material default в пустые позиции, но не перетирает назначенные", () => {
    const items = [
      item({ name: "A", responsible: "climate", materialId: "m1" }), // назначено вручную — не трогаем
      item({ name: "B", responsible: "", materialId: "m2" }), // возьмём material default
      item({ name: "C", responsible: "general", clientSection: "pumps", materialId: "m3" }), // fallback по разделу
    ];
    const materialsById = { m1: { responsible: "plumber" }, m2: { responsible: "electrician" }, m3: { responsible: "" } };
    const out = fillMissingResponsible(items, { materialsById });
    expect(out[0].responsible).toBe("climate"); // не перетёрт
    expect(out[1].responsible).toBe("electrician"); // из material default
    expect(out[2].responsible).toBe("plumber"); // fallback по разделу (pumps)
  });

  it("не мутирует исходный массив", () => {
    const items = [item({ responsible: "", clientSection: "stellage" })];
    const out = fillMissingResponsible(items);
    expect(items[0].responsible).toBe("");
    expect(out[0].responsible).toBe("installer");
  });

  it("работает без materialsById (только fallback по разделу)", () => {
    const out = fillMissingResponsible([item({ clientSection: "lighting" })]);
    expect(out[0].responsible).toBe("electrician");
  });
});
