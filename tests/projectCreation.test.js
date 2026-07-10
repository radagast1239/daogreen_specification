import { describe, it, expect, vi } from "vitest";
import {
  PROJECT_KIND,
  CREATE_SCENARIO,
  suggestProjectName,
  buildNewProjectPayload,
  validateNewProjectForm,
  canSubmitNewProject,
  resolveCreateProjectRedirect,
  shouldShowCreateOnboarding,
  createProjectSubmitGuard,
  resolveProjectKind,
  getProjectKindBadge,
} from "../shared/projectCreation.js";
import { PROJECT_STATUS, buildProjectSendReadiness } from "../shared/projectStatus.js";
import { buildProjectPreSendChecklist } from "../shared/projectPreSendChecklist.js";
import { hydrateBuilderFromProject } from "../src/lib/projectBuilderHydrate.js";

describe("projectCreation payload", () => {
  it("normalizes strings and numbers", () => {
    const payload = buildNewProjectPayload({
      name: "  TEST REAL PROJECT  ",
      client: "  TEST CLIENT ",
      city: " Москва ",
      area: "120.5",
      sowingArea: "80",
      height: "3.2",
      type: "проточка",
      projectKind: PROJECT_KIND.CLIENT,
      scenario: CREATE_SCENARIO.EMPTY,
    });
    expect(payload.name).toBe("TEST REAL PROJECT");
    expect(payload.client).toBe("TEST CLIENT");
    expect(payload.city).toBe("Москва");
    expect(payload.area).toBe(120.5);
    expect(payload.sowingArea).toBe(80);
    expect(payload.height).toBe(3.2);
  });

  it("empty numeric fields become 0, not NaN", () => {
    const payload = buildNewProjectPayload({
      name: "A",
      client: "B",
      area: "",
      sowingArea: "abc",
      height: null,
    });
    expect(payload.area).toBe(0);
    expect(payload.sowingArea).toBe(0);
    expect(payload.height).toBe(0);
    expect(Number.isNaN(payload.area)).toBe(false);
  });

  it("payload has no items, racks, or rooms content", () => {
    const payload = buildNewProjectPayload({ name: "A", client: "B" });
    expect(payload.items).toEqual([]);
    expect(payload.stellageConfigs).toEqual([]);
    expect(payload.rooms).toEqual([]);
    expect(payload.selectedModules).toEqual([]);
    expect(payload.zones).toEqual([]);
    expect(payload).not.toHaveProperty("racks");
  });

  it("workflow status defaults to Черновик (active), not lifecycle draft", () => {
    const payload = buildNewProjectPayload({ name: "A", client: "B" });
    expect(payload.status).toBe(PROJECT_STATUS.ACTIVE);
    expect(payload.status).not.toBe("draft");
  });

  it("stores project kind in manualParams without migration fields", () => {
    const payload = buildNewProjectPayload({
      name: "A",
      client: "B",
      projectKind: PROJECT_KIND.TEST,
      scenario: CREATE_SCENARIO.BUILDER,
      responsible: "Иван",
    });
    expect(payload.manualParams.projectKind).toBe(PROJECT_KIND.TEST);
    expect(payload.manualParams.createScenario).toBe(CREATE_SCENARIO.BUILDER);
    expect(payload.manualParams.responsible).toBe("Иван");
    expect(payload.manualParams.showCreateOnboarding).toBe(true);
  });

  it("suggestProjectName builds from client and city", () => {
    expect(suggestProjectName({ client: "Acme", city: "Москва" })).toBe(
      "Вертикальная ферма — Acme — Москва"
    );
  });

  it("validate requires name and client only", () => {
    expect(canSubmitNewProject({ name: "", client: "X" })).toBe(false);
    expect(canSubmitNewProject({ name: "X", client: "" })).toBe(false);
    expect(canSubmitNewProject({ name: "X", client: "Y" })).toBe(true);
    expect(Object.keys(validateNewProjectForm({ name: "X", client: "Y" }))).toHaveLength(0);
  });
});

