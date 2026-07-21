import { describe, expect, it } from "vitest";
import {
  addProjectScheme,
  listProjectSchemes,
} from "../src/lib/clientSchemes.js";
import {
  pasteClipboardSchemeImage,
  rollbackEmptySchemeCard,
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

describe("client scheme paste rollback", () => {
  it("failed paste does not leave a placeholder and keeps existing cards", async () => {
    let mp = { projectSchemes: [] };
    mp = addProjectScheme(mp, {
      id: "keep-1",
      title: "Existing",
      url: "/uploads/keep.png",
      mimeType: "image/png",
      clientVisible: true,
    });
    const before = listProjectSchemes(mp);
    expect(before).toHaveLength(1);

    const changes = [];
    await expect(
      pasteClipboardSchemeImage({
        manualParams: mp,
        file: pngFile("fail.png"),
        getManualParams: () => mp,
        onChange: (next) => {
          mp = next;
          changes.push(listProjectSchemes(next).map((s) => ({ id: s.id, url: s.url, title: s.title })));
        },
        uploadFile: async () => {
          throw new Error("upload failed");
        },
      })
    ).rejects.toThrow(/upload failed/);

    const after = listProjectSchemes(mp);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      id: "keep-1",
      title: "Existing",
      url: "/uploads/keep.png",
      clientVisible: true,
      sortOrder: 0,
    });
    expect(after.some((s) => !s.url)).toBe(false);
    // upload-first: onChange never runs on failure
    expect(changes).toHaveLength(0);
  });

  it("abort/network failure leaves no empty card", async () => {
    let mp = { projectSchemes: [] };
    await expect(
      pasteClipboardSchemeImage({
        manualParams: mp,
        file: pngFile(),
        getManualParams: () => mp,
        onChange: (next) => {
          mp = next;
        },
        uploadFile: async () => {
          const err = new Error("Failed to fetch");
          err.name = "TypeError";
          throw err;
        },
      })
    ).rejects.toThrow(/Failed to fetch/);
    expect(listProjectSchemes(mp).filter((s) => !s.url)).toHaveLength(0);
    expect(listProjectSchemes(mp)).toHaveLength(0);
  });

  it("successful paste keeps card with url/mimeType", async () => {
    let mp = { projectSchemes: [] };
    const result = await pasteClipboardSchemeImage({
      manualParams: mp,
      file: pngFile("ok.png"),
      getManualParams: () => mp,
      onChange: (next) => {
        mp = next;
      },
      uploadFile: async () => ({ url: "/uploads/ok.png", mimeType: "image/png" }),
    });
    expect(result.ok).toBe(true);
    const list = listProjectSchemes(mp);
    expect(list).toHaveLength(1);
    expect(list[0].url).toBe("/uploads/ok.png");
    expect(list[0].mimeType).toBe("image/png");
    expect(list[0].id).toBe(result.id);
  });

  it("retry after failure succeeds", async () => {
    let mp = { projectSchemes: [] };
    let attempts = 0;
    await expect(
      pasteClipboardSchemeImage({
        manualParams: mp,
        file: pngFile("r1.png"),
        getManualParams: () => mp,
        onChange: (next) => {
          mp = next;
        },
        uploadFile: async () => {
          attempts += 1;
          throw new Error("boom");
        },
      })
    ).rejects.toThrow(/boom/);
    expect(listProjectSchemes(mp)).toHaveLength(0);

    const second = await pasteClipboardSchemeImage({
      manualParams: mp,
      file: pngFile("r2.png"),
      getManualParams: () => mp,
      onChange: (next) => {
        mp = next;
      },
      uploadFile: async () => ({ url: "/uploads/r2.png", mimeType: "image/png" }),
    });
    expect(attempts).toBe(1);
    expect(second.ok).toBe(true);
    expect(listProjectSchemes(mp)).toHaveLength(1);
    expect(listProjectSchemes(mp)[0].url).toBe("/uploads/r2.png");
  });

  it("existing cards keep id/title/order/clientVisible after failed paste", async () => {
    let mp = { projectSchemes: [] };
    mp = addProjectScheme(mp, {
      id: "a",
      title: "Alpha",
      url: "/uploads/a.png",
      mimeType: "image/png",
      clientVisible: true,
    });
    mp = addProjectScheme(mp, {
      id: "b",
      title: "Beta",
      url: "/uploads/b.pdf",
      mimeType: "application/pdf",
      clientVisible: false,
    });
    const snapshot = listProjectSchemes(mp).map((s) => ({
      id: s.id,
      title: s.title,
      sortOrder: s.sortOrder,
      clientVisible: s.clientVisible,
      url: s.url,
      mimeType: s.mimeType,
    }));

    await expect(
      pasteClipboardSchemeImage({
        manualParams: mp,
        file: pngFile(),
        getManualParams: () => mp,
        onChange: (next) => {
          mp = next;
        },
        uploadFile: async () => {
          throw new Error("nope");
        },
      })
    ).rejects.toThrow(/nope/);

    expect(
      listProjectSchemes(mp).map((s) => ({
        id: s.id,
        title: s.title,
        sortOrder: s.sortOrder,
        clientVisible: s.clientVisible,
        url: s.url,
        mimeType: s.mimeType,
      }))
    ).toEqual(snapshot);
  });

  it("failure of one attempt does not remove a successful card from another attempt", async () => {
    let mp = { projectSchemes: [] };
    const ok = await pasteClipboardSchemeImage({
      manualParams: mp,
      file: pngFile("good.png"),
      getManualParams: () => mp,
      onChange: (next) => {
        mp = next;
      },
      uploadFile: async () => ({ url: "/uploads/good.png", mimeType: "image/png" }),
    });
    expect(ok.ok).toBe(true);
    const goodId = ok.id;

    await expect(
      pasteClipboardSchemeImage({
        manualParams: mp,
        file: pngFile("bad.png"),
        getManualParams: () => mp,
        onChange: (next) => {
          mp = next;
        },
        uploadFile: async () => {
          throw new Error("fail-2");
        },
      })
    ).rejects.toThrow(/fail-2/);

    const list = listProjectSchemes(mp);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(goodId);
    expect(list[0].url).toBe("/uploads/good.png");
  });

  it("rollbackEmptySchemeCard never removes a filled card", () => {
    let mp = addProjectScheme(
      { projectSchemes: [] },
      { id: "filled", title: "F", url: "/uploads/f.png", mimeType: "image/png" }
    );
    const rolled = rollbackEmptySchemeCard(mp, "filled");
    expect(rolled.removed).toBe(false);
    expect(listProjectSchemes(rolled.manualParams)[0].url).toBe("/uploads/f.png");
  });

  it("rollbackEmptySchemeCard removes url-less placeholder by id only", () => {
    let mp = addProjectScheme(
      { projectSchemes: [] },
      { id: "keep", title: "K", url: "/uploads/k.png", mimeType: "image/png", clientVisible: true }
    );
    mp = addProjectScheme(mp, { id: "empty", title: "E", url: "", mimeType: "image/png" });
    const rolled = rollbackEmptySchemeCard(mp, "empty");
    expect(rolled.removed).toBe(true);
    expect(listProjectSchemes(rolled.manualParams)).toHaveLength(1);
    expect(listProjectSchemes(rolled.manualParams)[0].id).toBe("keep");
  });

  it("title/input paste targets do not start upload (editable guard)", () => {
    expect(isEditablePasteTarget({ target: { tagName: "INPUT" } })).toBe(true);
    expect(isEditablePasteTarget({ target: { tagName: "TEXTAREA" } })).toBe(true);
    expect(isEditablePasteTarget({ target: { tagName: "DIV" } })).toBe(false);
  });

  it("schemeTitleFromPasteFile strips extension", () => {
    expect(schemeTitleFromPasteFile(pngFile("Скриншот 2026-07-21 15-12.png"))).toBe(
      "Скриншот 2026-07-21 15-12"
    );
  });

  it("ClientSchemesEditor wires pasteClipboardSchemeImage for paste path", () => {
    const src = fs.readFileSync(path.join(root, "src/components/ClientSchemesEditor.jsx"), "utf8");
    expect(src).toContain("pasteClipboardSchemeImage");
    expect(src).toContain('setUploading("paste")');
    expect(src).toMatch(/alert\(e\.message/);
  });
});
