/**
 * Pure business diff between two published release snapshots.
 * Match items by stable item id (not materialId alone).
 */
import { parseReleaseSnapshot, releaseSnapshotItems } from "./projectPublishedRelease.js";
import { publishedPlannedTotal } from "./publishedPurchaseTotals.js";
import { normalizeClientImageManifest } from "./clientImageManifest.js";
import { normalizePinnedFrameDrawings } from "./publishedAssetPin.js";
import { normalizeFarmPower } from "./farmPower.js";

function asParsed(raw) {
  if (!raw) return parseReleaseSnapshot([]);
  if (typeof raw === "string") {
    try {
      return parseReleaseSnapshot(JSON.parse(raw));
    } catch {
      return parseReleaseSnapshot([]);
    }
  }
  if (Array.isArray(raw)) return parseReleaseSnapshot(raw);
  return parseReleaseSnapshot(raw);
}

function metaOf(parsed) {
  const m = parsed?.projectMeta && typeof parsed.projectMeta === "object" ? parsed.projectMeta : {};
  return {
    name: String(m.name || ""),
    client: String(m.client || ""),
    city: String(m.city || ""),
    address: String(m.address || ""),
    currency: String(m.currency || "₽"),
    vat: !!m.vat,
    comment: String(m.comment || ""),
  };
}

function lineSum(it) {
  return Math.round((Number(it.qty) || 0) * (Number(it.price) || 0));
}

function itemSide(it) {
  return {
    id: String(it.id || ""),
    name: String(it.name || ""),
    qty: Number(it.qty) || 0,
    price: Number(it.price) || 0,
    sum: lineSum(it),
    link: String(it.link || ""),
    clientSection: String(it.clientSection || it.section || ""),
    clientSubsection: String(it.clientSubsection || ""),
    visibleToClient: it.visibleToClient !== false,
    materialId: String(it.materialId || ""),
  };
}

function imageKey(img) {
  return String(img?.id || img?.url || img?.assetPath || "");
}

function drawingKey(d) {
  return String(d?.targetKey || d?.stellageId || d?.moduleRackKey || d?.drawingId || d?.id || "");
}

/**
 * @param {object|string|array} snapshotA older or left
 * @param {object|string|array} snapshotB newer or right
 */
