import { describe, expect, it } from "vitest";
import {
  ROOM_COOLING_STATUS,
  applyAndSelectNextRoom,
  applyCoolingCalcToRoom,
  clearRoomCooling,
  coolingParamsFromRoom,
  coolingSnapshotFromFarmCalc,
  fillAcUnitFromRecommendation,
  roomCoolingStatus,
  roomRecommendedKw,
} from "../shared/roomCoolingWorkflow.js";
import { buildAcLineFromRoom } from "../shared/roomAcSpec.js";
import { computeCoolingFarm } from "../src/lib/coolingFarmCalc.js";

const farmInputs = { length: 5, width: 4, height: 3, safetyFactor: 1.1 };
const farmCalc = { totalKwSafety: 3.11, modelBtu: 10614, standardBtu: 12000 };

function makeRooms() {
  return [
    { id: "r1", name: "Манипуляционная" },
    { id: "r2", name: "Водоподготовка" },
    { id: "r3", name: "Рассадное отделение" },
  ];
}

describe("coolingSnapshotFromFarmCalc", () => {
  it("maps geometry, reserve and power from a farm calc", () => {
    const snap = coolingSnapshotFromFarmCalc(farmInputs, farmCalc);
    expect(snap.area).toBe(20);
    expect(snap.volume).toBe(60);
    expect(snap.reservePct).toBe(10);
    expect(snap.recommendedKw).toBe(3.11);
    expect(snap.btu).toBe(10614);
    expect(snap.standardBtu).toBe(12000);
    expect(snap.params).toEqual(farmInputs);
  });
});

describe("applyCoolingCalcToRoom", () => {
  it("applies calculation to the selected room without mutating it", () => {
    const rooms = makeRooms();
    const snap = coolingSnapshotFromFarmCalc(farmInputs, farmCalc);
    const applied = applyCoolingCalcToRoom(rooms[0], snap);

    expect(applied).not.toBe(rooms[0]);
    expect(rooms[0].cooling).toBeUndefined(); // original untouched
    expect(applied.area).toBe(20);
    expect(applied.height).toBe(3);
    expect(applied.volume).toBe(60);
    expect(applied.cooling.recommendedKw).toBe(3.11);
    expect(applied.cooling.btu).toBe(10614);
    expect(applied.cooling.reservePct).toBe(10);
    expect(applied.cooling.params.length).toBe(5);
    expect(applied.cooling.name).toBe("Манипуляционная");
  });

  it("creates one blank AC unit row when applying cooling to a room without AC units", () => {
    const room = { id: "r1", name: "Манипуляционная" };
    const applied = applyCoolingCalcToRoom(
      room,
      coolingSnapshotFromFarmCalc(farmInputs, farmCalc)
    );

    expect(applied.acUnits).toHaveLength(1);
    expect(applied.acUnits[0].qty).toBe(1);
    expect(applied.acUnits[0].coolingKw).toBe("");
    expect(applied.acUnits[0].link).toBe("");
    expect(applied.acUnits[0].comment).toBe("");
    expect(applied.cooling.recommendedKw).toBe(3.11);
  });

  it("does not overwrite existing manual AC unit fields when applying cooling", () => {
    const room = {
      id: "r1",
      name: "Манипуляционная",
      acUnits: [
        {
          id: "u1",
          qty: 2,
          coolingKw: 5,
          link: "https://example.com/ac",
          comment: "manual model",
        },
      ],
    };

    const applied = applyCoolingCalcToRoom(
      room,
      coolingSnapshotFromFarmCalc(farmInputs, farmCalc)
    );

    expect(applied.acUnits).toHaveLength(1);
    expect(applied.acUnits[0]).toMatchObject({
      id: "u1",
      qty: 2,
      coolingKw: 5,
      link: "https://example.com/ac",
      comment: "manual model",
    });
    expect(applied.cooling.recommendedKw).toBe(3.11);
  });
});

describe("applyAndSelectNextRoom", () => {
  it("applies to active room and selects the next one", () => {
    const rooms = makeRooms();
    const snap = coolingSnapshotFromFarmCalc(farmInputs, farmCalc);
    const res = applyAndSelectNextRoom(rooms, "r1", snap);

    expect(res.hasNext).toBe(true);
    expect(res.nextRoomId).toBe("r2");
    expect(res.rooms[0].cooling.recommendedKw).toBe(3.11);
    expect(res.rooms[1].cooling).toBeUndefined();
  });

  it("reports no next room when the active room is last", () => {
    const rooms = makeRooms();
    const snap = coolingSnapshotFromFarmCalc(farmInputs, farmCalc);
    const res = applyAndSelectNextRoom(rooms, "r3", snap);

    expect(res.hasNext).toBe(false);
    expect(res.nextRoomId).toBeNull();
    expect(res.rooms[2].cooling.recommendedKw).toBe(3.11);
  });
});

