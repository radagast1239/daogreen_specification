/** Unified six-step builder — scenario fork removed from UX. */
import { describe, it, expect, vi } from "vitest";
import {
  buildNewProjectPayload,
  createProjectSubmitGuard,
  resolveCreateProjectRedirect,
  shouldCreateProjectOnStepChange,
  shouldUpdateDraftOnStepChange,
  canSubmitNewProject,
  CREATE_SCENARIO,
} from "../shared/projectCreation.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("projectWizard", () => {
  it("does not create project until explicit submit helper runs", async () => {
    const create = vi.fn(async () => ({ id: "p1" }));
    expect(create).toHaveBeenCalledTimes(0);
    expect(shouldCreateProjectOnStepChange()).toBe(false);
    const guard = createProjectSubmitGuard();
    await guard.run(async () => {
      const payload = buildNewProjectPayload({ name: "N", client: "C" });
      expect(payload.items).toEqual([]);
      expect(payload.rooms).toEqual([]);
      expect(payload.stellageConfigs).toEqual([]);
      return create(payload);
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(resolveCreateProjectRedirect({ id: "p1" }, CREATE_SCENARIO.EMPTY)).toContain(
      "created=1"
    );
  });

  it("double-click create runs once; second draft update reuses id", async () => {
    const create = vi.fn(async () => ({ id: "p-once" }));
    const update = vi.fn(async (id, payload) => ({ id, ...payload }));
    const guard = createProjectSubmitGuard();
    const a = guard.run(() => create());
    const b = guard.run(() => create());
    const [r1, r2] = await Promise.all([a, b]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(r1.ok).toBe(true);
    expect(r2.skipped).toBe(true);
    const id = r1.result.id;
    await update(id, { name: "N2" });
    await update(id, { name: "N3" });
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls.every((c) => c[0] === id)).toBe(true);
  });

  it("final create after draft updates same id (no second create)", async () => {
    let created = 0;
    const create = vi.fn(async () => {
      created += 1;
      return { id: "p-draft" };
    });
    const update = vi.fn(async (id) => ({ id, status: "active" }));
    const draftGuard = createProjectSubmitGuard();
    const draft = await draftGuard.run(() => create());
    expect(draft.result.id).toBe("p-draft");
    // Existing draft → update, not create
    const finalized = await update(draft.result.id, { status: "active" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(finalized.id).toBe("p-draft");
    expect(created).toBe(1);
  });

  it("empty payload readiness fields stay empty", () => {
    const payload = buildNewProjectPayload({ name: "A", client: "B" });
    expect(payload.items).toEqual([]);
    expect(payload.rooms).toEqual([]);
    expect(canSubmitNewProject({ name: "A", client: "B" })).toBe(true);
    expect(shouldUpdateDraftOnStepChange(undefined)).toBe(false);
  });

  it("CreateProjectWizardPage is unrouted from App", () => {
    const appSrc = readFileSync(resolve(process.cwd(), "src/App.jsx"), "utf8");
    expect(appSrc).not.toContain("CreateProjectWizardPage");
    expect(appSrc).toContain("ProjectBuilderPage");
  });
});