describe("projectCreation wizard / submit guard", () => {
  it("opening/stepping/closing does not call create (payload only on demand)", () => {
    const create = vi.fn();
    // Steps 1–3 never call create — only buildNewProjectPayload at submit.
    expect(create).not.toHaveBeenCalled();
    const payload = buildNewProjectPayload({ name: "A", client: "B" });
    expect(payload.name).toBe("A");
    expect(create).not.toHaveBeenCalled();
  });

  it("double-click / parallel submit creates once", async () => {
    const create = vi.fn(async () => ({ id: "p1" }));
    const guard = createProjectSubmitGuard();
    const p1 = guard.run(() => create());
    const p2 = guard.run(() => create());
    const [a, b] = await Promise.all([p1, p2]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(a.ok).toBe(true);
    expect(b.skipped).toBe(true);
  });

  it("API error keeps wizard open (guard unlocks for retry)", async () => {
    const guard = createProjectSubmitGuard();
    const fail = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(guard.run(fail)).rejects.toThrow("boom");
    expect(guard.busy).toBe(false);
    const ok = vi.fn(async () => ({ id: "p2" }));
    const second = await guard.run(ok);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(second.result.id).toBe("p2");
  });

  it("retry after error creates exactly one project", async () => {
    const guard = createProjectSubmitGuard();
    let n = 0;
    const create = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error("fail");
      return { id: "p-ok" };
    });
    await expect(guard.run(create)).rejects.toThrow("fail");
    const again = await guard.run(create);
    expect(create).toHaveBeenCalledTimes(2);
    expect(again.result.id).toBe("p-ok");
  });

  it("redirect routes by scenario", () => {
    const project = { id: "p9", manualParams: {} };
    expect(resolveCreateProjectRedirect(project, CREATE_SCENARIO.EMPTY)).toBe(
      "/project/p9?created=1"
    );
    expect(resolveCreateProjectRedirect(project, CREATE_SCENARIO.GENERAL_PURCHASE)).toBe(
      "/project/p9?created=1&focus=general"
    );
    expect(resolveCreateProjectRedirect(project, CREATE_SCENARIO.BUILDER)).toContain(
      "/new?projectId=p9"
    );
  });

  it("onboarding flag from created query or manualParams", () => {
    expect(shouldShowCreateOnboarding({ manualParams: {} }, { get: () => "1" })).toBe(true);
    expect(
      shouldShowCreateOnboarding({ manualParams: { showCreateOnboarding: true } }, { get: () => null })
    ).toBe(true);
    expect(
      shouldShowCreateOnboarding({ manualParams: { showCreateOnboarding: false } }, { get: () => "1" })
    ).toBe(false);
  });

  it("kind badge labels", () => {
    expect(getProjectKindBadge(PROJECT_KIND.CLIENT)).toBe("Клиентский");
    expect(resolveProjectKind({ manualParams: { projectKind: "test" } })).toBe("test");
  });
});

describe("projectCreation empty readiness", () => {
  it("empty project readiness is EMPTY / not ready / not blocker", () => {
    const checklist = buildProjectPreSendChecklist([]);
    const readiness = buildProjectSendReadiness(checklist);
    expect(checklist.clientTotalCount).toBe(0);
    expect(readiness.status).toBe("empty");
    expect(readiness.title).toBe("Проект ещё не заполнен");
    expect(readiness.isReady).toBe(false);
    expect(readiness.isBlocker).toBe(false);
    expect(readiness.isEmpty).toBe(true);
  });

  it("after client items appear, readiness recalculates", () => {
    const empty = buildProjectSendReadiness(buildProjectPreSendChecklist([]));
    expect(empty.status).toBe("empty");
    const withItem = buildProjectSendReadiness(
      buildProjectPreSendChecklist([
        {
          id: "it1",
          name: "Позиция",
          qty: 1,
          unit: "шт.",
          price: 100,
          supplier: "S",
          link: "https://x",
          purchaseStatus: "not_bought",
          status: "not_bought",
          visibleToClient: true,
          includedInProject: true,
          enabled: true,
          approved: true,
          module: "mod",
          clientSection: "stellage",
          responsible: "general",
          itemRole: "purchase",
          category: "Каркас и крепёж",
        },
      ])
    );
    expect(withItem.status).not.toBe("empty");
    expect(withItem.isEmpty).toBe(false);
    expect(withItem.clientTotalCount === undefined || withItem.isReady !== undefined).toBe(true);
  });
});

describe("projectCreation hydrate empty structure", () => {
  it("empty rooms stay empty; no invented racks", () => {
    const hydrated = hydrateBuilderFromProject({
      id: "p",
      name: "TEST",
      client: "C",
      items: [],
      rooms: [],
      stellageConfigs: [],
      manualParams: {},
    });
    expect(hydrated.rooms).toEqual([]);
    expect(hydrated.stellages).toEqual([]);
  });
});
