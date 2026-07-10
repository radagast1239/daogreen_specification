import { describe, it, expect } from "vitest";
import {
  PROJECT_STATUS,
  PROJECT_WORKFLOW_STATUSES,
  PROJECT_STATUS_LIST_FILTERS,
  PROJECT_SEND_CRITICAL_KEYS,
  normalizeProjectStatus,
  getProjectStatusLabel,
  resolveProjectStatusForSave,
  isProjectStatusActiveLifecycle,
  projectMatchesStatusFilter,
  projectStatusNeedsConfirm,
  buildProjectSendReadiness,
  shouldConfirmReadyToSend,
  buildReadyToSendConfirmText,
} from "../shared/projectStatus.js";
import { buildProjectPreSendChecklist } from "../shared/projectPreSendChecklist.js";
import { selectAllPreSendProblemIds } from "../shared/projectPreSendChecklist.js";
import { PURCHASE_STATUS } from "../shared/purchaseStatusRules.js";
import { isActiveProject, isDraftProject } from "../shared/projectLifecycle.js";

function mkItem(overrides = {}) {
  return {
    id: overrides.id || "i1",
    name: overrides.name || "Товар",
    qty: 1,
    unit: "шт.",
    price: overrides.price ?? 100,
    supplier: overrides.supplier ?? "Леруа",
    link: overrides.link ?? "https://example.com",
    module: "mod",
    clientSection: "stellage",
    responsible: "general",
    itemRole: "purchase",
    category: "Каркас и крепёж",
    includedInProject: true,
    visibleToClient: true,
    approved: true,
    ...overrides,
  };
}

