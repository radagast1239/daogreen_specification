import { describe, expect, it } from "vitest";
import { buildBuilderContinuePath, PROJECT_STATUS_ACTIVE } from "../shared/projectLifecycle.js";

/** UI contract: finished-project card links to edit wizard for same projectId. */
describe("ProjectsPage edit button URL", () => {
  it("builds edit URL with existing projectId and mode=edit", () => {
    const p = {
      id: "proj_abc",
      status: PROJECT_STATUS_ACTIVE,
      manualParams: { builderWizard: { lastStep: "general" } },
    };
    const url = buildBuilderContinuePath(p);
    expect(url).toBe("/new?projectId=proj_abc&mode=edit&step=general");
    expect(url).toContain("projectId=proj_abc");
    expect(url).toContain("mode=edit");
    expect(url).not.toContain("mode=draft");
  });
});
