import { describe, expect, it } from "vitest";
import {
  schemeDisplayTitle,
  schemeFilenameFromUrl,
  listUploadedSchemes,
  findSchemeIndexByKey,
  resolveClientSchemes,
  listProjectSchemes,
  hydrateFromLegacySlots,
  patchProjectSchemes,
  addProjectScheme,
  updateProjectScheme,
  removeProjectScheme,
  moveProjectScheme,
  clientVisibleSchemes,
  getFloorPlanUrl,
  setFloorPlanUrl,
} from "../src/lib/clientSchemes.js";

describe("clientSchemes multi-viewer helpers", () => {
  it("schemeFilenameFromUrl strips query and path", () => {
    expect(schemeFilenameFromUrl("/uploads/plan%20A.png?x=1")).toBe("plan A.png");
    expect(schemeFilenameFromUrl("")).toBe("");
  });

  it("schemeDisplayTitle prefers label, then filename, then fallback", () => {
    expect(schemeDisplayTitle({ label: "Схема труб", url: "/a.png" }, 0)).toBe("Схема труб");
    expect(schemeDisplayTitle({ title: "Моя схема", label: "ignore" }, 0)).toBe("Моя схема");
    expect(schemeDisplayTitle({ url: "/uploads/pipes.jpg" }, 2)).toBe("pipes.jpg");
    expect(schemeDisplayTitle({}, 3)).toBe("Схема 4");
  });

  it("listUploadedSchemes returns only keys with urls and stable titles", () => {
    const list = listUploadedSchemes({
      floorPlanUrl: "/f.png",
      schemePipesUrl: "/p.png",
      schemeElectricalUrl: "",
    });
    expect(list.map((s) => s.key)).toEqual(["floorPlanUrl", "schemePipesUrl"]);
    expect(list[0].title).toContain("Общая схема");
    expect(list[1].title).toContain("труб");
  });

  it("findSchemeIndexByKey falls back to 0", () => {
    const list = resolveClientSchemes({ floorPlanUrl: "/a", schemePipesUrl: "/b" });
    expect(findSchemeIndexByKey(list, "schemePipesUrl")).toBe(1);
    expect(findSchemeIndexByKey(list, "missing")).toBe(0);
  });

  it("optional schemeNames override label without schema change", () => {
    const list = listUploadedSchemes({
      floorPlanUrl: "/f.png",
      schemeNames: { floorPlanUrl: "План этажа 1" },
    });
    expect(list[0].title).toBe("План этажа 1");
  });

  it("hydrates legacy slots into projectSchemes shape", () => {
    const list = hydrateFromLegacySlots({
      floorPlanUrl: "/f.png",
      schemePipesUrl: "/p.png",
      schemeNames: { floorPlanUrl: "План" },
      clientSchemeVisible: { schemePipesUrl: false },
    });
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: "floorPlanUrl", url: "/f.png", title: "План", clientVisible: true });
    expect(list[1]).toMatchObject({ id: "schemePipesUrl", url: "/p.png", clientVisible: false });
  });

  it("projectSchemes array is source of truth even when empty", () => {
    expect(listProjectSchemes({ projectSchemes: [], floorPlanUrl: "/legacy.png" })).toEqual([]);
  });

  it("add / rename / reorder / remove projectSchemes", () => {
    let mp = { notes: "keep" };
    mp = addProjectScheme(mp, { title: "A", url: "/a.png" });
    mp = addProjectScheme(mp, { title: "B", url: "/b.png" });
    mp = addProjectScheme(mp, { title: "C", url: "" });
    expect(mp.notes).toBe("keep");
    expect(listProjectSchemes(mp)).toHaveLength(3);

    const idB = listProjectSchemes(mp)[1].id;
    mp = updateProjectScheme(mp, idB, { title: "B2" });
    expect(listProjectSchemes(mp)[1].title).toBe("B2");

    mp = moveProjectScheme(mp, idB, "up");
    expect(listProjectSchemes(mp).map((s) => s.title)).toEqual(["B2", "A", "C"]);

    mp = removeProjectScheme(mp, listProjectSchemes(mp)[2].id);
    expect(listProjectSchemes(mp).map((s) => s.title)).toEqual(["B2", "A"]);
    expect(listUploadedSchemes(mp)).toHaveLength(2);
  });

  it("clientVisibleSchemes filters by clientVisible", () => {
    const mp = patchProjectSchemes({}, [
      { id: "1", title: "Show", url: "/a.png", clientVisible: true },
      { id: "2", title: "Hide", url: "/b.png", clientVisible: false },
      { id: "3", title: "Empty", url: "", clientVisible: true },
    ]);
    expect(clientVisibleSchemes(mp).map((s) => s.id)).toEqual(["1"]);
  });

  it("FloorPlanField round-trip syncs projectSchemes[0] for viewer", () => {
    let mp = patchProjectSchemes(
      { floorPlanUrl: "/legacy-ignored.png" },
      [
        { id: "sch_main", title: "План", url: "/old.png", clientVisible: true },
        { id: "sch_pipes", title: "Трубы", url: "/pipes.png", clientVisible: true },
      ],
    );
    expect(getFloorPlanUrl(mp)).toBe("/old.png");
    expect(listUploadedSchemes(mp)[0].url).toBe("/old.png");

    mp = setFloorPlanUrl(mp, "/new-plan.png");
    expect(getFloorPlanUrl(mp)).toBe("/new-plan.png");
    expect(mp.floorPlanUrl).toBe("/new-plan.png");
    expect(listProjectSchemes(mp)[0].url).toBe("/new-plan.png");
    expect(listProjectSchemes(mp)[1].url).toBe("/pipes.png");
    expect(clientVisibleSchemes(mp).find((s) => s.id === "sch_main")?.url).toBe("/new-plan.png");
    expect(listUploadedSchemes(mp)[0].url).toBe("/new-plan.png");
  });

  it("setFloorPlanUrl keeps legacy-only projects on floorPlanUrl", () => {
    const mp = setFloorPlanUrl({ notes: "x", floorPlanUrl: "/a.png" }, "/b.png");
    expect(mp.floorPlanUrl).toBe("/b.png");
    expect(mp.projectSchemes).toBeUndefined();
    expect(mp.notes).toBe("x");
    expect(getFloorPlanUrl(mp)).toBe("/b.png");
  });
});