describe("projectStatus model", () => {
  it("defines all allowed workflow statuses", () => {
    expect(PROJECT_WORKFLOW_STATUSES.map((s) => s.id)).toEqual([
      PROJECT_STATUS.ACTIVE,
      PROJECT_STATUS.IN_PROGRESS,
      PROJECT_STATUS.ON_REVIEW,
      PROJECT_STATUS.READY_TO_SEND,
      PROJECT_STATUS.SENT_TO_CLIENT,
      PROJECT_STATUS.CLIENT_BUYING,
      PROJECT_STATUS.PURCHASE_COMPLETE,
      PROJECT_STATUS.CLOSED,
    ]);
  });

  it("unknown/empty status displays as Черновик without mutating project", () => {
    const project = { id: "p1", status: "" };
    expect(getProjectStatusLabel(project.status)).toBe("Черновик");
    expect(normalizeProjectStatus(project.status)).toBe(PROJECT_STATUS.ACTIVE);
    expect(getProjectStatusLabel("weird")).toBe("Черновик");
    expect(project.status).toBe("");
  });

  it("Черновик saves as active, not draft", () => {
    expect(resolveProjectStatusForSave(PROJECT_STATUS.ACTIVE)).toBe(PROJECT_STATUS.ACTIVE);
    expect(resolveProjectStatusForSave("draft")).toBe(PROJECT_STATUS.ACTIVE);
  });

  it("manual status and automatic readiness are independent", () => {
    const checklist = buildProjectPreSendChecklist([
      mkItem({ id: "ok" }),
      mkItem({ id: "p", price: 0 }),
    ]);
    const readiness = buildProjectSendReadiness(checklist);
    expect(readiness.criticalCount).toBeGreaterThan(0);
    expect(getProjectStatusLabel(PROJECT_STATUS.IN_PROGRESS)).toBe("В работе");
    expect(normalizeProjectStatus(PROJECT_STATUS.IN_PROGRESS)).toBe(PROJECT_STATUS.IN_PROGRESS);
  });

  it("no_link does not affect send readiness", () => {
    const checklist = buildProjectPreSendChecklist([
      mkItem({ id: "ok" }),
      mkItem({ id: "l", link: "", purchaseStatus: PURCHASE_STATUS.NOT_BOUGHT }),
    ]);
    expect(checklist.groups.find((g) => g.key === "no_link").severity).toBe("info");
    const readiness = buildProjectSendReadiness(checklist);
    expect(readiness.status).toBe("ok");
    expect(readiness.criticalCount).toBe(0);
    expect(selectAllPreSendProblemIds(checklist)).not.toContain("l");
  });

  it("critical issue counts match checklist groups", () => {
    const items = [
      mkItem({ id: "p", price: 0 }),
      mkItem({ id: "s", supplier: "" }),
      mkItem({ id: "r", purchaseStatus: PURCHASE_STATUS.REPLACEMENT_CHECK }),
      mkItem({ id: "ok" }),
    ];
    const checklist = buildProjectPreSendChecklist(items);
    const readiness = buildProjectSendReadiness(checklist);
    expect(readiness.countsByKey.no_price).toBe(
      checklist.groups.find((g) => g.key === "no_price").count
    );
    expect(readiness.countsByKey.no_supplier).toBe(
      checklist.groups.find((g) => g.key === "no_supplier").count
    );
    expect(readiness.countsByKey.replacement_check).toBe(
      checklist.groups.find((g) => g.key === "replacement_check").count
    );
    const expected = PROJECT_SEND_CRITICAL_KEYS.reduce(
      (s, key) => s + (Number(readiness.countsByKey[key]) || 0),
      0
    );
    expect(readiness.criticalCount).toBe(expected);
    expect(readiness.criticalCount).toBeGreaterThan(0);
  });

  it("ready_to_send with blockers requires confirmation text", () => {
    const checklist = buildProjectPreSendChecklist([mkItem({ id: "p", price: 0 })]);
    const readiness = buildProjectSendReadiness(checklist);
    expect(shouldConfirmReadyToSend(PROJECT_STATUS.READY_TO_SEND, readiness)).toBe(true);
    expect(shouldConfirmReadyToSend(PROJECT_STATUS.IN_PROGRESS, readiness)).toBe(false);
    const text = buildReadyToSendConfirmText(readiness);
    expect(text).toMatch(/критические проблемы/i);
    expect(text).toMatch(/без цены/i);
  });

  it("user can still choose ready_to_send despite blockers (confirm only)", () => {
    const readiness = { criticalCount: 2, detailLines: [{ label: "Без цены", count: 2 }] };
    expect(shouldConfirmReadyToSend(PROJECT_STATUS.READY_TO_SEND, readiness)).toBe(true);
    expect(resolveProjectStatusForSave(PROJECT_STATUS.READY_TO_SEND)).toBe(
      PROJECT_STATUS.READY_TO_SEND
    );
  });

  it("purchase_complete and closed need confirm", () => {
    expect(projectStatusNeedsConfirm(PROJECT_STATUS.PURCHASE_COMPLETE)).toBe(true);
    expect(projectStatusNeedsConfirm(PROJECT_STATUS.CLOSED)).toBe(true);
    expect(projectStatusNeedsConfirm(PROJECT_STATUS.IN_PROGRESS)).toBe(false);
  });

  it("list filters group statuses correctly", () => {
    expect(projectMatchesStatusFilter({ status: "active" }, "drafts")).toBe(true);
    expect(projectMatchesStatusFilter({ status: "" }, "drafts")).toBe(true);
    expect(projectMatchesStatusFilter({ status: "in_progress" }, "in_progress")).toBe(true);
    expect(projectMatchesStatusFilter({ status: "ready_to_send" }, "ready")).toBe(true);
    expect(projectMatchesStatusFilter({ status: "sent_to_client" }, "sent")).toBe(true);
    expect(projectMatchesStatusFilter({ status: "client_buying" }, "buying")).toBe(true);
    expect(projectMatchesStatusFilter({ status: "closed" }, "closed")).toBe(true);
    expect(projectMatchesStatusFilter({ status: "in_progress" }, "all")).toBe(true);
    expect(PROJECT_STATUS_LIST_FILTERS.some((f) => f.id === "ready")).toBe(true);
  });

  it("lifecycle treats workflow statuses as active HQ projects", () => {
    expect(isDraftProject({ status: "draft" })).toBe(true);
    expect(isActiveProject({ status: "in_progress" })).toBe(true);
    expect(isActiveProject({ status: "ready_to_send" })).toBe(true);
    expect(isActiveProject({ status: "closed" })).toBe(true);
    expect(isActiveProject({ status: "archived" })).toBe(false);
    expect(isProjectStatusActiveLifecycle("sent_to_client")).toBe(true);
  });
});
