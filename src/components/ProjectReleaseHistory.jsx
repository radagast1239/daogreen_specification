import React, { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { money } from "../store/helpers.js";
import HistoricalReleasePreviewModal from "./HistoricalReleasePreviewModal.jsx";
import ReleaseVersionCompareModal from "./ReleaseVersionCompareModal.jsx";
import { generateClientPurchasePdf } from "../lib/clientPdfExport.js";
import { projectForClientPdfExport } from "../lib/clientExportProject.js";

function formatWhen(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function badgeLabel(v) {
  if (v.isCurrentPublished || v.badge === "current") return "Сейчас у клиента";
  if (v.isLegacy || v.badge === "legacy") return "Старая версия";
  return "Историческая версия";
}

function badgeClass(v) {
  if (v.isCurrentPublished || v.badge === "current") return "chip chip--green";
  if (v.isLegacy || v.badge === "legacy") return "chip chip--amber";
  return "chip chip--neutral";
}

/**
 * Read-only publication history for a project (admin SpecEditor).
 */
export default function ProjectReleaseHistory({ projectId, currency = "₽" }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [previewVersionId, setPreviewVersionId] = useState(null);
  const [compare, setCompare] = useState(null); // { versionId, compareTo }
  const [busy, setBusy] = useState("");

  const reload = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError("");
    try {
      const list = await api.getVersions(projectId);
      setVersions(Array.isArray(list) ? list : []);
    } catch (e) {
      setError(e.message || "Не удалось загрузить историю");
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function downloadPdf(versionId) {
    setBusy(`pdf:${versionId}`);
    try {
      const data = await api.getVersionPdfData(projectId, versionId);
      const project = projectForClientPdfExport(data.project);
      await generateClientPurchasePdf({
        project,
        items: data.items || project.items || [],
        branding: data.branding || {},
        purchaseStatuses: [],
        mode: "client_full",
        versionInfo: { versionNumber: data.versionNumber, publishedAt: data.publishedAt },
      });
    } catch (e) {
      setError(e.message || "PDF не сформирован");
    } finally {
      setBusy("");
    }
  }

  async function downloadExcel(versionId) {
    setBusy(`xlsx:${versionId}`);
    try {
      await api.downloadVersionExcel(projectId, versionId);
    } catch (e) {
      setError(e.message || "Excel не скачан");
    } finally {
      setBusy("");
    }
  }

  function openCompare(v) {
    const idx = versions.findIndex((x) => x.id === v.id);
    const prev = versions[idx + 1]; // list is newest-first
    setCompare({
      versionId: v.id,
      compareTo: prev?.id || null,
      versionNumber: v.versionNumber,
      prevNumber: prev?.versionNumber || null,
    });
  }

  if (loading) {
    return <p className="muted" style={{ margin: 0 }}>Загрузка истории публикаций…</p>;
  }

  if (!versions.length) {
    return (
      <div>
        <p className="muted" style={{ margin: "0 0 8px" }}>
          Пока нет опубликованных версий. После «Утвердить версию» здесь появится история.
        </p>
        {error && <p style={{ color: "var(--danger)", margin: 0 }}>{error}</p>}
      </div>
    );
  }

  return (
    <div data-testid="project-release-history">
      {error && (
        <p style={{ color: "var(--danger)", marginBottom: 10 }} role="alert">
          {error}
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {versions.map((v) => (
          <div
            key={v.id}
            className="card"
            data-testid={`release-version-card-${v.versionNumber}`}
            style={{ padding: "12px 14px" }}
          >
            <div className="row wrap" style={{ gap: 8, alignItems: "center", marginBottom: 6 }}>
              <strong>Версия №{v.versionNumber}</strong>
              <span className={badgeClass(v)}>{badgeLabel(v)}</span>
              <span className="muted" style={{ fontSize: 13 }}>
                {formatWhen(v.createdAt)}
              </span>
              {v.createdBy ? (
                <span className="muted" style={{ fontSize: 13 }}>
                  · {v.createdBy}
                </span>
              ) : null}
            </div>
            <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
              {[v.clientName, v.projectName].filter(Boolean).join(" · ") || "—"}
              {v.workflowStatus ? ` · статус: ${v.workflowStatus}` : ""}
              {" · "}
              {money(v.plannedTotal, v.currency || currency)}
              {v.totalDelta != null && Number(v.totalDelta) !== 0 ? (
                <>
                  {" "}
                  <span data-testid={`release-total-delta-${v.versionNumber}`}>
                    ({Number(v.totalDelta) > 0 ? "+" : ""}
                    {money(v.totalDelta, v.currency || currency)})
                  </span>
                </>
              ) : null}
              {" · "}
              {v.itemCount} поз.
              {v.imageCount ? ` · схем: ${v.imageCount}` : ""}
              {v.drawingCount ? ` · чертежей: ${v.drawingCount}` : ""}
            </div>
            {v.releaseComment ? (
              <p
                data-testid={`release-comment-${v.versionNumber}`}
                style={{ margin: "0 0 8px", fontSize: 13, whiteSpace: "pre-wrap" }}
              >
                <strong>Комментарий:</strong> {v.releaseComment}
              </p>
            ) : null}
            {v.summaryText ? (
              <p
                data-testid={`release-auto-summary-${v.versionNumber}`}
                style={{ margin: "0 0 10px", fontSize: 13 }}
              >
                {v.summaryText}
              </p>
            ) : null}
            <div className="row wrap" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                data-testid={`open-version-${v.versionNumber}`}
                onClick={() => setPreviewVersionId(v.id)}
              >
                Открыть версию
              </button>
              <button
                type="button"
                className="btn btn-sm"
                data-testid={`compare-version-${v.versionNumber}`}
                onClick={() => openCompare(v)}
              >
                Сравнить
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy === `pdf:${v.id}`}
                data-testid={`pdf-version-${v.versionNumber}`}
                onClick={() => downloadPdf(v.id)}
              >
                Скачать PDF
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy === `xlsx:${v.id}`}
                data-testid={`excel-version-${v.versionNumber}`}
                onClick={() => downloadExcel(v.id)}
              >
                Скачать Excel
              </button>
            </div>
          </div>
        ))}
      </div>

      {previewVersionId && (
        <HistoricalReleasePreviewModal
          projectId={projectId}
          versionId={previewVersionId}
          onClose={() => setPreviewVersionId(null)}
        />
      )}
      {compare && (
        <ReleaseVersionCompareModal
          projectId={projectId}
          versionId={compare.versionId}
          compareTo={compare.compareTo}
          versionNumber={compare.versionNumber}
          prevNumber={compare.prevNumber}
          onClose={() => setCompare(null)}
        />
      )}
    </div>
  );
}
