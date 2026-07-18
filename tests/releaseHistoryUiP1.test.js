/**
 * Lightweight UI contract tests for release history (no browser).
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("release history UI contracts", () => {
  it("SpecEditor includes history panel", () => {
    const src = read("src/pages/admin/SpecEditorPage.jsx");
    expect(src).toContain("ProjectReleaseHistory");
    expect(src).toContain("История публикаций");
  });

  it("history panel exposes version cards and actions", () => {
    const src = read("src/components/ProjectReleaseHistory.jsx");
    expect(src).toContain("project-release-history");
    expect(src).toContain("Открыть версию");
    expect(src).toContain("Сравнить");
    expect(src).toContain("Скачать PDF");
    expect(src).toContain("Скачать Excel");
    expect(src).toContain("getVersionPdfData");
    expect(src).toContain("downloadVersionExcel");
    expect(src).not.toContain("Восстановить версию");
    expect(src).not.toContain("Сделать текущей");
  });

  it("historical preview is read-only and shows banner + legacy warning hooks", () => {
    const src = read("src/components/HistoricalReleasePreviewModal.jsx");
    expect(src).toContain("historical-banner");
    expect(src).toContain("Только просмотр");
    expect(src).toContain("historical-readonly-marker");
    expect(src).toContain("FRAME_DRAWINGS_NOT_PINNED");
    expect(src).not.toContain("patchClientItem");
    expect(src).not.toContain("bulkPatch");
    expect(src).not.toContain("createVersion");
  });

  it("compare modal defaults to previous version wiring", () => {
    const hist = read("src/components/ProjectReleaseHistory.jsx");
    expect(hist).toContain("versions[idx + 1]");
    const cmp = read("src/components/ReleaseVersionCompareModal.jsx");
    expect(cmp).toContain("getVersionDiff");
    expect(cmp).toContain("release-diff-body");
  });
});
