import { describe, it, expect } from "vitest";
import {
  runPrePublishCheck,
  CRITICAL_ISSUES,
  WARNING_ISSUES,
} from "../shared/projectReadiness.js";

function baseItem(overrides = {}) {
  return {
    id: "i1",
    name: "Насос дренажный",
    qty: 1,
    price: 100,
    photoUrl: "/uploads/p.jpg",
    supplier: "Поставщик",
    link: "https://example.com/item",
    clientSection: "Климат и вентиляция",
    clientSubsection: "Кондиционирование / охлаждение",
    includedInProject: true,
    visibleToClient: true,
    ...overrides,
  };
}

const issues = (list) => list.map((p) => p.issue);

describe("publish severity", () => {
  it("«нет ссылки» и «нет фото» — это предупреждения, а не критические ошибки", () => {
    expect(CRITICAL_ISSUES.has("no_link")).toBe(false);
    expect(CRITICAL_ISSUES.has("no_photo")).toBe(false);
    expect(WARNING_ISSUES.has("no_link")).toBe(true);
    expect(WARNING_ISSUES.has("no_photo")).toBe(true);
  });

  it("полностью заполненная позиция публикуется без проблем", () => {
    const res = runPrePublishCheck([baseItem()]);
    expect(res.ok).toBe(true);
  });

  it("позиция без ссылки не блокирует публикацию", () => {
    const res = runPrePublishCheck([baseItem({ link: "" })]);
    expect(issues(res.critical)).not.toContain("no_link");
    expect(issues(res.warnings)).toContain("no_link");
    expect(res.status).not.toBe("blocked");
  });

  it("позиция без фото не блокирует публикацию", () => {
    const res = runPrePublishCheck([baseItem({ photoUrl: "", imageUrl: "" })]);
    expect(issues(res.critical)).not.toContain("no_photo");
    expect(issues(res.warnings)).toContain("no_photo");
    expect(res.status).not.toBe("blocked");
  });

  it("нет ссылки + нет фото вместе — спецификация всё равно публикуема", () => {
    const res = runPrePublishCheck([baseItem({ link: "", photoUrl: "", imageUrl: "" })]);
    expect(res.critical.length).toBe(0);
    expect(res.status).not.toBe("blocked");
  });
});
