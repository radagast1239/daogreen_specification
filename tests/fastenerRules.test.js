import { describe, expect, it } from "vitest";
import {
  crabKind,
  fastenerQtyFromCrabLines,
  screwQtyFromCrabLines,
  syncFastenersFromCrabs,
  lineDisplayName,
} from "../shared/fastenerRules.js";

describe("fastenerRules", () => {
  it("распознаёт типы крабов", () => {
    expect(crabKind("краб система Г образная20/20/1,2мм")).toBe("g");
    expect(crabKind("краб система Т-образная 20/20/1,2мм")).toBe("t");
    expect(crabKind("краб X-образный")).toBe("x");
  });

  it("считает болты/гайки по крабам", () => {
    const lines = [
      { name: "краб Г образный", qty: 4, included: true },
      { name: "краб Т-образный", qty: 2, included: true },
    ];
    expect(fastenerQtyFromCrabLines(lines)).toBe(4); // 4*0.5 + 2*1
    expect(screwQtyFromCrabLines(lines)).toBe(6);
  });

  it("резолвит имя по materialId", () => {
    const materials = [{ id: "m1", name: "Болт М6×20 мм" }];
    expect(lineDisplayName({ materialId: "m1" }, materials)).toBe("Болт М6×20 мм");
  });

  it("синхронизирует болты и саморезы в списке", () => {
    const materials = [
      { id: "c1", name: "краб система Г образная" },
      { id: "b1", name: "Болт М6×20 мм" },
      { id: "s1", name: "Саморез с прессшайбой" },
    ];
    const lines = [
      { materialId: "c1", qty: 2, included: true },
      { materialId: "b1", qty: 0, included: true },
      { materialId: "s1", qty: 0, included: true },
    ];
    const out = syncFastenersFromCrabs(lines, materials);
    const bolt = out.find((l) => l.materialId === "b1");
    const screw = out.find((l) => l.materialId === "s1");
    expect(bolt.qty).toBe(1);
    expect(screw.qty).toBe(2);
  });
});
