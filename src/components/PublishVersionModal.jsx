import React, { useMemo, useState } from "react";
import { RELEASE_COMMENT_MAX_LEN } from "../../shared/releaseComment.js";
import { money } from "../store/helpers.js";

/**
 * Final confirm step before creating a published version.
 * Opening this modal does not publish.
 */
export default function PublishVersionModal({
  project,
  force = false,
  onClose,
  onPublish,
}) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const preview = useMemo(() => {
    const u = project?.unpublishedSummary || {};
    const currency = project?.currency || "₽";
    const current = Number(u.plannedTotalCurrent);
    const published = u.plannedTotalPublished;
    const delta =
      u.totalDelta != null
        ? Number(u.totalDelta)
        : Number.isFinite(current) && published != null
          ? current - Number(published)
          : null;
    return {
      currency,
      current: Number.isFinite(current) ? current : null,
      delta: Number.isFinite(delta) ? delta : null,
      added: Number(u.addedCount) || 0,
      removed: Number(u.removedCount) || 0,
      changed: Number(u.changedCount) || 0,
      imagesUpdated: !!u.imagesChanged,
      drawingsUpdated: !!u.drawingsChanged,
      firstPublish: !project?.publishedRelease,
    };
  }, [project]);

  const remaining = RELEASE_COMMENT_MAX_LEN - comment.length;

  async function handlePublish() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onPublish(comment, force);
    } catch (e) {
      setError(e?.message || "Не удалось опубликовать");
      setBusy(false);
    }
  }

  return (
    <div
      className="overlay"
      data-testid="publish-version-modal"
      onClick={onClose}
    >
      <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Опубликовать новую версию</strong>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            ✕
          </button>
        </div>

        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span>Комментарий к версии</span>
            <textarea
              data-testid="publish-release-comment"
              rows={3}
              maxLength={RELEASE_COMMENT_MAX_LEN}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Например: добавили второй стеллаж и изменили систему полива"
              style={{ resize: "vertical", minHeight: 72 }}
              disabled={busy}
            />
            <span className="muted" style={{ fontSize: 12 }}>
              Необязательно · осталось {remaining} символов
            </span>
          </label>

          <div
            data-testid="publish-change-preview"
            className="card"
            style={{ padding: "10px 12px", background: "var(--surface-2, #f6f7f8)" }}
          >
            <strong style={{ fontSize: 13 }}>Кратко об изменениях</strong>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13 }}>
              <li>
                Текущая сумма:{" "}
                {preview.current != null ? money(preview.current, preview.currency) : "—"}
              </li>
              <li>
                Изменение суммы:{" "}
                {preview.firstPublish
                  ? "первая публикация"
                  : preview.delta == null
                    ? "—"
                    : `${preview.delta > 0 ? "+" : ""}${money(preview.delta, preview.currency)}`}
              </li>
              <li>Добавлено позиций: {preview.added}</li>
              <li>Удалено позиций: {preview.removed}</li>
              <li>Изменено позиций: {preview.changed}</li>
              <li>
                Схемы / чертежи:{" "}
                {preview.imagesUpdated || preview.drawingsUpdated
                  ? [
                      preview.imagesUpdated ? "схемы обновлены" : null,
                      preview.drawingsUpdated ? "чертежи обновлены" : null,
                    ]
                      .filter(Boolean)
                      .join(", ")
                  : "без изменений"}
              </li>
            </ul>
          </div>

          {error && (
            <p style={{ color: "var(--danger)", margin: 0 }} role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="publish-version-confirm"
            onClick={handlePublish}
            disabled={busy}
          >
            {busy ? "Публикация…" : "Опубликовать версию"}
          </button>
        </div>
      </div>
    </div>
  );
}
