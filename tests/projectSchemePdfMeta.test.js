import { describe, expect, it } from "vitest";
import {
  addProjectScheme,
  getFloorPlanEntry,
  listProjectSchemes,
  removeProjectScheme,
  setFloorPlanTitle,
  setFloorPlanUrl,
  updateProjectScheme,
  clientVisibleSchemes,
} from "../src/lib/clientSchemes.js";
import { buildClientImageManifest } from "../shared/clientImageManifest.js";
import { isPdfScheme } from "../src/lib/schemeMedia.js";

describe("project scheme PDF metadata", () => {
  it("stores mimeType application/pdf on floor plan and client schemes", () => {
    let mp = { projectSchemes: [] };
    mp = setFloorPlanUrl(mp, "/uploads/plan.pdf", {
      mimeType: "application/pdf",
      title: "План PDF",
    });
    const floor = getFloorPlanEntry(mp);
    expect(floor.url).toBe("/uploads/plan.pdf");
    expect(floor.mimeType).toBe("application/pdf");
    expect(floor.title).toBe("План PDF");
    expect(isPdfScheme(floor)).toBe(true);

    mp = addProjectScheme(mp, {
      title: "Трубы",
      url: "/uploads/pipes.pdf",
      mimeType: "application/pdf",
      clientVisible: true,
    });
    mp = addProjectScheme(mp, {
      title: "Фото",
      url: "/uploads/photo.png",
      mimeType: "image/png",
      clientVisible: true,
    });
    const list = listProjectSchemes(mp);
    expect(list.filter((s) => s.url).length).toBeGreaterThanOrEqual(2);
    expect(list.some((s) => s.mimeType === "application/pdf" && s.title === "Трубы")).toBe(true);
  });

  it("rename / delete / sortOrder / clientVisible persist", () => {
    let mp = { projectSchemes: [] };
    mp = addProjectScheme(mp, { title: "A", url: "/uploads/a.pdf", mimeType: "application/pdf", clientVisible: true });
    mp = addProjectScheme(mp, { title: "B", url: "/uploads/b.png", mimeType: "image/png", clientVisible: false });
    const [a, b] = listProjectSchemes(mp);
    mp = updateProjectScheme(mp, a.id, { title: "A renamed" });
    expect(listProjectSchemes(mp)[0].title).toBe("A renamed");
    expect(listProjectSchemes(mp)[0].sortOrder).toBe(0);
    expect(listProjectSchemes(mp)[1].sortOrder).toBe(1);
    expect(clientVisibleSchemes(mp).map((s) => s.id)).toEqual([a.id]);
    mp = removeProjectScheme(mp, b.id);
    expect(listProjectSchemes(mp).map((s) => s.id)).toEqual([a.id]);
  });

  it("setFloorPlanTitle updates display title", () => {
    let mp = setFloorPlanUrl({ projectSchemes: [] }, "/uploads/x.png", { mimeType: "image/png" });
    mp = setFloorPlanTitle(mp, "Новое имя");
    expect(getFloorPlanEntry(mp).title).toBe("Новое имя");
  });

  it("published imageManifest keeps PDF mimeType and only clientVisible", () => {
    const project = {
      manualParams: {
        projectSchemes: [
          { id: "pdf1", title: "PDF plan", url: "/uploads/a.pdf", mimeType: "application/pdf", clientVisible: true, sortOrder: 0 },
          { id: "hid", title: "Hidden", url: "/uploads/b.pdf", mimeType: "application/pdf", clientVisible: false, sortOrder: 1 },
          { id: "img1", title: "Img", url: "/uploads/c.png", mimeType: "image/png", clientVisible: true, sortOrder: 2 },
        ],
      },
      stellageConfigs: [],
    };
    const manifest = buildClientImageManifest(project);
    expect(manifest.projectSchemes.map((s) => s.id)).toEqual(["pdf1", "img1"]);
    expect(manifest.projectSchemes[0]).toMatchObject({
      mimeType: "application/pdf",
      title: "PDF plan",
      url: "/uploads/a.pdf",
    });
    expect(isPdfScheme(manifest.projectSchemes[0])).toBe(true);
    expect(isPdfScheme(manifest.projectSchemes[1])).toBe(false);
  });
});
