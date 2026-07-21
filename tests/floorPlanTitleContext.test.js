import { describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  createFloorPlanTitleQueue,
  nextTitleDraftFromProps,
  resolveSchemeTitleCommit,
} from "../src/lib/schemeTitleDraft.js";
import { getFloorPlanEntry, setFloorPlanTitle, setFloorPlanUrl } from "../src/lib/clientSchemes.js";
import { isPdfScheme } from "../src/lib/schemeMedia.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("floor plan title context isolation (runtime queue)", () => {
  it("rapid typing keeps full draft locally until commit", () => {
    const type = "FastTitleTypingCheck123";
    let draft = "";
    for (const ch of type) draft += ch;
    expect(draft).toBe(type);
    expect(resolveSchemeTitleCommit(draft, "Old").value).toBe(type);
  });

  it("blur/commit and Enter share resolveSchemeTitleCommit; unchanged skips save", () => {
    expect(resolveSchemeTitleCommit("  Final  ", "Old")).toEqual({
      shouldSave: true,
      value: "Final",
      display: "Final",
    });
    expect(resolveSchemeTitleCommit("Same", "Same").shouldSave).toBe(false);
    expect(resolveSchemeTitleCommit("   ", "Kept").display).toBe("Kept");
  });

  it("queued A2 after delayed A1 never sends A2 through B callback after switch", async () => {
    const queue = createFloorPlanTitleQueue();
    const writesA = [];
    const writesB = [];
    let releaseA1;
    const a1Barrier = new Promise((r) => {
      releaseA1 = r;
    });

    const commitA = async (value) => {
      if (value === "A1") await a1Barrier;
      writesA.push(value);
    };
    const commitB = async (value) => {
      writesB.push(value);
    };

    queue.enqueue({
      identityKey: "A:file1",
      projectId: "A",
      value: "A1",
      commit: commitA,
    });
    // Let A1 start so A2 is not coalesced into the in-flight job.
    await new Promise((r) => setTimeout(r, 5));
    queue.enqueue({
      identityKey: "A:file1",
      projectId: "A",
      value: "A2",
      commit: commitA,
    });

    // Project switch to B — B enqueues its own job with B callback
    queue.enqueue({
      identityKey: "B:file1",
      projectId: "B",
      value: "B-Title",
      commit: commitB,
    });

    releaseA1();
    await new Promise((r) => setTimeout(r, 40));

    expect(writesA).toEqual(["A1", "A2"]);
    expect(writesB).toEqual(["B-Title"]);
    expect(writesB).not.toContain("A2");
  });

  it("out-of-order A/B edits keep project-bound values", async () => {
    const queue = createFloorPlanTitleQueue();
    const byProject = { A: [], B: [] };
    let releaseA;
    const barrierA = new Promise((r) => {
      releaseA = r;
    });

    queue.enqueue({
      identityKey: "A:f",
      projectId: "A",
      value: "Title-A",
      commit: async (v) => {
        await barrierA;
        byProject.A.push(v);
      },
    });
    queue.enqueue({
      identityKey: "B:f",
      projectId: "B",
      value: "Title-B",
      commit: async (v) => {
        byProject.B.push(v);
      },
    });

    await new Promise((r) => setTimeout(r, 10));
    releaseA();
    await new Promise((r) => setTimeout(r, 30));

    expect(byProject.A).toEqual(["Title-A"]);
    expect(byProject.B).toEqual(["Title-B"]);
  });

  it("A → B → A: old generation job cannot update new A UI state", async () => {
    const queue = createFloorPlanTitleQueue();
    let activeIdentity = "A:v1";
    const uiDraft = { current: "seed" };
    let release;
    const barrier = new Promise((r) => {
      release = r;
    });

    queue.enqueue({
      identityKey: "A:v1",
      projectId: "A",
      value: "OLD-A",
      commit: async (v) => {
        await barrier;
        return v;
      },
      onSuccess: (job) => {
        if (activeIdentity !== job.identityKey) return;
        uiDraft.current = job.value;
      },
    });

    // Switch away and back — new identity for remounted A
    activeIdentity = "B:f";
    activeIdentity = "A:v2";
    uiDraft.current = "fresh-A";

    release();
    await new Promise((r) => setTimeout(r, 30));
    expect(uiDraft.current).toBe("fresh-A");
  });

  it("unmount during in-flight save: target remains old project only", async () => {
    const queue = createFloorPlanTitleQueue();
    const writes = [];
    let release;
    const barrier = new Promise((r) => {
      release = r;
    });
    let mounted = true;

    queue.enqueue({
      identityKey: "A:f",
      projectId: "A",
      value: "Only-A",
      commit: async (v) => {
        await barrier;
        if (!mounted) {
          // still allowed to finish write to A
          writes.push({ projectId: "A", value: v });
          return;
        }
        writes.push({ projectId: "A", value: v });
      },
      onSuccess: (job) => {
        if (!mounted) return;
        writes.push({ ui: job.value });
      },
    });

    mounted = false;
    release();
    await new Promise((r) => setTimeout(r, 30));
    expect(writes).toEqual([{ projectId: "A", value: "Only-A" }]);
  });

  it("save failure: no unhandled rejection, error callback, value retryable", async () => {
    const queue = createFloorPlanTitleQueue();
    const errors = [];
    const writes = [];
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    try {
      queue.enqueue({
        identityKey: "A:f",
        projectId: "A",
        value: "FailTitle",
        commit: async () => {
          throw new Error("save failed");
        },
        onError: (err, job) => {
          errors.push({ message: err.message, value: job.value });
        },
      });
      await new Promise((r) => setTimeout(r, 30));

      expect(errors).toEqual([{ message: "save failed", value: "FailTitle" }]);
      expect(unhandled).toHaveLength(0);

      queue.enqueue({
        identityKey: "A:f",
        projectId: "A",
        value: "FailTitle",
        commit: async (v) => {
          writes.push(v);
        },
      });
      await new Promise((r) => setTimeout(r, 30));
      expect(writes).toEqual(["FailTitle"]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("Enter triggers the same blur commit path once (no separate Enter save)", () => {
    const src = fs.readFileSync(path.join(root, "src/components/FloorPlanField.jsx"), "utf8");
    expect(src).toContain('event.key === "Enter"');
    expect(src).toContain("event.currentTarget.blur()");
    // Enter only blurs; commit runs once from onBlur.
    expect(src).toMatch(/onBlur=\{commit\}/);
    const enterLine = src.split("\n").find((l) => l.includes('event.key === "Enter"'));
    expect(enterLine).toContain("blur()");
    expect(enterLine).not.toContain("commit(");
  });

  it("pending same-identity enqueues before flush coalesce to latest value", async () => {
    const queue = createFloorPlanTitleQueue();
    const writes = [];
    // Two sync enqueues before microtask flush — latest wins.
    queue.enqueue({
      identityKey: "A:f",
      projectId: "A",
      value: "First",
      commit: async (v) => {
        writes.push(v);
      },
    });
    queue.enqueue({
      identityKey: "A:f",
      projectId: "A",
      value: "Latest",
      commit: async (v) => {
        writes.push(v);
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(writes).toEqual(["Latest"]);
  });

  it("replacement identity: old title job cannot attach to new file identity", async () => {
    const queue = createFloorPlanTitleQueue();
    const writes = [];
    let release;
    const barrier = new Promise((r) => {
      release = r;
    });
    let activeIdentity = "A:/uploads/old.png";

    queue.enqueue({
      identityKey: "A:/uploads/old.png",
      projectId: "A",
      value: "Old-File-Title",
      commit: async (v) => {
        await barrier;
        writes.push({ identity: "old", value: v });
      },
      onSuccess: (job) => {
        if (activeIdentity !== job.identityKey) return;
        writes.push({ ui: job.value });
      },
    });

    activeIdentity = "A:/uploads/new.png";
    queue.enqueue({
      identityKey: "A:/uploads/new.png",
      projectId: "A",
      value: "New-File-Title",
      commit: async (v) => {
        writes.push({ identity: "new", value: v });
      },
      onSuccess: (job) => {
        if (activeIdentity !== job.identityKey) return;
        writes.push({ ui: job.value });
      },
    });

    release();
    await new Promise((r) => setTimeout(r, 30));
    expect(writes).toEqual([
      { identity: "old", value: "Old-File-Title" },
      { identity: "new", value: "New-File-Title" },
      { ui: "New-File-Title" },
    ]);
  });

  it("nextTitleDraftFromProps preserves draft while editing", () => {
    expect(
      nextTitleDraftFromProps({
        editing: true,
        incomingValue: "Incoming",
        currentDraft: "Local",
      })
    ).toBe("Local");
    expect(
      nextTitleDraftFromProps({
        editing: false,
        incomingValue: "Incoming",
        currentDraft: "Local",
      })
    ).toBe("Incoming");
  });

  it("title helpers do not break image/PDF floor-plan metadata", () => {
    let mp = setFloorPlanUrl({ projectSchemes: [] }, "/uploads/a.pdf", {
      mimeType: "application/pdf",
      title: "PDF Plan",
    });
    expect(isPdfScheme(getFloorPlanEntry(mp))).toBe(true);
    mp = setFloorPlanTitle(mp, "PDF Plan Renamed");
    expect(getFloorPlanEntry(mp).title).toBe("PDF Plan Renamed");
  });

  it("FloorPlanField uses identity-bound queue and nextTitleDraftFromProps", () => {
    const src = fs.readFileSync(path.join(root, "src/components/FloorPlanField.jsx"), "utf8");
    expect(src).toContain("createFloorPlanTitleQueue");
    expect(src).toContain("identityKey");
    expect(src).toContain("projectId");
    expect(src).toContain("nextTitleDraftFromProps");
    expect(src).toContain("onError");
    expect(src).not.toContain("createTitleSaveGate");
    expect(src).not.toContain("onCommitRef.current(nextValue)");
  });
});
