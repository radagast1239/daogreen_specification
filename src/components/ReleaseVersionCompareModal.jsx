import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { money } from "../store/helpers.js";

/**
 * Business-language compare of two release snapshots.
 */
export default function ReleaseVersionCompareModal({
  projectId,
  versionId,
  compareTo,
  versionNumber,
  prevNumber,
  onClose,
}) {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await api.getVersionDiff(projectId, versionId, compareTo || undefined);
        if (!cancelled) setPayload(data);
      } catch (e) {
        if (!cancelled) setError(e.message || "Сравнение недоступно");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, versionId, compareTo]);

  const diff = payload?.diff;
  const aNum = payload?.versionA?.versionNumber ?? prevNumber;
  const bNum = payload?.versionB?.versionNumber ?? versionNumber;

  return (
    <div
      className="modal-backdrop"
      data-testid="release-compare-modal"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 85,
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
        style={{ width: "min(860px, 100%)", padding: 16 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <strong>
              Сравнение версий
              {aNum != null && bNum != null ? ` №${aNum} → №${bNum}` : ""}
            </strong>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
              Только просмотр. Рабочий проект не меняется.
            </p>
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Закрыть
          </button>
        </div>

        {loading && <p className="muted">Считаем различия…</p>}
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

        {!loading && (payload?.versionA || payload?.versionB) && (
          <div data-testid="release-compare-comments" style={{ marginBottom: 12, fontSize: 13 }}>
            {payload?.versionA?.releaseComment ? (
              <p style={{ margin: "0 0 6px", whiteSpace: "pre-wrap" }}>
                <strong>Комментарий версии {aNum != null ? `№${aNum}` : "A"}:</strong>{" "}
                {payload.versionA.releaseComment}
              </p>
            ) : null}
            {payload?.versionB?.releaseComment ? (
              <p style={{ margin: "0 0 6px", whiteSpace: "pre-wrap" }}>
                <strong>Комментарий версии {bNum != null ? `№${bNum}` : "B"}:</strong>{" "}
                {payload.versionB.releaseComment}
              </p>
            ) : null}
          </div>
        )}

        {!loading && diff?.empty && (
          <p className="muted">{diff.message || "Нет предыдущей версии для сравнения"}</p>
        )}

        {!loading && diff && !diff.empty && (
          <div data-testid="release-diff-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {diff.projectMeta?.length > 0 && (
              <section>
                <h3 style={{ fontSize: 14, margin: "0 0 6px" }}>Данные проекта</h3>
                <ul style={{ margin: 0 }}>
                  {diff.projectMeta.map((c) => (
                    <li key={c.field}>
                      <b>{c.label}</b>: {String(c.from)} → {String(c.to)}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {diff.totals && (
              <section>
                <h3 style={{ fontSize: 14, margin: "0 0 6px" }}>Сумма</h3>
                <p style={{ margin: 0 }}>
                  {money(diff.totals.from, diff.totals.currency)} → {money(diff.totals.to, diff.totals.currency)}
                  {diff.totals.delta !== 0 && (
                    <>
                      {" "}
                      ({diff.totals.delta > 0 ? "+" : ""}
                      {money(diff.totals.delta, diff.totals.currency)}
                      {diff.totals.percent != null ? `, ${diff.totals.percent}%` : ""})
                    </>
                  )}
                </p>
              </section>
            )}

            {(diff.items?.added?.length > 0 ||
              diff.items?.removed?.length > 0 ||
              diff.items?.changed?.length > 0) && (
              <section>
                <h3 style={{ fontSize: 14, margin: "0 0 6px" }}>Позиции</h3>
                {diff.items.added?.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div className="muted">Добавлено</div>
                    <ul>
                      {diff.items.added.map((it) => (
                        <li key={it.id}>{it.name} (×{it.qty})</li>
                      ))}
                    </ul>
                  </div>
                )}
                {diff.items.removed?.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div className="muted">Удалено</div>
                    <ul>
                      {diff.items.removed.map((it) => (
                        <li key={it.id}>{it.name}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {diff.items.changed?.length > 0 && (
                  <div>
                    <div className="muted">Изменено</div>
                    <ul>
                      {diff.items.changed.map((it) => (
                        <li key={it.id}>
                          {it.name}:{" "}
                          {it.changes.map((c) => `${c.label} ${c.from} → ${c.to}`).join("; ")}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}

            {(diff.cooling?.roomsAdded?.length > 0 ||
              diff.cooling?.roomsRemoved?.length > 0 ||
              diff.cooling?.powerChanged) && (
              <section>
                <h3 style={{ fontSize: 14, margin: "0 0 6px" }}>Охлаждение</h3>
                <ul style={{ margin: 0 }}>
                  {diff.cooling.roomsAdded?.length > 0 && (
                    <li>Добавлены помещения: {diff.cooling.roomsAdded.join(", ")}</li>
                  )}
                  {diff.cooling.roomsRemoved?.length > 0 && (
                    <li>Удалены помещения: {diff.cooling.roomsRemoved.join(", ")}</li>
                  )}
                  {diff.cooling.powerChanged && <li>Изменились параметры мощности охлаждения</li>}
                </ul>
              </section>
            )}

            {(diff.farmPower?.tariffChanged ||
              diff.farmPower?.devicesChanged ||
              diff.farmPower?.costChanged) && (
              <section>
                <h3 style={{ fontSize: 14, margin: "0 0 6px" }}>Электропотребление</h3>
                <ul style={{ margin: 0 }}>
                  {diff.farmPower.tariffChanged && <li>Изменён тариф</li>}
                  {diff.farmPower.devicesChanged && <li>Изменён список устройств</li>}
                  {diff.farmPower.costChanged && <li>Изменена стоимость электроэнергии</li>}
                </ul>
              </section>
            )}

            {(diff.images?.added?.length > 0 ||
              diff.images?.removed?.length > 0 ||
              diff.images?.changed?.length > 0) && (
              <section>
                <h3 style={{ fontSize: 14, margin: "0 0 6px" }}>Схемы и изображения</h3>
                <ul style={{ margin: 0 }}>
                  {diff.images.added?.map((img) => (
                    <li key={`a-${img.id}`}>Добавлено: {img.title || img.id}</li>
                  ))}
                  {diff.images.removed?.map((img) => (
                    <li key={`r-${img.id}`}>Удалено: {img.title || img.id}</li>
                  ))}
                  {diff.images.changed?.map((img) => (
                    <li key={`c-${img.id}`}>
                      Изменено: {img.title || img.id} (
                      {img.changes.map((c) => c.field).join(", ")})
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {(diff.drawings?.added?.length > 0 ||
              diff.drawings?.removed?.length > 0 ||
              diff.drawings?.replaced?.length > 0) && (
              <section>
                <h3 style={{ fontSize: 14, margin: "0 0 6px" }}>Чертежи каркаса</h3>
                <ul style={{ margin: 0 }}>
                  {diff.drawings.added?.map((d) => (
                    <li key={`da-${d.targetKey}`}>
                      Добавлен: {d.title || d.drawingId} ({d.targetKey})
                    </li>
                  ))}
                  {diff.drawings.removed?.map((d) => (
                    <li key={`dr-${d.targetKey}`}>
                      Удалён: {d.title || d.drawingId} ({d.targetKey})
                    </li>
                  ))}
                  {diff.drawings.replaced?.map((d) => (
                    <li key={`dx-${d.targetKey}`}>
                      Заменён для {d.targetKey}: {d.from.drawingId} → {d.to.drawingId}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {!diff.hasChanges && (
              <p className="muted">Между этими версиями нет заметных отличий в snapshot.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
