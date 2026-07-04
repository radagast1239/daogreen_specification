import { describe, expect, it } from "vitest";
import {
  buildAcLineFromRoom,
  flattenRoomAcSpecRows,
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

  it("client note carries room, cooling kW, BTU and estimated consumption", () => {
    const line = buildAcLineFromRoom({
      id: "r1",
      name: "Манипуляционная",
      cooling: { recommendedKw: 3.11, btu: 10614, standardBtu: 12000, params: { cop: 3.2 } },
      acUnits: [{ id: "u1", qty: 1, coolingKw: "" }],
    });
    expect(line.clientNote).toContain("Манипуляционная");
    expect(line.clientNote).toContain("холод");
    expect(line.clientNote).toContain("BTU");
    expect(line.clientNote).toContain("потребление");
    // рекомендованный холод НЕ пишется в фактический coolingKw
    expect(line.coolingKw).toBe(0);
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

  it("prefers applied room.cooling recommendation for AC rows", () => {
    const rows = flattenRoomAcSpecRows([
      {
        id: "r1",
        name: "Манипуляционная",
        lightingW: 0,
        cooling: {
          recommendedKw: 3.11,
          btu: 10614,
          standardBtu: 12000,
        },
        acUnits: [{ id: "u1", qty: 1, coolingKw: "" }],
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].recommendedKw).toBe(3.11);
    expect(rows[0].recommendedBtu).toBe(12000);
    expect(rows[0].unit.coolingKw).toBe("");
  });

  it("recommendedKw is cooling capacity; electric consumption = cooling / COP", () => {
    const rows = flattenRoomAcSpecRows([
      {
        id: "r1",
        name: "Манипуляционная",
        lightingW: 0,
        cooling: { recommendedKw: 3.2, btu: 10614, standardBtu: 12000, params: { cop: 3.2 } },
        acUnits: [{ id: "u1", qty: 1, coolingKw: "" }],
      },
    ]);
    expect(rows[0].recommendedKw).toBe(3.2); // холод, не потребление
    expect(rows[0].recommendedElecKw).toBe(1); // 3.2 / 3.2
  });

  it("uses default COP 3.2 for electric consumption when params.cop is missing", () => {
    const rows = flattenRoomAcSpecRows([
      {
        id: "r2",
        name: "Водоподготовка",
        lightingW: 0,
        cooling: { recommendedKw: 6.4 },
        acUnits: [{ id: "u1", qty: 1, coolingKw: "" }],
      },
    ]);
    expect(rows[0].recommendedElecKw).toBe(2); // 6.4 / 3.2
  });
});
