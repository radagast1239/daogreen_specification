import React, { useEffect, useState } from "react";
import { api, photoSrc } from "../lib/api.js";
import { money } from "../store/helpers.js";
import { publishedPlannedTotal } from "../../shared/publishedPurchaseTotals.js";

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

/**
 * Read-only modal approximating the client view for a historical release.
 * No write controls — purchase/cooling/status edits are not rendered.
 */
export default function HistoricalReleasePreviewModal({ projectId, versionId, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const preview = await api.getVersionClientPreview(projectId, versionId);
        if (!cancelled) setData(preview);
      } catch (e) {
        if (!cancelled) setError(e.message || "Не удалось открыть версию");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, versionId]);

  const project = data?.project;
  const warnings = project?.historicalCompatibility?.warnings || [];
  const schemes = project?.clientImages?.projectSchemes || [];
  const racks = project?.clientImages?.rackImages || [];
  const drawings = project?.pinnedFrameDrawings || [];
  const total = publishedPlannedTotal(project?.items || []);

  return (
    <div
      className="modal-backdrop"
      data-testid="historical-preview-modal"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 80,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "24px 12px",
        overflow: "auto",
      }}
      onClick={onClose}
    >
      <div
        className="card"
        role="dialog"
        aria-modal="true"
        aria-label="Историческая версия"
        style={{ width: "min(920px, 100%)", maxWidth: 920, padding: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "12px 16px",
            background: "var(--warn-bg, #fff8e6)",
            borderBottom: "1px solid var(--line)",
          }}
          data-testid="historical-banner"
        >
          <strong>
            Историческая версия №{data?.versionNumber || "…"} от {formatWhen(data?.publishedAt)}. Только просмотр.
          </strong>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            Рабочий проект и текущая клиентская ссылка не изменяются. Брендинг страницы — текущий глобальный.
          </p>
        </div>

        <div style={{ padding: 16 }}>
          <div className="row" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
            <button type="button" className="btn btn-sm" onClick={onClose}>
              Закрыть
            </button>
          </div>

          {loading && <p className="muted">Загрузка…</p>}
          {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

          {!loading && project && (
            <div data-testid="historical-preview-body">
              {warnings.map((w) => (
                <div
                  key={w.code}
                  className="card"
                  data-testid={`legacy-warning-${w.code}`}
                  style={{ marginBottom: 12, borderColor: "var(--warn)", padding: "10px 12px" }}
                >
                  {w.message}
                </div>
              ))}

              <h2 style={{ margin: "0 0 4px" }}>{project.name || "—"}</h2>
              <p className="muted" style={{ margin: "0 0 14px" }}>
                {[project.client, project.city, project.address].filter(Boolean).join(" · ") || "—"}
                {" · "}
                {project.currency || "₽"}
                {project.vat ? " · с НДС" : " · без НДС"}
              </p>

              <div className="stat-grid" style={{ marginBottom: 16 }}>
                <div className="card stat">
                  <div className="k">Сумма версии</div>
                  <div className="v num">{money(total, project.currency)}</div>
                </div>
                <div className="card stat">
                  <div className="k">Позиций</div>
                  <div className="v num">{(project.items || []).length}</div>
                </div>
              </div>

              <h3 style={{ fontSize: 15, margin: "0 0 8px" }}>Позиции</h3>
              <div style={{ overflowX: "auto", marginBottom: 18 }}>
                <table className="table" style={{ width: "100%", fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th>Название</th>
                      <th>Кол-во</th>
                      <th>Цена</th>
                      <th>Статус в версии</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(project.items || []).map((it) => (
                      <tr key={it.id}>
                        <td>{it.name}</td>
                        <td className="num">{it.qty}</td>
                        <td className="num">{money(it.price, project.currency)}</td>
                        <td>{it.statusLabel || it.status || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {(project.rooms || []).length > 0 && (
                <>
                  <h3 style={{ fontSize: 15, margin: "0 0 8px" }}>Охлаждение</h3>
                  <ul style={{ marginTop: 0 }}>
                    {project.rooms.map((r) => (
                      <li key={r.id || r.name}>
                        {r.name || "Комната"}
                        {r.cooling?.recommendedKw != null ? ` · ${r.cooling.recommendedKw} кВт` : ""}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {(project.farmPower?.devices || []).length > 0 && (
                <>
                  <h3 style={{ fontSize: 15, margin: "0 0 8px" }}>Электропотребление</h3>
                  <p className="muted" style={{ fontSize: 13 }}>
                    Устройств: {(project.farmPower.devices || []).length}
                    {project.farmPower.tariffPerKwh != null
                      ? ` · тариф ${project.farmPower.tariffPerKwh}`
                      : ""}
                  </p>
                </>
              )}

              {schemes.length > 0 && (
                <>
                  <h3 style={{ fontSize: 15, margin: "0 0 8px" }}>Схемы</h3>
                  <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
                    {schemes.map((img) => (
                      <a key={img.id || img.url} href={photoSrc(img.url)} target="_blank" rel="noreferrer">
                        {img.title || img.url}
                      </a>
                    ))}
                  </div>
                </>
              )}

              {racks.length > 0 && (
                <>
                  <h3 style={{ fontSize: 15, margin: "0 0 8px" }}>Изображения стеллажей</h3>
                  <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
                    {racks.map((img) => (
                      <a key={img.id || img.url} href={photoSrc(img.url)} target="_blank" rel="noreferrer">
                        {img.title || img.url}
                      </a>
                    ))}
                  </div>
                </>
              )}

              <h3 style={{ fontSize: 15, margin: "0 0 8px" }}>Чертежи каркаса</h3>
              {drawings.length === 0 ? (
                <p className="muted" data-testid="historical-drawings-empty">
                  {warnings.some((w) => w.code === "FRAME_DRAWINGS_NOT_PINNED")
                    ? "Для этой старой публикации чертёж не был закреплён по версии."
                    : "В этой версии нет закреплённых чертежей."}
                </p>
              ) : (
                <ul>
                  {drawings.map((d) => (
                    <li key={d.drawingId || d.url}>
                      <a href={photoSrc(d.url || d.pdfUrl)} target="_blank" rel="noreferrer">
                        {d.title || d.drawingId}
                      </a>
                      {d.drawingVersion != null ? ` · v${d.drawingVersion}` : ""}
                    </li>
                  ))}
                </ul>
              )}

              {/* Explicit: no write controls in historical preview */}
              <div data-testid="historical-readonly-marker" style={{ display: "none" }} aria-hidden="true">
                readOnly
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
