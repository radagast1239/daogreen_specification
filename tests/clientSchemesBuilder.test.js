import { describe, expect, it } from "vitest";
import {
  CLIENT_SCHEME_DEFS,
  SCHEME_SLOT_KEYS,
  countFilledSchemes,
  filledSchemeSlots,
  hydrateSchemeSlotsFromManualParams,
  listAllSchemeSlots,
  patchManualSchemes,
} from "../src/lib/clientSchemes.js";
import { hydrateBuilderFromProject } from "../src/lib/projectBuilderHydrate.js";
import { DEFAULT_MANUAL_PARAMS } from "../src/lib/itemHelpers.js";

const FIVE = {
  floorPlanUrl: "/uploads/floor.png",
  schemePipesUrl: "/uploads/pipes.png",
  schemeStellagesUrl: "/uploads/stellages.png",
  schemeTechnicalUrl: "/uploads/tech.png",
  schemeElectricalUrl: "/uploads/elec.png",
};

describe("multi scheme slots (builder)", () => {
  it("defines exactly 5 stable keys", () => {
    expect(SCHEME_SLOT_KEYS).toEqual([
      "floorPlanUrl",
      "schemePipesUrl",
      "schemeStellagesUrl",
      "schemeTechnicalUrl",
      "schemeElectricalUrl",
    ]);
    expect(CLIENT_SCHEME_DEFS).toHaveLength(5);
    expect(DEFAULT_MANUAL_PARAMS.floorPlanUrl).toBe("");
    expect(DEFAULT_MANUAL_PARAMS.schemePipesUrl).toBe("");
    expect(DEFAULT_MANUAL_PARAMS.schemeStellagesUrl).toBe("");
    expect(DEFAULT_MANUAL_PARAMS.schemeTechnicalUrl).toBe("");
    expect(DEFAULT_MANUAL_PARAMS.schemeElectricalUrl).toBe("");
  });

  it("hydrates all 5 slots from manualParams", () => {
    const slots = hydrateSchemeSlotsFromManualParams(FIVE);
    expect(slots).toEqual(FIVE);
    const listed = listAllSchemeSlots(FIVE);
    expect(listed).toHaveLength(5);
    expect(listed.every((s) => s.url && s.label)).toBe(true);
    expect(countFilledSchemes(FIVE)).toBe(5);
    expect(filledSchemeSlots(FIVE).map((s) => s.key)).toEqual(SCHEME_SLOT_KEYS);
  });

  it("patch upload/replace/remove affects only one slot", () => {
    let mp = { ...FIVE, notes: "keep" };
    mp = patchManualSchemes(mp, "schemePipesUrl", "/uploads/pipes-new.png");
    expect(mp.schemePipesUrl).toBe("/uploads/pipes-new.png");
    expect(mp.floorPlanUrl).toBe(FIVE.floorPlanUrl);
    expect(mp.schemeStellagesUrl).toBe(FIVE.schemeStellagesUrl);
    expect(mp.notes).toBe("keep");

    mp = patchManualSchemes(mp, "schemeTechnicalUrl", "");
    expect(mp.schemeTechnicalUrl).toBe("");
    expect(mp.floorPlanUrl).toBe(FIVE.floorPlanUrl);
    expect(mp.schemePipesUrl).toBe("/uploads/pipes-new.png");
    expect(countFilledSchemes(mp)).toBe(4);
  });

  it("does not overwrite floorPlanUrl when patching another scheme", () => {
    const before = FIVE.floorPlanUrl;
    const next = patchManualSchemes(FIVE, "schemeElectricalUrl", "/uploads/e2.png");
    expect(next.floorPlanUrl).toBe(before);
    expect(next.schemeElectricalUrl).toBe("/uploads/e2.png");
  });

  it("selector / pin helpers see all filled schemes", () => {
    const filled = filledSchemeSlots({
      floorPlanUrl: "/a.png",
      schemePipesUrl: "",
      schemeStellagesUrl: "/b.png",
      schemeTechnicalUrl: "",
      schemeElectricalUrl: "/c.png",
    });
    expect(filled.map((s) => s.key)).toEqual([
      "floorPlanUrl",
      "schemeStellagesUrl",
      "schemeElectricalUrl",
    ]);
    expect(countFilledSchemes({ floorPlanUrl: "/a.png" })).toBe(1);
  });

  it("viewer session index is independent of patch (no project write)", () => {
    // Pure contract: navigating viewer must not call patchManualSchemes.
    // Simulate session: starting index + local next index leave mp untouched.
    const mp = { ...FIVE };
    const schemes = filledSchemeSlots(mp);
    let sessionIndex = 0;
    sessionIndex = (sessionIndex + 1) % schemes.length;
    sessionIndex = (sessionIndex + 1) % schemes.length;
    expect(sessionIndex).toBe(2);
    expect(mp).toEqual(FIVE);
    expect(schemes[sessionIndex].key).toBe("schemeStellagesUrl");
    expect(mp.floorPlanUrl).toBe(FIVE.floorPlanUrl);
  });

  it("hydrateBuilderFromProject keeps all scheme slots on edit", () => {
    const project = {
      id: "p1",
      name: "Farm",
      client: "Client",
      type: "проточка",
      status: "active",
      items: [],
      rooms: [],
      stellageConfigs: [],
      manualParams: {
        ...DEFAULT_MANUAL_PARAMS,
        ...FIVE,
        notes: "n",
      },
    };
    const hydrated = hydrateBuilderFromProject(project, {
      sections: [],
      farmCatalogs: {},
      stellageCatalogs: {},
      materials: [],
    });
    const slots = hydrateSchemeSlotsFromManualParams(hydrated.form.manualParams);
    expect(slots).toEqual(FIVE);
    expect(hydrated.form.manualParams.notes).toBe("n");
  });

  it("ignores unknown keys in patchManualSchemes", () => {
    const mp = patchManualSchemes(FIVE, "notAScheme", "/x.png");
    expect(mp.notAScheme).toBeUndefined();
    expect(mp.floorPlanUrl).toBe(FIVE.floorPlanUrl);
  });
});
