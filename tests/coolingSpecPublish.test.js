import { describe, it, expect } from "vitest";
import { isCoolingSpecItem } from "../shared/itemTypes.js";
import { runPrePublishCheck } from "../shared/projectReadiness.js";

const issues = (list) => list.map((p) => p.issue);

function acRow(overrides = {}) {
  return {
    id: "ac1",
    name: "Сплит-система / кондиционер",
    kind: "cooling_spec",
    clientSection: "Климат и вентиляция",
    clientSubsection: "",
    qty: 1,
    price: 0,
    imageUrl: "",
    photoUrl: "",
    supplier: "",
    roomId: "r1",
    splitSpecs: [{ roomName: "Комната 1", recommendedKw: 3.11, recommendedBtu: 10614, standardBtu: 12000 }],
    includedInProject: true,
    visibleToClient: true,
    ...overrides,
  };
}

describe("cooling spec in publish check", () => {
  it("cooling_spec без цены/фото/подраздела проходит предпроверку публикации", () => {
    const res = runPrePublishCheck([acRow()]);
    const crit = issues(res.critical);
    expect(crit).not.toContain("no_price");
    expect(crit).not.toContain("zero_price");
    expect(crit).not.toContain("no_photo");
    expect(crit).not.toContain("no_client_subsection");
    expect(res.ok).toBe(true);
  });

  it("legacy room-AC строка без kind распознаётся по splitSpecs и не блокирует публикацию", () => {
    const legacy = acRow({ kind: undefined });
    delete legacy.kind;
    expect(isCoolingSpecItem(legacy)).toBe(true);
    expect(runPrePublishCheck([legacy]).status).not.toBe("blocked");
  });

  it("legacy строка без kind и без splitSpecs распознаётся по имени + roomId", () => {
    const legacy = acRow({ kind: undefined, splitSpecs: undefined });
    delete legacy.kind;
    delete legacy.splitSpecs;
    expect(isCoolingSpecItem(legacy)).toBe(true);
    expect(runPrePublishCheck([legacy]).status).not.toBe("blocked");
  });

  it("маркер source room-ac распознаётся", () => {
    expect(isCoolingSpecItem({ name: "Кондиционер настенный", source: "room-ac", qty: 1 })).toBe(true);
  });

  it("обычный каталожный «кондиционер» без признаков room/ac/split НЕ считается cooling spec", () => {
    expect(isCoolingSpecItem({ name: "Кондиционер бытовой", category: "Климат и вентиляция" })).toBe(false);
  });

  it("обычный материал без цены по-прежнему блокирует публикацию (проверки не отключены глобально)", () => {
    const normal = {
      id: "m1",
      name: "Насос дренажный",
      qty: 1,
      price: 0,
      photoUrl: "/uploads/p.jpg",
      supplier: "Поставщик",
      link: "https://example.com/item",
      clientSection: "Климат и вентиляция",
      clientSubsection: "Кондиционирование / охлаждение",
      includedInProject: true,
      visibleToClient: true,
    };
    expect(isCoolingSpecItem(normal)).toBe(false);
    const res = runPrePublishCheck([normal]);
    expect(issues(res.critical)).toContain("no_price");
    expect(res.status).toBe("blocked");
  });
});
