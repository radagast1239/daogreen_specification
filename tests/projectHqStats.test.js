import { describe, expect, it } from "vitest";
import {
  resolveLinkStatus,
  summarizeCoolingRooms,
  buildHqMetrics,
} from "../src/lib/projectHqStats.js";

describe("resolveLinkStatus", () => {
  it("нет token → none", () => {
    expect(resolveLinkStatus({})).toEqual({
      status: "none",
      label: "Не создана",
      expiresAt: null,
    });
  });

  it("есть token без expiresAt → active", () => {
    expect(resolveLinkStatus({ clientToken: "abc" })).toMatchObject({
      status: "active",
      label: "Активна",
    });
  });

  it("expiresAt в прошлом → expired", () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    expect(resolveLinkStatus({ clientToken: "abc", clientTokenExpiresAt: past })).toMatchObject({
      status: "expired",
      label: "Истекла",
    });
  });

  it("expiresAt в будущем → active", () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    expect(resolveLinkStatus({ clientToken: "abc", clientTokenExpiresAt: future })).toMatchObject({
      status: "active",
      label: "Активна",
      expiresAt: future,
    });
  });
});

describe("summarizeCoolingRooms", () => {
  it("пустые rooms → missing", () => {
    expect(summarizeCoolingRooms({ rooms: [] })).toMatchObject({
      status: "missing",
      label: "Охлаждение не рассчитано",
    });
  });

  it("rooms без cooling snapshot → missing", () => {
    const res = summarizeCoolingRooms({
      rooms: [{ id: "r1", name: "A", lightingW: 1000 }],
    });
    expect(res.status).toBe("missing");
    expect(res.roomsWithoutCooling).toBe(1);
  });

  it("room с фактическим холодом ниже требуемого → warning", () => {
    const res = summarizeCoolingRooms({
      rooms: [
        {
          id: "r1",
          name: "A",
          cooling: { recommendedKw: 5 },
          acUnits: [{ id: "u1", qty: 1, coolingKw: 2 }],
        },
      ],
    });
    expect(res.status).toBe("warning");
    expect(res.label).toBe("Есть недобор холода");
    expect(res.roomsUnderpowered).toBe(1);
  });

  it("корректные rooms → ok", () => {
    const res = summarizeCoolingRooms({
      rooms: [
        {
          id: "r1",
          name: "A",
          cooling: { recommendedKw: 3 },
          acUnits: [{ id: "u1", qty: 1, coolingKw: 3.5 }],
        },
      ],
    });
    expect(res.status).toBe("ok");
    expect(res.label).toBe("Охлаждение рассчитано");
  });
});

describe("buildHqMetrics", () => {
  it("считает replacementsCount", () => {
    const m = buildHqMetrics({
      project: { version: 3, clientToken: "t" },
      items: [
        { status: "replacement_check" },
        { status: "not_bought" },
        { status: "replacement_check" },
      ],
      publishCheck: { status: "ok", readiness: { readinessPercent: 80 }, counts: {} },
    });
    expect(m.replacementsCount).toBe(2);
    expect(m.versionLabel).toBe("v3");
  });

  it("не падает при пустых project/items/publishCheck", () => {
    expect(() => buildHqMetrics({})).not.toThrow();
    const m = buildHqMetrics({});
    expect(m.readinessPercent).toBe(0);
    expect(m.linkStatus.status).toBe("none");
    expect(m.coolingSummary.status).toBe("missing");
  });
});
