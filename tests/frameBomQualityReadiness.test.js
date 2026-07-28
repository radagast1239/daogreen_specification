import { describe, expect, it, beforeEach } from "vitest";
import { configureClientSections, DEFAULT_CLIENT_SECTIONS } from "../shared/clientSections.js";
import {
  collectBaseMaterialIssues,
  analyzeMaterialsQuality,
} from "../shared/materialQualityCheck.js";
import { buildBulkPatchPayload } from "../shared/materialBulkActions.js";
import {
  FRAME_BOM_ADMIN_SOURCE_LABEL,
  FRAME_BOM_SOURCE,
  frameBomDraftToProjectItem,
  resolveAdminItemSourceLabel,
} from "../shared/frameBomProjectItems.js";
import {
  enrichItemForPublishCheck,
  enrichItemsForPublishCheck,
  runPrePublishCheck,
  READINESS_ISSUE_LABELS,
} from "../shared/projectReadiness.js";
import { lineVisibleToClient } from "../shared/itemTypes.js";
import { stripClientTechnicalFields } from "../shared/clientPurchaseRows.js";

beforeEach(() => {
  configureClientSections(DEFAULT_CLIENT_SECTIONS);
});

const catalogMaterial = (over = {}) => ({
  id: over.id || "m036",
  name: "Труба профильная 20/20/1,5 мм",
  unit: "м",
  basePrice: 120,
  supplier: "МеталлБаза",
  link: "https://example.com/tube",
  linkAlt: "https://backup.example.com/tube",
  photoUrl: "/photos/m036.jpg",
  clientSection: "stellage",
  clientSubsection: "Каркас и профиль",
  clientVisibleDefault: true,
  responsible: "installer",
  clientNote: "Профиль для каркаса",
  status: "active",
  category: "Металл",
  ...over,
});

const frameBomItem = (over = {}) => ({
  id: "fb1",
  materialId: "m036",
  name: "Труба профильная 20/20/1,5 мм",
  qty: 2,
  unit: "м",
  // Missing price (not explicit free 0) — enrich fills from catalog.
  price: null,
  supplier: "",
  link: "",
  photoUrl: "",
  imageUrl: "",
  clientSection: "",
  clientSubsection: "",
  includedInProject: true,
  visibleToClient: true,
  itemType: "material",
  source: FRAME_BOM_SOURCE,
  sourceType: FRAME_BOM_SOURCE,
  sourceKey: "frame_bom:d1:rack1:profile_tube_20x20",
  ...over,
});

