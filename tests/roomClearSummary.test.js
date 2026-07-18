import { describe, it, expect } from "vitest";
import { summarizeRoomClearItems, buildRoomClearConfirmMessage } from "../src/planner/ui/roomClearSummary.js";

describe("PHASE 1A-2C2D3D2 — summarizeRoomClearItems", () => {
  it("classifies doors, windows, openings, and unknown/legacy kinds without overlap", () => {
    const items = [
      { id: "d1", kind: "door" },
      { id: "d2", kind: "door_gate" },
      { id: "w1", kind: "window" },
      { id: "o1", kind: "opening" },
      { id: "o2", kind: "opening_vent" },
      { id: "o3", kind: "opening_tech" },
      { id: "legacy1", kind: "some_future_unknown_kind" },
    ];
    const counts = summarizeRoomClearItems(items);
    expect(counts).toEqual({
      doors: 2, windows: 1, openings: 3, other: 1,
    });
    // total accounted for, no item double-counted or dropped
    expect(counts.doors + counts.windows + counts.openings + counts.other).toBe(items.length);
  });

  it("an item with no kind at all is classified as other, not dropped", () => {
    const counts = summarizeRoomClearItems([{ id: "x1" }]);
    expect(counts).toEqual({
      doors: 0, windows: 0, openings: 0, other: 1,
    });
  });

  it("empty input yields all-zero counts", () => {
    expect(summarizeRoomClearItems([])).toEqual({
      doors: 0, windows: 0, openings: 0, other: 0,
    });
    expect(summarizeRoomClearItems(undefined)).toEqual({
      doors: 0, windows: 0, openings: 0, other: 0,
    });
  });
});

describe("PHASE 1A-2C2D3D2 — buildRoomClearConfirmMessage", () => {
  it("includes project-wide destructive wording, per-category counts, wall-preservation wording, and a continue prompt", () => {
    const message = buildRoomClearConfirmMessage({
      doors: 2, windows: 1, openings: 3, other: 1,
    });
    expect(message).toMatch(/во всём проекте/);
    expect(message).toMatch(/Двери\s*—\s*2/);
    expect(message).toMatch(/Окна\s*—\s*1/);
    expect(message).toMatch(/Проёмы\s*—\s*3/);
    expect(message).toMatch(/Прочие объекты\s*—\s*1/);
    expect(message).toMatch(/Стены и перегородки останутся/);
    expect(message).toMatch(/Продолжить\?/);
    // must not read as if only the currently-viewed room is affected
    expect(message).not.toMatch(/выбранн(ую|ой) комнат/i);
  });

  it("omits the \"other\" line entirely when its count is zero", () => {
    const message = buildRoomClearConfirmMessage({
      doors: 1, windows: 0, openings: 0, other: 0,
    });
    expect(message).not.toMatch(/Прочие объекты/);
    expect(message).toMatch(/Двери\s*—\s*1/);
    expect(message).toMatch(/Окна\s*—\s*0/);
    expect(message).toMatch(/Проёмы\s*—\s*0/);
  });
});