export function diffReleaseSnapshots(snapshotA, snapshotB) {
  const a = asParsed(snapshotA);
  const b = asParsed(snapshotB);
  const metaA = metaOf(a);
  const metaB = metaOf(b);

  const projectMeta = [];
  for (const key of ["name", "client", "city", "address", "currency", "vat", "comment"]) {
    if (metaA[key] !== metaB[key]) {
      projectMeta.push({
        field: key,
        label: {
          name: "Название проекта",
          client: "Клиент",
          city: "Город",
          address: "Адрес",
          currency: "Валюта",
          vat: "НДС",
          comment: "Комментарий",
        }[key],
        from: metaA[key],
        to: metaB[key],
      });
    }
  }

  const itemsA = new Map((a.items || []).map((it) => [String(it.id), itemSide(it)]));
  const itemsB = new Map((b.items || []).map((it) => [String(it.id), itemSide(it)]));
  const items = { added: [], removed: [], changed: [] };

  for (const [id, right] of itemsB) {
    if (!itemsA.has(id)) {
      items.added.push(right);
      continue;
    }
    const left = itemsA.get(id);
    const changes = [];
    if (left.qty !== right.qty) changes.push({ field: "qty", label: "Количество", from: left.qty, to: right.qty });
    if (left.price !== right.price) changes.push({ field: "price", label: "Цена", from: left.price, to: right.price });
    if (left.sum !== right.sum) changes.push({ field: "sum", label: "Сумма", from: left.sum, to: right.sum });
    if (left.name !== right.name) changes.push({ field: "name", label: "Название", from: left.name, to: right.name });
    if (left.link !== right.link) changes.push({ field: "link", label: "Ссылка", from: left.link, to: right.link });
    if (left.clientSection !== right.clientSection || left.clientSubsection !== right.clientSubsection) {
      changes.push({
        field: "section",
        label: "Раздел",
        from: [left.clientSection, left.clientSubsection].filter(Boolean).join(" / "),
        to: [right.clientSection, right.clientSubsection].filter(Boolean).join(" / "),
      });
    }
    if (left.visibleToClient !== right.visibleToClient) {
      changes.push({
        field: "visibility",
        label: "Видимость клиенту",
        from: left.visibleToClient,
        to: right.visibleToClient,
      });
    }
    if (changes.length) items.changed.push({ id, name: right.name || left.name, materialId: right.materialId, changes });
  }
  for (const [id, left] of itemsA) {
    if (!itemsB.has(id)) items.removed.push(left);
  }

  const totalA = publishedPlannedTotal(a.items || []);
  const totalB = publishedPlannedTotal(b.items || []);
  const delta = totalB - totalA;
  const totals = {
    from: totalA,
    to: totalB,
    delta,
    percent: totalA !== 0 ? Math.round((delta / totalA) * 1000) / 10 : null,
    currency: metaB.currency || metaA.currency || "₽",
  };

  const roomsA = a.coolingRooms || [];
  const roomsB = b.coolingRooms || [];
  const roomIdsA = new Set(roomsA.map((r) => String(r.id || r.name)));
  const roomIdsB = new Set(roomsB.map((r) => String(r.id || r.name)));
  const cooling = {
    roomsAdded: [...roomIdsB].filter((id) => !roomIdsA.has(id)),
    roomsRemoved: [...roomIdsA].filter((id) => !roomIdsB.has(id)),
    powerChanged: JSON.stringify(roomsA) !== JSON.stringify(roomsB),
  };

  const fpA = normalizeFarmPower(a.farmPower || {});
  const fpB = normalizeFarmPower(b.farmPower || {});
  const farmPower = {
    tariffChanged: Number(fpA.tariffPerKwh) !== Number(fpB.tariffPerKwh),
    devicesChanged: JSON.stringify(fpA.devices || []) !== JSON.stringify(fpB.devices || []),
    costChanged:
      Number(fpA.monthlyCost || fpA.costPerMonth || 0) !== Number(fpB.monthlyCost || fpB.costPerMonth || 0),
    from: { tariffPerKwh: fpA.tariffPerKwh, deviceCount: (fpA.devices || []).length },
    to: { tariffPerKwh: fpB.tariffPerKwh, deviceCount: (fpB.devices || []).length },
  };

  const imgA = normalizeClientImageManifest(a.imageManifest || { projectSchemes: [], rackImages: [] });
  const imgB = normalizeClientImageManifest(b.imageManifest || { projectSchemes: [], rackImages: [] });
  const allA = [...(imgA.projectSchemes || []), ...(imgA.rackImages || [])];
  const allB = [...(imgB.projectSchemes || []), ...(imgB.rackImages || [])];
  const mapA = new Map(allA.map((img) => [imageKey(img), img]));
  const mapB = new Map(allB.map((img) => [imageKey(img), img]));
  const images = { added: [], removed: [], changed: [] };
  for (const [key, right] of mapB) {
    if (!key) continue;
    if (!mapA.has(key)) {
      images.added.push({ id: key, title: right.title || "", url: right.url || "" });
      continue;
    }
    const left = mapA.get(key);
    const changes = [];
    if (String(left.title || "") !== String(right.title || "")) {
      changes.push({ field: "title", from: left.title || "", to: right.title || "" });
    }
    if (Number(left.order) !== Number(right.order)) {
      changes.push({ field: "order", from: left.order, to: right.order });
    }
    if (String(left.contentHash || "") !== String(right.contentHash || "") || String(left.url || "") !== String(right.url || "")) {
      changes.push({
        field: "binary",
        label: "Файл",
        from: left.contentHash || left.url || "",
        to: right.contentHash || right.url || "",
      });
    }
    if (changes.length) images.changed.push({ id: key, title: right.title || left.title || "", changes });
  }
  for (const [key, left] of mapA) {
    if (!key) continue;
    if (!mapB.has(key)) images.removed.push({ id: key, title: left.title || "", url: left.url || "" });
  }

  const pinsA = normalizePinnedFrameDrawings(a.pinnedFrameDrawings || []);
  const pinsB = normalizePinnedFrameDrawings(b.pinnedFrameDrawings || []);
  const pinMapA = new Map(pinsA.map((d) => [drawingKey(d), d]));
  const pinMapB = new Map(pinsB.map((d) => [drawingKey(d), d]));
  const drawings = { added: [], removed: [], replaced: [] };
  for (const [key, right] of pinMapB) {
    if (!pinMapA.has(key)) {
      drawings.added.push({
        targetKey: key,
        drawingId: right.drawingId,
        drawingVersion: right.drawingVersion,
        title: right.title || "",
      });
      continue;
    }
    const left = pinMapA.get(key);
    if (
      String(left.drawingId) !== String(right.drawingId) ||
      String(left.drawingVersion) !== String(right.drawingVersion) ||
      String(left.contentHash || "") !== String(right.contentHash || "")
    ) {
      drawings.replaced.push({
        targetKey: key,
        from: { drawingId: left.drawingId, drawingVersion: left.drawingVersion, contentHash: left.contentHash || "" },
        to: { drawingId: right.drawingId, drawingVersion: right.drawingVersion, contentHash: right.contentHash || "" },
        title: right.title || left.title || "",
      });
    }
  }
  for (const [key, left] of pinMapA) {
    if (!pinMapB.has(key)) {
      drawings.removed.push({
        targetKey: key,
        drawingId: left.drawingId,
        drawingVersion: left.drawingVersion,
        title: left.title || "",
      });
    }
  }

  const hasChanges =
    projectMeta.length > 0 ||
    items.added.length > 0 ||
    items.removed.length > 0 ||
    items.changed.length > 0 ||
    delta !== 0 ||
    cooling.roomsAdded.length > 0 ||
    cooling.roomsRemoved.length > 0 ||
    cooling.powerChanged ||
    farmPower.tariffChanged ||
    farmPower.devicesChanged ||
    farmPower.costChanged ||
    images.added.length > 0 ||
    images.removed.length > 0 ||
    images.changed.length > 0 ||
    drawings.added.length > 0 ||
    drawings.removed.length > 0 ||
    drawings.replaced.length > 0;

  return {
    hasChanges,
    projectMeta,
    items,
    totals,
    cooling,
    farmPower,
    images,
    drawings,
    schema: { from: a.schema || null, to: b.schema || null },
  };
}

