import { describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  createTitleSaveGate,
  nextTitleDraftFromProps,
  resolveSchemeTitleCommit,
} from "../src/lib/schemeTitleDraft.js";
import { getFloorPlanEntry, setFloorPlanTitle, setFloorPlanUrl } from "../src/lib/clientSchemes.js";
import { isPdfScheme } from "../src/lib/schemeMedia.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("floor plan title save stabilization", () => {
  it("rapid typing keeps full draft locally and does not emit save until commit", () => {
    const saves = [];
    let draft = "";
    const saved = "Схема помещения";
    const type = "FastTitleTypingCheck123";
    for (const ch of type) {
      draft += ch;
      // onChange only mutates draft — no resolve/save per character
      expect(draft.endsWith(ch)).toBe(true);
      expect(saves).toHaveLength(0);
    }
    expect(draft).toBe(type);
    const resolved = resolveSchemeTitleCommit(draft, saved);
    expect(resolved.shouldSave).toBe(true);
    expect(resolved.value).toBe(type);
    saves.push(resolved.value);
    expect(saves).toEqual([type]);
  });

  it("blur/commit saves once with exact final title", () => {
    const onCommit = vi.fn();
    const resolved = resolveSchemeTitleCommit("  Final Floor Title  ", "Old");
    expect(resolved.shouldSave).toBe(true);
    if (resolved.shouldSave) onCommit(resolved.value);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("Final Floor Title");
  });

  it("Enter uses the same commit path as blur (final title)", () => {
    // Enter blurs the input; commit semantics are identical.
    const resolved = resolveSchemeTitleCommit("EnterSavedTitleValueOK", "prev");
    expect(resolved).toEqual({
      shouldSave: true,
      value: "EnterSavedTitleValueOK",
      display: "EnterSavedTitleValueOK",
    });
  });

  it("unchanged value does not save", () => {
    expect(resolveSchemeTitleCommit("Same Title", "Same Title").shouldSave).toBe(false);
    expect(resolveSchemeTitleCommit("  Same Title  ", "Same Title").shouldSave).toBe(false);
  });

  it("empty draft reverts without save", () => {
    const resolved = resolveSchemeTitleCommit("   ", "Kept Title");
    expect(resolved.shouldSave).toBe(false);
    expect(resolved.display).toBe("Kept Title");
  });

  it("reload model keeps full committed title without corruption", () => {
    let mp = setFloorPlanUrl({ projectSchemes: [] }, "/uploads/plan.png", {
      mimeType: "image/png",
      title: "Схема помещения",
    });
    const full = "FastTitleTypingCheck123";
    mp = setFloorPlanTitle(mp, full);
    expect(getFloorPlanEntry(mp).title).toBe(full);
    // simulate reload from stored manualParams
    expect(getFloorPlanEntry({ ...mp }).title).toBe(full);
  });

  it("slow/out-of-order responses: stale save does not win over latest", async () => {
    const gate = createTitleSaveGate();
    const applied = [];
    const save = async (title, delay) => {
      const token = gate.begin();
      await new Promise((r) => setTimeout(r, delay));
      if (gate.isLatest(token)) applied.push(title);
    };
    const p1 = save("OldPartialTitle", 40);
    const p2 = save("LatestCompleteTitleValue", 5);
    await Promise.all([p1, p2]);
    expect(applied).toEqual(["LatestCompleteTitleValue"]);
  });

  it("queued commits keep only the latest pending title after an in-flight save", async () => {
    const applied = [];
    let releaseFirst;
    const firstBarrier = new Promise((r) => {
      releaseFirst = r;
    });
    let pending = null;
    let saving = false;
    const onCommit = async (title) => {
      applied.push(title);
      if (title === "FirstTitleValueAAAA") await firstBarrier;
    };
    const flush = async () => {
      if (saving) return;
      saving = true;
      try {
        while (pending != null) {
          const next = pending;
          pending = null;
          await onCommit(next);
        }
      } finally {
        saving = false;
        if (pending != null) await flush();
      }
    };

    pending = "FirstTitleValueAAAA";
    const firstFlush = flush();
    pending = "SecondTitleValueBBBB";
    releaseFirst();
    await firstFlush;
    await flush();
    expect(applied).toEqual(["FirstTitleValueAAAA", "SecondTitleValueBBBB"]);
  });

  it("project switch syncs draft from incoming props when not editing", () => {
    expect(
      nextTitleDraftFromProps({
        editing: false,
        incomingValue: "Project B Title",
        currentDraft: "Project A Draft",
      })
    ).toBe("Project B Title");
    expect(
      nextTitleDraftFromProps({
        editing: true,
        incomingValue: "Project B Title",
        currentDraft: "Project A Draft",
      })
    ).toBe("Project A Draft");
  });

  it("title commit helpers do not break image/PDF floor-plan metadata", () => {
    let mp = setFloorPlanUrl({ projectSchemes: [] }, "/uploads/a.pdf", {
      mimeType: "application/pdf",
      title: "PDF Plan",
    });
    expect(isPdfScheme(getFloorPlanEntry(mp))).toBe(true);
    mp = setFloorPlanTitle(mp, "PDF Plan Renamed");
    expect(getFloorPlanEntry(mp)).toMatchObject({
      url: "/uploads/a.pdf",
      mimeType: "application/pdf",
      title: "PDF Plan Renamed",
    });
    mp = setFloorPlanUrl(mp, "/uploads/b.png", { mimeType: "image/png" });
    expect(isPdfScheme(getFloorPlanEntry(mp))).toBe(false);
    expect(getFloorPlanEntry(mp).url).toBe("/uploads/b.png");
  });

  it("FloorPlanField uses draft/blur commit and not per-keystroke onTitleChange", () => {
    const src = fs.readFileSync(path.join(root, "src/components/FloorPlanField.jsx"), "utf8");
    expect(src).toContain("FloorPlanTitleInput");
    expect(src).toContain("resolveSchemeTitleCommit");
    expect(src).toContain("onBlur={commit}");
    expect(src).toContain("onCommit={onTitleChange}");
    expect(src).not.toMatch(/onChange=\{\(e\) => onTitleChange\(e\.target\.value\)\}/);
    expect(src).toContain('event.key === "Enter"');
    expect(src).toContain('event.key === "Escape"');
    expect(src).toContain("SCHEME_FILE_ACCEPT");
    expect(src).toContain("isPdfScheme");
  });
});
