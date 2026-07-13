import { describe, expect, it } from "vitest";
import {
  schemeDisplayTitle,
  schemeFilenameFromUrl,
  listUploadedSchemes,
  findSchemeIndexByKey,
  resolveClientSchemes,
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
});
