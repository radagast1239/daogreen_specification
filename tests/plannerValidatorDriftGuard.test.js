/**
 * CHECKPOINT 0A–0C — drift-guard.
 *
 * Валидатор целостности (production, в core/) намеренно НЕ импортирует legacy,
 * поэтому локально дублирует наборы kind проёмов и минимальную длину сегмента.
 * Этот ТЕСТ (не production) импортирует актуальные legacy-источники и проверяет,
 * что зеркала не разошлись. Тестам импорт legacy разрешён — ограничение границы
 * CAD Core относится к production core, не к тестам.
 */
import { describe, it, expect } from "vitest";
import {
  WALL_OPENING_KINDS,
  MIN_WALL_SEGMENT_MM,
} from "../src/planner/core/validation/validatePlanIntegrity.js";
import { DOOR_KINDS } from "../src/planner/doorTypes.js";
import { OPENING_KINDS } from "../src/planner/openingTypes.js";
import { MIN_SEGMENT_MM } from "../src/planner/core/walls/wallModel.js";

describe("validator constant drift-guard", () => {
  it("WALL_OPENING_KINDS точно = DOOR_KINDS ∪ OPENING_KINDS (актуальные legacy)", () => {
    const expected = new Set([...DOOR_KINDS, ...OPENING_KINDS]);
    const validator = [...WALL_OPENING_KINDS].sort();
    const legacy = [...expected].sort();
    expect(validator).toEqual(legacy);
    // ни одного лишнего/недостающего kind в обе стороны
    for (const k of DOOR_KINDS) expect(WALL_OPENING_KINDS.has(k), `door kind ${k}`).toBe(true);
    for (const k of OPENING_KINDS) expect(WALL_OPENING_KINDS.has(k), `opening kind ${k}`).toBe(true);
    expect(WALL_OPENING_KINDS.size).toBe(expected.size);
  });

  it("MIN_WALL_SEGMENT_MM зеркалит MIN_SEGMENT_MM (core/walls/wallModel.js)", () => {
    expect(MIN_WALL_SEGMENT_MM).toBe(MIN_SEGMENT_MM);
  });
});
