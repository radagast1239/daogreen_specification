import { describe, expect, it, beforeEach } from "vitest";
import { configureClientSections, DEFAULT_CLIENT_SECTIONS } from "../shared/clientSections.js";
import {
  analyzeMaterialsQuality,
  collectBaseMaterialIssues,
  isPriceOptionalMaterial,
  materialShownToClientByDefault,
  resolveMaterialResponsibleState,
} from "../shared/materialQualityCheck.js";
import { COOLING_SPEC_KIND } from "../shared/itemTypes.js";

beforeEach(() => {
  configureClientSections(DEFAULT_CLIENT_SECTIONS);
});

const baseMaterial = (over = {}) => ({
  id: over.id || "m1",
  name: "Болт М6",
  unit: "шт.",
  basePrice: 10,
  supplier: "Ozon",
  link: "https://example.com/bolt",
  linkAlt: "https://backup.example.com/bolt",
  photoUrl: "https://example.com/photo.jpg",
  clientSection: "stellage",
  clientSubsection: "Крепёж",
  responsible: "installer",
  clientNote: "Крепёж для каркаса",
  clientVisibleDefault: true,
  status: "active",
  category: "Крепёж",
  ...over,
});

describe("collectBaseMaterialIssues", () => {
  it("материал без ссылки получает no_link warning", () => {
    const issues = collectBaseMaterialIssues(baseMaterial({ link: "" }), new Set());
    expect(issues.some((i) => i.id === "no_link")).toBe(true);
    expect(issues.find((i) => i.id === "no_link")?.severity).toBe("warning");
  });

  it("материал без фото получает warning no_photo", () => {
    const issues = collectBaseMaterialIssues(
      baseMaterial({ photoUrl: "", imageUrl: "" }),
      new Set()
    );
    const photo = issues.find((i) => i.id === "no_photo");
    expect(photo).toBeTruthy();
    expect(photo.severity).toBe("warning");
  });

  it("материал без clientSection получает critical no_client_section", () => {
    const issues = collectBaseMaterialIssues(
      baseMaterial({
        name: "Позиция без раздела",
        clientSection: "",
        clientSubsection: "",
        category: "Прочее",
      }),
      new Set()
    );
    expect(issues.some((i) => i.id === "no_client_section")).toBe(true);
    expect(issues.find((i) => i.id === "no_client_section")?.severity).toBe("critical");
  });

  it("материал с ценой 0 получает no_price", () => {
    const issues = collectBaseMaterialIssues(baseMaterial({ basePrice: 0 }), new Set());
    expect(issues.some((i) => i.id === "no_price")).toBe(true);
  });

  it("responsible = general не считается no_responsible", () => {
    const issues = collectBaseMaterialIssues(baseMaterial({ responsible: "general" }), new Set());
    expect(issues.some((i) => i.id === "no_responsible")).toBe(false);
    expect(issues.some((i) => i.id === "general_responsible")).toBe(true);
    expect(issues.find((i) => i.id === "general_responsible")?.severity).toBe("info");
  });

  it("responsible empty/null считается no_responsible", () => {
    for (const responsible of ["", null, "none"]) {
      const issues = collectBaseMaterialIssues(baseMaterial({ responsible }), new Set());
      expect(issues.some((i) => i.id === "no_responsible")).toBe(true);
      expect(issues.some((i) => i.id === "general_responsible")).toBe(false);
    }
    expect(resolveMaterialResponsibleState({ responsible: "" })).toBe("empty");
    expect(resolveMaterialResponsibleState({ responsible: "general" })).toBe("general");
    expect(resolveMaterialResponsibleState({ responsible: "plumber" })).toBe("assigned");
  });
});

describe("isPriceOptionalMaterial", () => {
  it("cooling_spec не считается обычным материалом без цены", () => {
    const cooling = baseMaterial({
      basePrice: 0,
      kind: COOLING_SPEC_KIND,
      splitSpecs: [{ qty: 1, coolingKw: 2.5 }],
    });
    expect(isPriceOptionalMaterial(cooling)).toBe(true);
    const issues = collectBaseMaterialIssues(cooling, new Set());
    expect(issues.some((i) => i.id === "no_price")).toBe(false);
  });

  it("авто-спека сплит-систем с splitSpecs не требует цену", () => {
    const split = baseMaterial({
      id: "split1",
      name: "Сплит-система 2.5 кВт",
      basePrice: 0,
      splitSpecs: [{ qty: 1, coolingKw: 2.5 }],
    });
    expect(isPriceOptionalMaterial(split)).toBe(true);
    expect(collectBaseMaterialIssues(split, new Set()).some((i) => i.id === "no_price")).toBe(false);
  });
});