describe("roomCoolingStatus", () => {
  it("no calc -> 'Нет расчёта', after applying -> 'Модель не выбрана'", () => {
    const room = { id: "r1", name: "Манипуляционная" };
    expect(roomCoolingStatus(room)).toBe(ROOM_COOLING_STATUS.NO_CALC);

    const snap = coolingSnapshotFromFarmCalc(farmInputs, farmCalc);
    const applied = applyCoolingCalcToRoom(room, snap);
    expect(roomCoolingStatus(applied)).toBe(ROOM_COOLING_STATUS.NO_MODEL);
  });

  it("actual >= recommended -> 'Мощности хватает'", () => {
    const applied = applyCoolingCalcToRoom(
      { id: "r1", name: "Манипуляционная", acUnits: [{ id: "u1", qty: 1, coolingKw: 3.5 }] },
      coolingSnapshotFromFarmCalc(farmInputs, farmCalc)
    );
    expect(applied.cooling.recommendedKw).toBe(3.11);
    expect(roomCoolingStatus(applied)).toBe(ROOM_COOLING_STATUS.ENOUGH);
  });

  it("actual < recommended -> 'Недостаточно мощности'", () => {
    const applied = applyCoolingCalcToRoom(
      { id: "r1", name: "Манипуляционная", acUnits: [{ id: "u1", qty: 1, coolingKw: 2 }] },
      coolingSnapshotFromFarmCalc(farmInputs, farmCalc)
    );
    expect(roomCoolingStatus(applied)).toBe(ROOM_COOLING_STATUS.NOT_ENOUGH);
  });
});

describe("recommended kW into AC spec row", () => {
  it("prefers the applied recommendation and fills only empty AC unit power", () => {
    const room = applyCoolingCalcToRoom(
      { id: "r1", name: "Манипуляционная", acUnits: [{ id: "u1", qty: 1, coolingKw: "" }] },
      coolingSnapshotFromFarmCalc(farmInputs, farmCalc)
    );
    expect(roomRecommendedKw(room)).toBe(3.11);

    const filled = fillAcUnitFromRecommendation(room, "u1");
    expect(filled.acUnits[0].coolingKw).toBe(3.11);

    // does not overwrite a manual pick
    const manual = fillAcUnitFromRecommendation(
      { ...room, acUnits: [{ id: "u1", qty: 1, coolingKw: 5 }] },
      "u1"
    );
    expect(manual.acUnits[0].coolingKw).toBe(5);
  });
});

describe("client AC row stays linked to its room", () => {
  it("keeps roomId after applying a cooling calculation", () => {
    const room = applyCoolingCalcToRoom(
      { id: "r1", name: "Манипуляционная", acUnits: [{ id: "u1", qty: 1, coolingKw: 2.5 }] },
      coolingSnapshotFromFarmCalc(farmInputs, farmCalc)
    );
    const line = buildAcLineFromRoom(room);
    expect(line.roomId).toBe("r1");
    expect(line.clientNote).toContain("Манипуляционная");
  });
});

describe("params duplication and clearing", () => {
  it("returns stored params for duplicating into a new room", () => {
    const room = applyCoolingCalcToRoom(
      { id: "r1", name: "Манипуляционная" },
      coolingSnapshotFromFarmCalc(farmInputs, farmCalc)
    );
    expect(coolingParamsFromRoom(room)).toEqual(farmInputs);
  });

  it("clears the cooling snapshot", () => {
    const room = applyCoolingCalcToRoom(
      { id: "r1", name: "Манипуляционная" },
      coolingSnapshotFromFarmCalc(farmInputs, farmCalc)
    );
    const cleared = clearRoomCooling(room);
    expect(cleared.cooling).toBeUndefined();
    expect(roomCoolingStatus(cleared)).toBe(ROOM_COOLING_STATUS.NO_CALC);
  });
});

describe("cooling load breakdown fills the room table", () => {
  it("stores light/other/people watts and ΔT from a real farm calc", () => {
    const inputs = { length: 5, width: 4, height: 3, tOut: 32, tIn: 22 };
    const calc = computeCoolingFarm(inputs);
    const snap = coolingSnapshotFromFarmCalc(inputs, calc);

    expect(snap.deltaT).toBe(10);
    expect(snap.lightingW).toBeGreaterThan(0);
    // свет + люди + прочее = нагрузка без запаса (Вт)
    const sum = snap.lightingW + snap.peopleEquipW + snap.heatGainW;
    expect(Math.abs(sum - calc.totalKw * 1000)).toBeLessThanOrEqual(1);

    const applied = applyCoolingCalcToRoom({ id: "r1", name: "X" }, snap);
    expect(applied.lightingW).toBe(snap.lightingW);
    expect(applied.heatGainW).toBe(snap.heatGainW);
    expect(applied.peopleEquipW).toBe(snap.peopleEquipW);
    expect(applied.cooling.deltaT).toBe(10);
  });

  it("does not fill load fields for a stub calc without a breakdown", () => {
    const snap = coolingSnapshotFromFarmCalc(farmInputs, farmCalc);
    const applied = applyCoolingCalcToRoom({ id: "r1", name: "X" }, snap);
    expect(applied.lightingW).toBeUndefined();
    expect(applied.cooling.deltaT).toBe("");
  });
});
