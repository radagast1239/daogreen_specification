/** Wizard-focused aliases — see projectCreation.test.js for full coverage. */
import { describe, it, expect, vi } from "vitest";
import {
  buildNewProjectPayload,
  createProjectSubmitGuard,
  resolveCreateProjectRedirect,
  CREATE_SCENARIO,
} from "../shared/projectCreation.js";

describe("projectWizard", () => {
  it("does not create project until final submit helper runs", async () => {
    const create = vi.fn(async () => ({ id: "p1" }));
    // Steps / close: no create
    expect(create).toHaveBeenCalledTimes(0);
    const guard = createProjectSubmitGuard();
    await guard.run(async () => {
      const payload = buildNewProjectPayload({ name: "N", client: "C" });
      expect(payload.items).toEqual([]);
      return create(payload);
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(resolveCreateProjectRedirect({ id: "p1" }, CREATE_SCENARIO.EMPTY)).toContain(
      "created=1"
    );
  });
});
