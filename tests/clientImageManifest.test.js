import { describe, expect, it } from "vitest";
import { buildClientImageManifest } from "../shared/clientImageManifest.js";
import { buildReleaseSnapshotPayload, detectUnpublishedChanges, parseReleaseSnapshot } from "../shared/projectPublishedRelease.js";
import { buildClientProjectFromRelease } from "../backend/src/services/publishedReleaseService.js";

function project() {
  return {
    id: "p1", name: "P", manualParams: {
      secretAdminNote: "never-client",
      projectSchemes: [
        { id: "public", title: "Трубы", url: "/uploads/pipes.png", mimeType: "image/png", sortOrder: 1, clientVisible: true },
        { id: "hidden", title: "Черновик", url: "/uploads/draft.png", sortOrder: 0, clientVisible: false },
      ],
    },
    stellageConfigs: [
      { id: "rack-a", name: "Стеллаж A", extraImages: [
        { id: "a1", title: "Свет", url: "/uploads/a1.jpg", mimeType: "image/jpeg", clientVisible: true, sortOrder: 0 },
        { id: "a-hidden", title: "Внутреннее", url: "/uploads/a2.jpg", clientVisible: false, sortOrder: 1 },
      ] },
      { id: "rack-b", name: "Стеллаж B", extraImages: [
        { id: "b1", title: "Капельницы", url: "https://cdn.example/b.webp", mimeType: "image/webp", clientVisible: true, sortOrder: 0 },
      ] },
    ],
    items: [],
  };
}

describe("unified client image manifest", () => {
  it("whitelists visible images and keeps stable rack isolation", () => {
    const manifest = buildClientImageManifest(project());
    expect(manifest.projectSchemes.map((x) => x.id)).toEqual(["public"]);
    expect(manifest.rackImages.map((x) => [x.id, x.rackId])).toEqual([["a1", "rack-a"], ["b1", "rack-b"]]);
    expect(JSON.stringify(manifest)).not.toContain("secretAdminNote");
  });

  it("freezes images in release and does not expose live manualParams", () => {
    const draft = project();
    const frozen = buildReleaseSnapshotPayload(draft);
    draft.manualParams.projectSchemes[0].title = "Новое live имя";
    draft.stellageConfigs[0].extraImages = [];
    const parsed = parseReleaseSnapshot(frozen);
    expect(parsed.imageManifest.projectSchemes[0].title).toBe("Трубы");
    expect(parsed.imageManifest.rackImages.map((x) => x.id)).toContain("a1");
    const dto = buildClientProjectFromRelease(draft, parsed, { overlayLive: false });
    expect(dto.manualParams).toBeUndefined();
    expect(dto.stellageConfigs).toBeUndefined();
    expect(dto.stellageCounts).toEqual([
      { id: "rack-a", name: "Стеллаж A", moduleName: "", count: 1 },
      { id: "rack-b", name: "Стеллаж B", moduleName: "", count: 1 },
    ]);
    expect(dto.clientImages.projectSchemes[0].title).toBe("Трубы");
  });

  it("marks client-visible manifest changes as unpublished, but ignores internal additions", () => {
    const draft = project();
    const published = buildClientImageManifest(draft);
    draft.manualParams.projectSchemes.push({ id: "internal", title: "I", url: "/uploads/i.png", clientVisible: false });
    expect(detectUnpublishedChanges([], [], buildClientImageManifest(draft), published).hasChanges).toBe(false);
    draft.manualParams.projectSchemes[0].title = "Переименовано";
    const diff = detectUnpublishedChanges([], [], buildClientImageManifest(draft), published);
    expect(diff.hasChanges).toBe(true);
    expect(diff.imagesChanged).toBe(true);
  });

  it("treats unsafe and missing-visibility canonical images as internal", () => {
    const draft = project();
    draft.manualParams.projectSchemes = [
      { id: "legacy", title: "No flag", url: "/uploads/legacy.png" },
      { id: "bad", title: "Bad", url: "file:///server/private.png", clientVisible: true },
    ];
    expect(buildClientImageManifest(draft).projectSchemes).toEqual([]);
  });
});
