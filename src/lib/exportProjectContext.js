/**
 * Draft vs published export project builders.
 * Published exports must be release-backed — never mix live meta with snapshot items.
 */

import { projectForClientPdfExport, projectForClientExcelExport } from "./clientExportProject.js";

function pickPublishedMeta(project = {}, snapshotParsed = null) {
  const fromDto = project.publishedSnapshotMeta;
  if (fromDto && typeof fromDto === "object") return fromDto;
  const fromParsed = snapshotParsed?.projectMeta;
  if (fromParsed && typeof fromParsed === "object") return fromParsed;
  return null;
}

function pickPublishedItems(project = {}, snapshotParsed = null) {
  if (Array.isArray(project.publishedSnapshotItems) && project.publishedSnapshotItems.length) {
    return project.publishedSnapshotItems;
  }
  if (Array.isArray(snapshotParsed?.items)) return snapshotParsed.items;
  return [];
}

function pickPublishedStellageCounts(project = {}, snapshotParsed = null, meta = null) {
  if (Array.isArray(project.publishedStellageCounts) && project.publishedStellageCounts.length) {
    return project.publishedStellageCounts;
  }
  if (Array.isArray(snapshotParsed?.stellageCounts) && snapshotParsed.stellageCounts.length) {
    return snapshotParsed.stellageCounts;
  }
  if (Array.isArray(meta?.stellageCounts)) return meta.stellageCounts;
  return [];
}

function pickPublishedDocuments(project = {}, snapshotParsed = null) {
  if (Array.isArray(project.publishedDocumentManifest)) return project.publishedDocumentManifest;
  if (Array.isArray(snapshotParsed?.documentManifest)) return snapshotParsed.documentManifest;
  return [];
}

/**
 * Working DTO for admin internal / draft client exports.
 * @param {object} project
 */
export function buildDraftExportProject(project = {}) {
  const name = project?.name || "";
  return {
    ...project,
    exportKind: "draft",
    exportTitleSuffix: "рабочая версия",
    name,
    displayName: name ? `${name} (рабочая версия)` : "рабочая версия",
  };
}

/**
 * Release-backed export DTO — no live name/currency/client/materials mix.
 * @param {object} project — admin project with release info fields
 * @param {object|null} [snapshotParsed] — optional parseReleaseSnapshot result
 */
export function buildPublishedExportProject(project = {}, snapshotParsed = null) {
  const meta = pickPublishedMeta(project, snapshotParsed) || {};
  const items = pickPublishedItems(project, snapshotParsed);
  const stellageCounts = pickPublishedStellageCounts(project, snapshotParsed, meta);
  const documentManifest = pickPublishedDocuments(project, snapshotParsed);
  const versionNumber =
    Number(project?.publishedRelease?.versionNumber) ||
    Number(meta.versionNumber) ||
    0;

  return {
    id: meta.id || project.id || "",
    name: meta.name || "",
    client: meta.client || "",
    city: meta.city || "",
    currency: meta.currency || "₽",
    vat: !!meta.vat,
    comment: meta.comment || "",
    items,
    stellageCounts,
    stellageConfigs: stellageCounts,
    documentManifest,
    documents: documentManifest,
    version: versionNumber,
    publishedRelease: project.publishedRelease || null,
    clientToken: project.clientToken || "",
    exportKind: "published",
    exportTitleSuffix: versionNumber > 0 ? `опубликованная v${versionNumber}` : "опубликованная",
    displayName:
      versionNumber > 0
        ? `${meta.name || project.name || ""} (опубликованная v${versionNumber})`.trim()
        : `${meta.name || project.name || ""} (опубликованная)`.trim(),
  };
}

/**
 * Choose draft or published builder for client PDF/Excel from admin.
 */
export function resolveAdminClientExportProject(project = {}) {
  if (project?.publishedRelease && (project.publishedSnapshotItems?.length || project.publishedSnapshotMeta)) {
    return buildPublishedExportProject(project);
  }
  return buildDraftExportProject(project);
}

export function projectForAdminClientPdfExport(project = {}) {
  return projectForClientPdfExport(resolveAdminClientExportProject(project));
}

export function projectForAdminClientExcelExport(project = {}) {
  return projectForClientExcelExport(resolveAdminClientExportProject(project));
}

export { projectForClientPdfExport, projectForClientExcelExport };
