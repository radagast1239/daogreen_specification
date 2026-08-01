import { describe, expect, it } from "vitest";
import {
  activeStellageIdSet,
  frameDrawingClientTargetKey,
  filterClientProjectDocuments,
  selectLatestFrameDocuments,
} from "../shared/clientFrameDocuments.js";
import * as clientFrameDocuments from "../shared/clientFrameDocuments.js";

describe("clientFrameDocuments helper", () => {
  it("unifies target key on stellageId even when moduleRackKey differs", () => {
    expect(
      frameDrawingClientTargetKey({
        stellageId: "st_a",
        moduleRackKey: "stellage:st_a",
        id: "f1",
      }),
    ).toBe("stellage:st_a");
    expect(
      frameDrawingClientTargetKey({
        stellageId: "st_a",
        moduleRackKey: "",
        id: "f2",
      }),
    ).toBe("stellage:st_a");
  });

  it("keeps only latest version when moduleRackKey presence splits old keys", () => {
    const docs = [
      {
        id: "old",
        type: "frame_drawing",
        stellageId: "st_a",
        moduleRackKey: null,
        drawingVersion: 1,
        uploadedAt: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "new",
        type: "frame_drawing",
        stellageId: "st_a",
        moduleRackKey: "stellage:st_a",
        drawingVersion: 2,
        uploadedAt: "2026-07-02T00:00:00.000Z",
      },
    ];
    const latest = selectLatestFrameDocuments(docs, {
      activeStellageIds: activeStellageIdSet([{ id: "st_a" }]),
    });
    expect(latest).toHaveLength(1);
    expect(latest[0].id).toBe("new");
  });

  it("drops orphan stellage drawings and keeps preset without stellageId", () => {
    const docs = [
      {
        id: "orphan",
        type: "frame_drawing",
        stellageId: "st_deleted",
        drawingVersion: 3,
      },
      {
        id: "preset",
        type: "frame_drawing",
        stellageId: "",
        presetId: "pr_1",
        drawingVersion: 1,
      },
      {
        id: "invoice",
        type: "pdf",
        filename: "inv.pdf",
      },
    ];
    const filtered = filterClientProjectDocuments(docs, {
      activeStellageIds: activeStellageIdSet([{ id: "st_live" }]),
    });
    expect(filtered.map((d) => d.id)).toEqual(["preset", "invoice"]);
  });

  it("overlays current stellage names onto frame drawingTitle", () => {
    const docs = [
      {
        id: "f1",
        type: "frame_drawing",
        stellageId: "st_a",
        drawingTitle: "Стеллаж 2",
        drawingVersion: 2,
      },
    ];
    const named = filterClientProjectDocuments(docs, {
      activeStellageIds: activeStellageIdSet([{ id: "st_a", name: "Основное отделение" }]),
      stellageConfigs: [{ id: "st_a", name: "Основное отделение" }],
    });
    expect(named[0].drawingTitle).toBe("Основное отделение");
  });

  // A published link must resolve documents from the release manifest alone.
  // Re-adding a live-merge helper here would reopen the immutability hole.
  it("exposes no helper that merges live frame drawings into a release", () => {
    expect(clientFrameDocuments.mergeLiveFrameDocumentsForClient).toBeUndefined();
  });
});
