import { clientPurchaseDashboard } from "../../shared/clientPurchaseStats.js";
import { actualCoolingFromRoom, roomAcRecommendedKw } from "../../shared/roomAcSpec.js";

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function safePct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** @returns {{ status: "none"|"active"|"expired", label: string, expiresAt: string|null }} */
export function resolveLinkStatus(project) {
  const token = project?.clientToken;
  if (!token) {
    return { status: "none", label: "Не создана", expiresAt: null };
  }
  const expiresAt = project?.clientTokenExpiresAt || null;
  if (!expiresAt) {
    return { status: "active", label: "Активна", expiresAt: null };
  }
  const expMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expMs)) {
    return { status: "active", label: "Активна", expiresAt: expiresAt || null };
  }
  if (expMs < Date.now()) {
    return { status: "expired", label: "Истекла", expiresAt };
  }
  return { status: "active", label: "Активна", expiresAt };
}

function roomHasCoolingSnapshot(room) {
  return toNum(room?.cooling?.recommendedKw) > 0 || !!room?.cooling?.appliedAt;
}

/** @returns {{ totalRooms: number, roomsWithCooling: number, roomsWithoutCooling: number, roomsUnderpowered: number, status: "ok"|"warning"|"missing", label: string }} */
export function summarizeCoolingRooms(project) {
  const rooms = project?.rooms || [];
  const missing = {
    totalRooms: 0,
    roomsWithCooling: 0,
    roomsWithoutCooling: 0,
    roomsUnderpowered: 0,
    status: "missing",
    label: "Охлаждение не рассчитано",
  };

  if (!rooms.length) return missing;

  let roomsWithCooling = 0;
  let roomsWithoutCooling = 0;
  let roomsUnderpowered = 0;

  for (const room of rooms) {
    const recommended = roomAcRecommendedKw(room);
    const actual = actualCoolingFromRoom(room);

    if (!roomHasCoolingSnapshot(room)) {
      roomsWithoutCooling += 1;
      continue;
    }

    roomsWithCooling += 1;
    if (recommended > 0 && actual + 0.001 < recommended) {
      roomsUnderpowered += 1;
    }
  }

  const totalRooms = rooms.length;
  let status = "ok";
  let label = "Охлаждение рассчитано";

  if (roomsWithCooling === 0) {
    status = "missing";
    label = "Охлаждение не рассчитано";
  } else if (roomsUnderpowered > 0) {
    status = "warning";
    label = "Есть недобор холода";
  } else if (roomsWithoutCooling > 0) {
    status = "warning";
    label = "Охлаждение не рассчитано";
  }

  return {
    totalRooms,
    roomsWithCooling,
    roomsWithoutCooling,
    roomsUnderpowered,
    status,
    label,
  };
}

const PUBLISH_LABELS = {
  ok: "Можно отправлять",
  warnings: "Нужна проверка",
  blocked: "Есть критичные проблемы",
};

/** @param {{ project?: object, items?: object[], publishCheck?: object }} params */
export function buildHqMetrics({ project, items, publishCheck }) {
  const list = items || project?.items || [];
  const readinessPercent = safePct(
    publishCheck?.readiness?.readinessPercent ?? publishCheck?.counts?.readinessPercent
  );
  const publishStatus = publishCheck?.status || "blocked";
  const criticalCount = toNum(publishCheck?.counts?.criticalCount);
  const warningsCount = toNum(publishCheck?.counts?.warningCount);
  const publishProblemsCount = toNum(
    publishCheck?.counts?.issueCount ?? publishCheck?.problems?.length
  );
  const replacementsCount = list.filter((it) => it?.status === "replacement_check").length;
  const linkStatus = resolveLinkStatus(project || {});
  const coolingSummary = summarizeCoolingRooms(project || {});
  const version = toNum(project?.version) || 0;
  const versionLabel = version > 0 ? `v${version}` : "v0";

  const dash = clientPurchaseDashboard(list);
  const purchaseProgress = {
    ordered: dash.orderedCount,
    bought: dash.boughtCount,
    total: dash.totalCount,
    label:
      dash.totalCount > 0
        ? `${dash.orderedCount} заказано / ${dash.boughtCount} куплено`
        : "Не начата",
    show: dash.totalCount > 0,
  };

  return {
    readinessPercent,
    publishStatus,
    publishStatusLabel: publishCheck?.statusLabel || PUBLISH_LABELS[publishStatus] || PUBLISH_LABELS.blocked,
    publishProblemsCount,
    criticalCount,
    warningsCount,
    replacementsCount,
    linkStatus,
    coolingSummary,
    versionLabel,
    purchaseProgress,
  };
}