describe("frame_bom quality / readiness pipeline", () => {
  it("materialQualityCheck treats BOM catalog material as normal material", () => {
    const mat = catalogMaterial();
    const issues = collectBaseMaterialIssues(mat, new Set());
    expect(issues.some((i) => i.id === "no_price")).toBe(false);
    expect(issues.some((i) => i.id === "no_photo")).toBe(false);

    const noPrice = collectBaseMaterialIssues(catalogMaterial({ basePrice: 0 }), new Set());
    expect(noPrice.some((i) => i.id === "no_price")).toBe(true);
  });

  it("frame_bom item without price triggers no_price after enrich when catalog has no price", () => {
    const item = frameBomItem({ price: null });
    const mat = catalogMaterial({ basePrice: 0 });
    const enriched = enrichItemForPublishCheck(item, mat);
    const res = runPrePublishCheck([enriched]);
    expect(res.problems.some((p) => p.issue === "no_price")).toBe(true);
  });

  it("frame_bom item with stale snapshot passes price/photo/url/supplier from catalog", () => {
    const item = frameBomItem({ price: null, supplier: "", link: "", photoUrl: "" });
    const mat = catalogMaterial();
    const enriched = enrichItemForPublishCheck(item, mat);
    expect(enriched.price).toBe(120);
    expect(enriched.supplier).toBe("МеталлБаза");
    expect(enriched.link).toBe("https://example.com/tube");
    expect(enriched.photoUrl).toBe("/photos/m036.jpg");

    const res = runPrePublishCheck([enriched]);
    expect(res.problems.some((p) => p.issue === "no_price")).toBe(false);
    expect(res.problems.some((p) => p.issue === "no_supplier")).toBe(false);
  });

  it("project visibleToClient=true overrides hidden material default", () => {
    const item = frameBomItem({
      materialId: "m034",
      visibleToClient: true,
    });
    const mat = catalogMaterial({
      id: "m034",
      name: "Соединитель NFT",
      clientVisibleDefault: false,
    });
    expect(lineVisibleToClient(item)).toBe(true);
    const enriched = enrichItemsForPublishCheck([item], new Map([["m034", mat]]));
    const res = runPrePublishCheck(enriched);
    expect(res.problems.some((p) => p.issue === "hidden_from_client")).toBe(false);
    expect(res.problems.some((p) => p.issue === "not_approved")).toBe(false);
  });

  it("source=frame_bom does not appear in client-facing quality labels", () => {
    const labels = Object.values(READINESS_ISSUE_LABELS).join(" ");
    expect(labels).not.toMatch(/frame_bom|sourceKey|drawingId/i);

    const item = frameBomItem({ price: null });
    const mat = catalogMaterial({ basePrice: 0 });
    const res = runPrePublishCheck([enrichItemForPublishCheck(item, mat)]);
    const problemText = JSON.stringify(res.problems);
    expect(problemText).not.toMatch(/frame_bom|sourceKey/i);
    expect(res.problems[0]?.label).not.toMatch(/frame_bom/i);
  });

  it("admin sourceLabel is «Из схемы стеллажа»", () => {
    expect(resolveAdminItemSourceLabel(frameBomItem())).toBe(FRAME_BOM_ADMIN_SOURCE_LABEL);
    expect(resolveAdminItemSourceLabel({ source: "manual" })).toBe("");
    const draft = frameBomDraftToProjectItem(
      { materialId: "m036", name: "Труба", qty: 1, unit: "м" },
      { moduleRackKey: "rack1", drawingId: "d1" },
      "frame_bom:d1:rack1",
      0,
    );
    expect(draft.sourceLabel).toBe(FRAME_BOM_ADMIN_SOURCE_LABEL);
  });

  it("bulk patch payload does not include frame_bom technical fields", () => {
    for (const action of [
      ["responsible", "plumber"],
      ["supplier", "Ozon"],
      ["clientSection", "stellage", "Крепёж"],
      ["showClient"],
      ["hideClient"],
      ["setReview"],
      ["clearReview"],
    ]) {
      const payload = buildBulkPatchPayload(...action);
      const blob = JSON.stringify(payload);
      expect(blob).not.toMatch(/frame_bom|sourceKey|sourceType|drawingId|moduleRackKey/i);
    }
  });

  it("client-ready calculation includes visible frame_bom items", () => {
    const item = frameBomItem();
    const mat = catalogMaterial();
    const enriched = enrichItemsForPublishCheck([item], new Map([["m036", mat]]));
    const res = runPrePublishCheck(enriched);
    expect(res.readiness.shownToClient).toBe(1);
    expect(res.ok).toBe(true);
  });

  it("hidden material in catalog does not add not_client_ready when material default hidden", () => {
    const report = analyzeMaterialsQuality(
      [catalogMaterial({ id: "m034", clientVisibleDefault: false, basePrice: 0 })],
      { activeModuleNames: [] },
    );
    const entry = report.entries[0];
    expect(entry.issues.some((i) => i.id === "no_price")).toBe(true);
    expect(entry.issues.some((i) => i.id === "not_client_ready")).toBe(false);
  });

  it("admin source label exposes only human text, no sourceKey", () => {
    const item = frameBomItem();
    const label = resolveAdminItemSourceLabel(item);
    expect(label).toBe(FRAME_BOM_ADMIN_SOURCE_LABEL);
    expect(label).not.toMatch(/frame_bom|sourceKey|drawingId|moduleRackKey/i);
    expect(JSON.stringify({ label })).not.toMatch(/sourceKey/i);
  });

  it("ordinary project item has no admin source label", () => {
    expect(resolveAdminItemSourceLabel({ source: "manual", name: "Болт" })).toBe("");
    expect(resolveAdminItemSourceLabel({ name: "Болт" })).toBe("");
  });
});
