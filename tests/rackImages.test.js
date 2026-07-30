import { describe, expect, it } from "vitest";
import { addRackImage, cloneRackImages, moveRackImage, normalizeRackImages, updateRackImage } from "../src/lib/rackImages.js";
import { buildProjectFromBuilder } from "../src/lib/projectBuilder.js";
import { stellagesFromProject } from "../src/lib/projectBuilderHydrate.js";

describe("rack extra images", () => {
  it("supports legacy, add, rename, ordering and independent metadata clones", () => {
    expect(normalizeRackImages(undefined)).toEqual([]);
    let images = addRackImage([], { name: "light.png", type: "image/png" }, "/uploads/light.png");
    images = addRackImage(images, { name: "node.webp", type: "image/webp" }, "/uploads/node.webp");
    images = updateRackImage(images, images[0].id, { title: "Свет" });
    images = moveRackImage(images, images[1].id, "up");
    expect(images.map((image) => image.title)).toEqual(["node", "Свет"]);
    const cloned = cloneRackImages(images);
    expect(cloned.map((image) => image.url)).toEqual(images.map((image) => image.url));
    expect(cloned.map((image) => image.id)).not.toEqual(images.map((image) => image.id));
  });

  it("round-trips images by stable rack id", () => {
    const images = addRackImage([], { name: "a.jpg", type: "image/jpeg" }, "/uploads/a.jpg");
    const rack = { id: "rack-a", moduleId: "mod", moduleName: "Rack", name: "A", count: 1, items: [], extraImages: images };
    const project = buildProjectFromBuilder({ form: { name: "P", manualParams: {} }, stellages: [rack], farmSections: [], materials: [] });
    expect(project.stellageConfigs[0].extraImages[0].url).toBe("/uploads/a.jpg");
    const hydrated = stellagesFromProject(project, { materials: [], stellageCatalogs: {} });
    expect(hydrated[0].id).toBe("rack-a");
    expect(hydrated[0].extraImages[0].id).toBe(images[0].id);
  });
});
