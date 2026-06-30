import { describe, expect, it } from "vitest";
import {
  buildAcLineFromRoom,
  roomAcUnits,
  splitSpecsFromAcUnits,
  actualCoolingFromRoom,
} from "../shared/roomAcSpec.js";

describe("roomAcSpec", () => {
  const room = {
    id: "room_1",
    name: "Манипуляционная",
    area: 50,
    height: 3.5,
    lightingW: 200,
    acUnits: [
      { id: "u1", qty: 1, coolingKw: 2.5, link: "https://example.com", comment: "" },
    ],
  };

  it("builds split line for client spec", () => {
    const line = buildAcLineFromRoom(room);
    expect(line.coolingKw).toBe(2.5);
    expect(line.clientNote).toContain("Манипуляционная");
    expect(line.link).toBe("https://example.com");
  });

  it("sums actual cooling from units", () => {
    expect(actualCoolingFromRoom(room)).toBe(2.5);
  });

  it("defaults one unit row per room", () => {
    expect(roomAcUnits({ id: "r", name: "Склад", lightingW: 100 }).length).toBe(1);
  });

  it("normalizes multiple units", () => {
    const specs = splitSpecsFromAcUnits([
      { qty: 1, coolingKw: 2 },
      { qty: 1, coolingKw: 3 },
    ]);
    expect(specs).toHaveLength(2);
  });
});
