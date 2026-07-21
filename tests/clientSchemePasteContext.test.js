import { describe, expect, it } from "vitest";
import {
  addProjectScheme,
  listProjectSchemes,
} from "../src/lib/clientSchemes.js";
import {
  beginSchemePasteAttempt,
  pasteClipboardSchemeImage,
  schemeTitleFromPasteFile,
} from "../src/lib/schemeClipboardPaste.js";
import { isEditablePasteTarget } from "../src/lib/clipboardPhoto.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function pngFile(name = "shot.png") {
  return new File([Uint8Array.from([1, 2, 3, 4])], name, { type: "image/png" });
}

describe("client scheme paste context isolation (runtime)", () => {
  it("project A paste then switch to B before resolve: no write to A or B", async () => {
    const aMp = addProjectScheme(
      { projectSchemes: [] },
      { id: "a1", title: "A1", url: "/uploads/a1.png", mimeType: "image/png" }
    );
    const bMp = addProjectScheme(
      { projectSchemes: [] },
      { id: "b1", title: "B1", url: "/uploads/b1.png", mimeType: "image/png" }
    );
    let resolveUpload;
    const uploadPromise = new Promise((r) => {
      resolveUpload = r;
    });

    let generation = 1;
    let projectId = "A";
    let mp = aMp;
    const writesA = [];
    const writesB = [];
    const onChangeB = (next) => {
      writesB.push(next);
      mp = next;
    };
    let activeWrite = (next) => {
      writesA.push(next);
      mp = next;
    };

    // Capture A write at start (as ClientSchemesEditor does)
    const attemptFixed = beginSchemePasteAttempt({
      projectId: "A",
      generation: 1,
      getGeneration: () => generation,
      getProjectId: () => projectId,
      isMounted: () => true,
      getManualParams: () => mp,
      onChange: (next) => {
        // simulate captured write still pointing at A store
        writesA.push(next);
      },
    });

    const pending = pasteClipboardSchemeImage({
      file: pngFile("cross.png"),
      uploadFile: async () => uploadPromise,
      attempt: attemptFixed,
    });

    // Switch to B: new generation + B manualParams live in mp
    projectId = "B";
    generation = 2;
    mp = bMp;
    activeWrite = onChangeB;
    void activeWrite;

    resolveUpload({ url: "/uploads/cross.png", mimeType: "image/png" });
    const outcome = await pending;

    expect(outcome.stale).toBe(true);
    expect(outcome.ok).toBe(false);
    expect(writesA).toHaveLength(0);
    expect(writesB).toHaveLength(0);
    expect(listProjectSchemes(aMp)).toHaveLength(1);
    expect(listProjectSchemes(bMp)).toHaveLength(1);
    expect(listProjectSchemes(aMp)[0].url).toBe("/uploads/a1.png");
    expect(listProjectSchemes(bMp)[0].url).toBe("/uploads/b1.png");
  });

  it("A → B → A before resolve still invalidates old attempt via generation", async () => {
    let generation = 1;
    let projectId = "A";
    let mp = { projectSchemes: [] };
    const writes = [];
    let resolveUpload;
    const uploadPromise = new Promise((r) => {
      resolveUpload = r;
    });

    const attempt = beginSchemePasteAttempt({
      projectId: "A",
      generation: 1,
      getGeneration: () => generation,
      getProjectId: () => projectId,
      isMounted: () => true,
      getManualParams: () => mp,
      onChange: (next) => writes.push(next),
    });

    const pending = pasteClipboardSchemeImage({
      file: pngFile(),
      uploadFile: async () => uploadPromise,
      attempt,
    });

    projectId = "B";
    generation = 2;
    projectId = "A";
    generation = 3; // remount/return to A

    resolveUpload({ url: "/uploads/x.png", mimeType: "image/png" });
    const outcome = await pending;
    expect(outcome.stale).toBe(true);
    expect(writes).toHaveLength(0);
  });

  it("same-project edit during upload is preserved and new card appends once", async () => {
    let mp = addProjectScheme(
      { projectSchemes: [] },
      {
        id: "keep",
        title: "Keep",
        url: "/uploads/keep.png",
        mimeType: "image/png",
        clientVisible: true,
      }
    );
    let resolveUpload;
    const uploadPromise = new Promise((r) => {
      resolveUpload = r;
    });
    const writes = [];
    const attempt = beginSchemePasteAttempt({
      projectId: "A",
      generation: 1,
      getGeneration: () => 1,
      getProjectId: () => "A",
      isMounted: () => true,
      getManualParams: () => mp,
      onChange: (next) => {
        mp = next;
        writes.push(listProjectSchemes(next).map((s) => s.id));
      },
    });

    const pending = pasteClipboardSchemeImage({
      file: pngFile("new.png"),
      uploadFile: async () => uploadPromise,
      attempt,
    });

    // Concurrent same-project rename while upload in flight
    mp = {
      projectSchemes: listProjectSchemes(mp).map((s) =>
        s.id === "keep" ? { ...s, title: "Keep Renamed", clientVisible: false } : s
      ),
    };

    resolveUpload({ url: "/uploads/new.png", mimeType: "image/png" });
    const outcome = await pending;
    expect(outcome.ok).toBe(true);
    expect(writes).toHaveLength(1);
    const list = listProjectSchemes(mp);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      id: "keep",
      title: "Keep Renamed",
      clientVisible: false,
      url: "/uploads/keep.png",
    });
    expect(list[1].url).toBe("/uploads/new.png");
  });

  it("unmount before resolve: no write", async () => {
    let mounted = true;
    const writes = [];
    let resolveUpload;
    const uploadPromise = new Promise((r) => {
      resolveUpload = r;
    });
    const attempt = beginSchemePasteAttempt({
      projectId: "A",
      generation: 1,
      getGeneration: () => 1,
      getProjectId: () => "A",
      isMounted: () => mounted,
      getManualParams: () => ({ projectSchemes: [] }),
      onChange: (next) => writes.push(next),
    });
    const pending = pasteClipboardSchemeImage({
      file: pngFile(),
      uploadFile: async () => uploadPromise,
      attempt,
    });
    mounted = false;
    resolveUpload({ url: "/uploads/orphan.png", mimeType: "image/png" });
    const outcome = await pending;
    expect(outcome.stale).toBe(true);
    expect(outcome.orphanUploadUrl).toBe("/uploads/orphan.png");
    expect(writes).toHaveLength(0);
  });

  it("reject after switch: no card and no write", async () => {
    let generation = 1;
    let projectId = "A";
    const writes = [];
    const attempt = beginSchemePasteAttempt({
      projectId: "A",
      generation: 1,
      getGeneration: () => generation,
      getProjectId: () => projectId,
      isMounted: () => true,
      getManualParams: () => ({ projectSchemes: [] }),
      onChange: (next) => writes.push(next),
    });
    const pending = pasteClipboardSchemeImage({
      file: pngFile(),
      uploadFile: async () => {
        throw new Error("Failed to fetch");
      },
      attempt,
    });
    projectId = "B";
    generation = 2;
    await expect(pending).rejects.toThrow(/Failed to fetch/);
    expect(writes).toHaveLength(0);
  });

  it("failed paste then retry succeeds", async () => {
    let mp = { projectSchemes: [] };
    const attempt1 = beginSchemePasteAttempt({
      projectId: "A",
      generation: 1,
      getGeneration: () => 1,
      getProjectId: () => "A",
      isMounted: () => true,
      getManualParams: () => mp,
      onChange: (next) => {
        mp = next;
      },
    });
    await expect(
      pasteClipboardSchemeImage({
        file: pngFile("r1.png"),
        uploadFile: async () => {
          throw new Error("boom");
        },
        attempt: attempt1,
      })
    ).rejects.toThrow(/boom/);
    expect(listProjectSchemes(mp)).toHaveLength(0);

    const attempt2 = beginSchemePasteAttempt({
      projectId: "A",
      generation: 1,
      getGeneration: () => 1,
      getProjectId: () => "A",
      isMounted: () => true,
      getManualParams: () => mp,
      onChange: (next) => {
        mp = next;
      },
    });
    const second = await pasteClipboardSchemeImage({
      file: pngFile("r2.png"),
      uploadFile: async () => ({ url: "/uploads/r2.png", mimeType: "image/png" }),
      attempt: attempt2,
    });
    expect(second.ok).toBe(true);
    expect(listProjectSchemes(mp)).toHaveLength(1);
  });

  it("title/input paste targets do not start upload (editable guard)", () => {
    expect(isEditablePasteTarget({ target: { tagName: "INPUT" } })).toBe(true);
    expect(isEditablePasteTarget({ target: { tagName: "DIV" } })).toBe(false);
  });

  it("schemeTitleFromPasteFile strips extension", () => {
    expect(schemeTitleFromPasteFile(pngFile("Скриншот 2026-07-21.png"))).toBe("Скриншот 2026-07-21");
  });

  it("ClientSchemesEditor wires beginSchemePasteAttempt + projectId", () => {
    const src = fs.readFileSync(path.join(root, "src/components/ClientSchemesEditor.jsx"), "utf8");
    expect(src).toContain("beginSchemePasteAttempt");
    expect(src).toContain("pasteClipboardSchemeImage");
    expect(src).toContain("projectId");
    expect(src).toContain("generationRef");
    expect(src).not.toContain("rollbackEmptySchemeCard");
  });
});
