/**
 * Client/publish selection for frame drawings:
 * - one latest doc per stable target
 * - drop drawings bound to deleted (inactive) stellages
 * - overlay current stellage names onto drawingTitle
 */

export function activeStellageIdSet(stellageConfigs = []) {
  return new Set(
    (Array.isArray(stellageConfigs) ? stellageConfigs : [])
      .map((s) => String(s?.id || "").trim())
      .filter(Boolean),
  );
}

export function stellageNameById(stellageConfigs = []) {
  const map = new Map();
  for (const s of Array.isArray(stellageConfigs) ? stellageConfigs : []) {
    const id = String(s?.id || "").trim();
    if (!id) continue;
    const name = String(s.name || s.moduleName || "").trim();
    if (name) map.set(id, name);
  }
  return map;
}

/**
 * Stable target key. Prefer stellageId so moduleRackKey presence/absence
 * cannot split one rack into two "latest" slots.
 */
export function frameDrawingClientTargetKey(doc = {}) {
  const stellageId = String(doc.stellageId || doc.stellage_id || "").trim();
  if (stellageId) return `stellage:${stellageId}`;
  const moduleRackKey = String(doc.moduleRackKey || doc.module_rack_key || "").trim();
  if (moduleRackKey) return `moduleRack:${moduleRackKey}`;
  const presetId = String(doc.presetId || doc.preset_id || "").trim();
  if (presetId) return `preset:${presetId}`;
  const drawingId = String(doc.drawingId || doc.id || "").trim();
  return drawingId ? `drawing:${drawingId}` : "";
}

export function isFrameDrawingBoundToActiveStellage(doc = {}, activeStellageIds) {
  const stellageId = String(doc.stellageId || doc.stellage_id || "").trim();
  if (!stellageId) return true;
  // Unknown/empty active set → keep (legacy projects without stellage_configs).
  if (!(activeStellageIds instanceof Set) || activeStellageIds.size === 0) return true;
  return activeStellageIds.has(stellageId);
}

function drawingVersionOf(doc = {}) {
  return Number(doc.drawingVersion ?? doc.version ?? 0) || 0;
}

function drawingTimeOf(doc = {}) {
  return new Date(doc.uploadedAt || doc.createdAt || 0).getTime() || 0;
}

/**
 * Keep only latest visible frame drawing per target; optionally drop orphan stellages.
 * @param {object[]} frameDocs frame_drawing rows only
 * @param {{ activeStellageIds?: Set<string> }} [options]
 */
export function selectLatestFrameDocuments(frameDocs = [], options = {}) {
  const activeStellageIds = options.activeStellageIds;
  const latestByTarget = new Map();
  for (const document of frameDocs || []) {
    if (!document) continue;
    if (!isFrameDrawingBoundToActiveStellage(document, activeStellageIds)) continue;
    const targetKey = frameDrawingClientTargetKey(document);
    if (!targetKey) continue;
    const current = latestByTarget.get(targetKey);
    if (!current) {
      latestByTarget.set(targetKey, document);
      continue;
    }
    const candidateVersion = drawingVersionOf(document);
    const currentVersion = drawingVersionOf(current);
    if (candidateVersion > currentVersion) {
      latestByTarget.set(targetKey, document);
      continue;
    }
    if (candidateVersion === currentVersion && drawingTimeOf(document) > drawingTimeOf(current)) {
      latestByTarget.set(targetKey, document);
    }
  }
  return [...latestByTarget.values()];
}

/**
 * Rewrite drawingTitle from current stellageConfigs names.
 * @param {object[]} documents
 * @param {object[]} stellageConfigs
 */
export function applyStellageNamesToFrameDocuments(documents = [], stellageConfigs = []) {
  const names = stellageNameById(stellageConfigs);
  if (!names.size) return Array.isArray(documents) ? [...documents] : [];
  return (documents || []).map((d) => {
    if (!d || d.type !== "frame_drawing") return d;
    const sid = String(d.stellageId || d.stellage_id || "").trim();
    if (!sid || !names.has(sid)) return d;
    const name = names.get(sid);
    if (String(d.drawingTitle || "") === name) return d;
    return { ...d, drawingTitle: name };
  });
}

/**
 * Filter mixed project documents list: non-frame untouched; frames reduced to latest/active.
 * Optionally overlay current stellage names.
 * @param {object[]} documents
 * @param {{ activeStellageIds?: Set<string>, stellageConfigs?: object[] }} [options]
 */
export function filterClientProjectDocuments(documents = [], options = {}) {
  const list = Array.isArray(documents) ? documents : [];
  const frames = list.filter((d) => d?.type === "frame_drawing");
  if (!frames.length) {
    return options.stellageConfigs
      ? applyStellageNamesToFrameDocuments(list, options.stellageConfigs)
      : [...list];
  }
  const latest = selectLatestFrameDocuments(frames, options);
  const keep = new Set(latest.map((d) => d.id || d.fileId || d.drawingId).filter(Boolean));
  const filtered = list.filter((d) => {
    if (d?.type !== "frame_drawing") return true;
    const id = d.id || d.fileId || d.drawingId;
    return id && keep.has(id);
  });
  if (options.stellageConfigs) {
    return applyStellageNamesToFrameDocuments(filtered, options.stellageConfigs);
  }
  return filtered;
}

/**
 * Build client-facing documents: keep non-frame from published manifest,
 * replace frame drawings with live latest+active named list.
 */
export function mergeLiveFrameDocumentsForClient(pinnedDocuments = [], liveDocuments = []) {
  const pinned = Array.isArray(pinnedDocuments) ? pinnedDocuments : [];
  const live = Array.isArray(liveDocuments) ? liveDocuments : [];
  const nonFrame = pinned.filter((d) => d?.type !== "frame_drawing");
  const liveFrames = live.filter((d) => d?.type === "frame_drawing");
  return [...nonFrame, ...liveFrames];
}
