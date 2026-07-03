import { describe, it, expect } from "vitest";
import {
  buildAcLineFromRoom,
  flattenRoomAcSpecRows,
  AC_CLIENT_SECTION,
  AC_CLIENT_SUBSECTION,
  AC_ITEM_NAME,
} from "../shared/roomAcSpec.js";
import { isCoolingSpecItem, lineContributesToSum } from "../shared/itemTypes.js";
import { runPrePublishCheck } from "../shared/projectReadiness.js";

function roomWithUnits() {
  return {
    id: "r1",
    name: "Манипуляционная",
    cooling: { recommendedKw: 3.11, standardBtu: 12000 },
    acUnits: [{ id: "u1", qty: 1, coolingKw: 2.5, link: "", comment: "" }],
  };
}

describe("room AC as cooling spec", () => {
  it("isCoolingSpecItem распознаёт строки сплит-систем и не трогает обычный материал", () => {
    expect(isCoolingSpecItem({ kind: "cooling_spec" })).toBe(true);
    expect(isCoolingSpecItem({ splitSpecs: [{ qty: 1, coolingKw: 2.5 }] })).toBe(true);
    expect(isCoolingSpecItem({ name: "Насос", category: "Насосы" })).toBe(false);
    expect(isCoolingSpecItem(null)).toBe(false);
  });

  it("AC-строка получает дефолтные клиентский раздел и подраздел", () => {
    const line = buildAcLineFromRoom(roomWithUnits());
    expect(line).toBeTruthy();
    expect(line.name).toBe(AC_ITEM_NAME);
    expect(line.kind).toBe("cooling_spec");
    expect(line.clientSection).toBe(AC_CLIENT_SECTION);
    expect(line.clientSubsection).toBe(AC_CLIENT_SUBSECTION);
    expect(AC_CLIENT_SECTION).toBe("Климат и вентиляция");
    expect(AC_CLIENT_SUBSECTION).toBe("Сплит-системы / кондиционирование");
  });

  it("AC-строка без цены/фото/подраздела не даёт критических ошибок публикации", () => {
    const line = buildAcLineFromRoom(roomWithUnits());
    // цены нет, фото нет, поставщика нет, ссылки нет
    expect(Number(line.price)).toBe(0);
    const res = runPrePublishCheck([line]);
    const criticalIssues = res.critical.map((p) => p.issue);
    expect(criticalIssues).not.toContain("no_price");
    expect(criticalIssues).not.toContain("no_photo");
    expect(criticalIssues).not.toContain("no_supplier");
    expect(criticalIssues).not.toContain("zero_price");
    expect(criticalIssues).not.toContain("no_client_subsection");
    expect(criticalIssues).not.toContain("misc_category");
    expect(res.ok).toBe(true);
  });

  it("blank AC по комнате всё равно виден как спецификация (room, kW, BTU, qty)", () => {
    const rows = flattenRoomAcSpecRows([
      { id: "r2", name: "Лаборатория", cooling: { recommendedKw: 3.11, standardBtu: 12000 } },
    ]);
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.roomName).toBe("Лаборатория");
    expect(row.recommendedKw).toBe(3.11);
    expect(row.recommendedBtu).toBe(12000);
    expect(Number(row.unit.qty)).toBe(1);
  });

  it("рекомендованная мощность НЕ записывается в фактический coolingKw строки", () => {
    const line = buildAcLineFromRoom(roomWithUnits());
    // recommendedKw = 3.11, но факт по юнитам = 1 × 2.5
    expect(line.coolingKw).toBe(2.5);
    expect(line.coolingKw).not.toBe(3.11);
  });

  it("если цена указана вручную — строка участвует в сумме", () => {
    const line = { ...buildAcLineFromRoom(roomWithUnits()), price: 1500 };
    expect(lineContributesToSum(line)).toBe(true);
    const res = runPrePublishCheck([line]);
    expect(res.ok).toBe(true);
  });
});
