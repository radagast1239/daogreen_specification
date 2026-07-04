import { describe, expect, it } from "vitest";
import {
  DEFAULT_RESPONSIBLE_ROLES,
  mergeResponsibleRoles,
} from "../shared/responsibleRoles.js";
import { resolveResponsibleRoles } from "../src/lib/referenceData.js";

describe("DEFAULT_RESPONSIBLE_ROLES", () => {
  it("содержит climate / Климат", () => {
    const climate = DEFAULT_RESPONSIBLE_ROLES.find((r) => r.id === "climate");
    expect(climate).toEqual({ id: "climate", label: "Климат" });
  });
});

describe("mergeResponsibleRoles", () => {
  const savedWithoutClimate = [
    { id: "plumber", label: "Сантехник" },
    { id: "electrician", label: "Электрик" },
    { id: "installer", label: "Монтажник" },
    { id: "client", label: "Клиент" },
    { id: "purchaser", label: "Закупщик" },
    { id: "consumables", label: "Расходники" },
    { id: "general", label: "Общий" },
  ];

  it("добавляет climate, если его нет в сохранённых ролях", () => {
    const merged = mergeResponsibleRoles(savedWithoutClimate);
    expect(merged.some((r) => r.id === "climate" && r.label === "Климат")).toBe(true);
  });

  it("сохраняет пользовательские роли", () => {
    const merged = mergeResponsibleRoles([
      ...savedWithoutClimate,
      { id: "custom_role", label: "Моя роль" },
    ]);
    expect(merged.some((r) => r.id === "custom_role")).toBe(true);
  });

  it("не дублирует climate", () => {
    const merged = mergeResponsibleRoles([
      { id: "climate", label: "Климат" },
      ...savedWithoutClimate,
    ]);
    expect(merged.filter((r) => r.id === "climate")).toHaveLength(1);
  });
});

describe("resolveResponsibleRoles", () => {
  it("merge из settings: climate появляется даже без него в refResponsibleRoles", () => {
    const roles = resolveResponsibleRoles({
      refResponsibleRoles: JSON.stringify([
        { id: "plumber", label: "Сантехник" },
        { id: "custom", label: "Кастом" },
      ]),
    });
    expect(roles.some((r) => r.id === "climate")).toBe(true);
    expect(roles.some((r) => r.id === "custom")).toBe(true);
  });
});
