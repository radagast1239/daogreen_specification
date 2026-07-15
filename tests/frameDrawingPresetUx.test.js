import { describe, expect, it } from "vitest";
import {
  isPresetFrameContext,
  presetFramePlannerCopy,
} from "../src/lib/frameDrawingPresetUx.js";

describe("frame drawing preset UX", () => {
  it("shows creation context and return label for a preset without projectId", () => {
    const context = {
      sourceType: "preset",
      presetId: "preset-1",
      rackLabel: "NFT 4 яруса",
      returnTo: "/modules?tab=stellage",
    };

    expect(isPresetFrameContext(context)).toBe(true);
    expect(presetFramePlannerCopy(context)).toEqual({
      heading: "Создание схемы для:",
      name: "NFT 4 яруса",
      returnLabel: "К шаблонам стеллажей",
    });
  });

  it("shows existing template drawing context", () => {
    expect(presetFramePlannerCopy({
      sourceType: "preset",
      drawingId: "drawing-1",
      rackLabel: "Flood 3 яруса",
    })).toMatchObject({
      heading: "Схема шаблона:",
      name: "Flood 3 яруса",
    });
  });

  it.each(["project", "project_stellage", "module_rack"])(
    "does not activate preset UI for %s flow",
    (sourceType) => {
      const context = { sourceType, rackLabel: "Стеллаж 1", returnTo: "/project/p1" };
      expect(isPresetFrameContext(context)).toBe(false);
      expect(presetFramePlannerCopy(context)).toBeNull();
    },
  );
});