describe("analyzeMaterialsQuality", () => {
  it("находит дубли по name+unit", () => {
    const report = analyzeMaterialsQuality(
      [
        baseMaterial({ id: "a", name: "Болт М6", unit: "шт." }),
        baseMaterial({ id: "b", name: "болт м6", unit: "шт." }),
      ],
      { activeModuleNames: [] }
    );
    const dupEntries = report.entries.filter((e) =>
      e.issues.some((i) => i.id === "duplicate_name_unit")
    );
    expect(dupEntries.length).toBe(2);
  });

  it("находит дубли по purchaseKey", () => {
    const report = analyzeMaterialsQuality(
      [
        baseMaterial({ id: "a", purchaseKey: "bolt-m6", name: "Болт A" }),
        baseMaterial({ id: "b", purchaseKey: "bolt-m6", name: "Болт B", unit: "уп." }),
      ],
      { activeModuleNames: [] }
    );
    const dupEntries = report.entries.filter((e) =>
      e.issues.some((i) => i.id === "duplicate_purchase_key")
    );
    expect(dupEntries.length).toBe(2);
  });

  it("полностью заполненный материал считается готовым", () => {
    const report = analyzeMaterialsQuality([baseMaterial()], { activeModuleNames: [] });
    expect(report.readyCount).toBe(1);
    expect(report.problematicEntries.length).toBe(0);
    expect(materialShownToClientByDefault(baseMaterial())).toBe(true);
  });

  it("материал с general остаётся готовым к клиентской выдаче", () => {
    const report = analyzeMaterialsQuality(
      [baseMaterial({ responsible: "general" })],
      { activeModuleNames: [] }
    );
    expect(report.readyCount).toBe(1);
    expect(report.entries[0].issues.some((i) => i.id === "general_responsible")).toBe(true);
    expect(report.entries[0].issues.some((i) => i.id === "not_client_ready")).toBe(false);
  });

  it("материал без ссылки НЕ получает not_client_ready только из-за ссылки", () => {
    const report = analyzeMaterialsQuality(
      [baseMaterial({ link: "", clientVisibleDefault: true })],
      { activeModuleNames: [] }
    );
    const entry = report.entries[0];
    expect(entry.issues.some((i) => i.id === "no_link")).toBe(true);
    expect(entry.issues.some((i) => i.id === "not_client_ready")).toBe(false);
  });

  it("материал с критичными проблемами и clientVisibleDefault получает not_client_ready", () => {
    const report = analyzeMaterialsQuality(
      [
        baseMaterial({
          basePrice: 0,
          clientVisibleDefault: true,
        }),
      ],
      { activeModuleNames: [] }
    );
    const entry = report.entries[0];
    expect(entry.issues.some((i) => i.id === "not_client_ready")).toBe(true);
  });

  it("услуга без поставщика не получает not_client_ready", () => {
    const report = analyzeMaterialsQuality(
      [
        baseMaterial({
          supplier: "",
          category: "Услуги",
          clientVisibleDefault: true,
        }),
      ],
      { activeModuleNames: [] }
    );
    const entry = report.entries[0];
    expect(entry.issues.some((i) => i.id === "no_supplier")).toBe(true);
    expect(entry.issues.some((i) => i.id === "not_client_ready")).toBe(false);
  });

  it("no_supplier у обычного товара = critical, у услуги = warning", () => {
    const normal = collectBaseMaterialIssues(baseMaterial({ supplier: "" }), new Set());
    expect(normal.find((i) => i.id === "no_supplier")?.severity).toBe("critical");

    const service = collectBaseMaterialIssues(baseMaterial({ supplier: "", category: "Работы и доставка" }), new Set());
    expect(service.find((i) => i.id === "no_supplier")?.severity).toBe("warning");
  });

  it("Мусорные пакеты не получают junk_in_name", () => {
    const issues = collectBaseMaterialIssues(baseMaterial({ name: "Мусорные пакеты 120л" }), new Set());
    expect(issues.some((i) => i.id === "junk_in_name")).toBe(false);
  });

  it("материал из BOM (frame_bom) проверяется как обычный каталожный материал", () => {
    const bomMat = baseMaterial({
      id: "m036",
      name: "Труба профильная 20/20/1,5 мм",
      clientSection: "stellage",
      clientSubsection: "Каркас и профиль",
    });
    const issues = collectBaseMaterialIssues(bomMat, new Set());
    expect(issues.some((i) => i.id === "no_price")).toBe(false);
    expect(issues.some((i) => i.id === "no_supplier")).toBe(false);
    expect(issues.some((i) => i.id === "no_client_section")).toBe(false);
  });
});