/** Human-readable one-line summary from a stored compareVersions summary + optional diff. */
export function formatReleaseSummaryText(summary = {}, currency = "₽") {
  const parts = [];
  const added = Number(summary.added) || 0;
  const removed = Number(summary.removed) || 0;
  const changed = Number(summary.changed) || 0;
  if (changed) parts.push(`изменено ${changed} ${pluralPos(changed)}`);
  if (added) parts.push(`добавлено ${added}`);
  if (removed) parts.push(`удалено ${removed}`);
  const delta = Number(summary.delta);
  if (Number.isFinite(delta) && delta !== 0) {
    const sign = delta > 0 ? "выросла" : "снизилась";
    parts.push(`сумма ${sign} на ${Math.abs(Math.round(delta)).toLocaleString("ru-RU")} ${currency}`);
  }
  if (!parts.length) return "Публикация без изменений позиций";
  return parts.join(", ").replace(/^./, (c) => c.toUpperCase());
}

function pluralPos(n) {
  const m = Math.abs(n) % 100;
  const m1 = m % 10;
  if (m > 10 && m < 20) return "позиций";
  if (m1 === 1) return "позиция";
  if (m1 >= 2 && m1 <= 4) return "позиции";
  return "позиций";
}

export function snapshotItemCount(snapshot) {
  return releaseSnapshotItems(snapshot).length;
}
