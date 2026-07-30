import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api.js";
import { PageHeader } from "../../components/Layout.jsx";
import { Empty } from "../../components/ui.jsx";
import { STORAGE_STATUS_HINTS, STORAGE_STATUS_LABELS } from "../../../shared/storageInventory.js";
import { QUARANTINE_CONFIRM_PHRASE } from "../../../shared/storageQuarantine.js";

function formatBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MB`;
  return `${(v / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function statusChipClass(status) {
  if (status === "PINNED" || status === "PINNED_AND_LIVE") return "chip chip--ok";
  if (status === "LIVE_REFERENCED") return "chip chip--neutral";
  if (status === "ORPHAN" || status === "DUPLICATE") return "chip chip--amber";
  if (status === "MISSING") return "chip chip--danger";
  return "chip";
}

function canSelectForQuarantine(f) {
  return f?.status === "ORPHAN" && !f?.isDuplicate && f?.physicalExists;
}

const FILTERS = [
  { id: "ALL", label: "Все" },
  { id: "PINNED", label: "Защищённые" },
  { id: "LIVE_REFERENCED", label: "Используемые" },
  { id: "ORPHAN", label: "Возможные сироты" },
  { id: "MISSING", label: "Битые ссылки" },
  { id: "DUPLICATE", label: "Дубликаты" },
];

export default function StorageInventoryPage() {
  const [summary, setSummary] = useState(null);
  const [files, setFiles] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [needsScan, setNeedsScan] = useState(true);
  const [checked, setChecked] = useState(() => new Set());
  const [preview, setPreview] = useState(null);
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [quarantining, setQuarantining] = useState(false);
  const [quarantineList, setQuarantineList] = useState([]);
  const [showQuarantine, setShowQuarantine] = useState(false);
  const pageSize = 50;

  const loadQuarantine = useCallback(async () => {
    try {
      const data = await api.listStorageQuarantine({ status: "QUARANTINED", pageSize: 100 });
      setQuarantineList(data.files || data.items || []);
    } catch {
      /* ignore until first open */
    }
  }, []);

  const load = useCallback(
    async (opts = {}) => {
      setLoading(true);
      setError("");
      try {
        const data = await api.getStorageInventory({
          status: opts.status ?? filter,
          search: opts.search ?? search,
          page: opts.page ?? page,
          pageSize,
        });
        if (data.needsScan) {
          setNeedsScan(true);
          setSummary(null);
          setFiles([]);
          setTotal(0);
          return;
        }
        setNeedsScan(false);
        setSummary(data.summary || null);
        setFiles(data.files || data.items || []);
        setTotal(data.total || 0);
      } catch (e) {
        setError(e.message || "Не удалось загрузить inventory");
      } finally {
        setLoading(false);
      }
    },
    [filter, search, page]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (showQuarantine) loadQuarantine();
  }, [showQuarantine, loadQuarantine]);

  async function runScan() {
    setScanning(true);
    setError("");
    setChecked(new Set());
    setPreview(null);
    try {
      const data = await api.scanStorageInventory({ pageSize });
      setNeedsScan(false);
      setSummary(data.summary || null);
      setFiles(data.files || []);
      setTotal(data.total || 0);
      setPage(1);
      setFilter("ALL");
    } catch (e) {
      setError(e.message || "Сканирование не удалось");
    } finally {
      setScanning(false);
    }
  }

  function applyFilter(id) {
    setFilter(id);
    setPage(1);
    setChecked(new Set());
  }

  function toggleCheck(assetPath, e) {
    e.stopPropagation();
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(assetPath)) next.delete(assetPath);
      else next.add(assetPath);
      return next;
    });
    setPreview(null);
    setConfirmPhrase("");
  }

  async function openFile(assetPath) {
    try {
      const data = await api.getStorageInventoryFile(assetPath);
      setSelected(data.file);
    } catch (e) {
      setError(e.message || "Не удалось открыть файл");
    }
  }

  async function copyUrl(url) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* ignore */
    }
  }

  async function runPreview() {
    setError("");
    setPreview(null);
    setConfirmPhrase("");
    try {
      const data = await api.previewStorageQuarantine({ assetPaths: [...checked] });
      setPreview(data);
    } catch (e) {
      setError(e.message || "Preview не удалось");
    }
  }

  async function runQuarantine() {
    if (!preview?.confirmationToken) return;
    if (confirmPhrase.trim() !== QUARANTINE_CONFIRM_PHRASE) {
      setError(`Введите точную фразу: ${QUARANTINE_CONFIRM_PHRASE}`);
      return;
    }
    setQuarantining(true);
    setError("");
    try {
      await api.executeStorageQuarantine({
        assetPaths: (preview.eligible || []).map((f) => f.assetPath),
        confirmationToken: preview.confirmationToken,
        confirmationPhrase: confirmPhrase.trim(),
      });
      setPreview(null);
      setConfirmPhrase("");
      setChecked(new Set());
      await runScan();
      await loadQuarantine();
      setShowQuarantine(true);
    } catch (e) {
      setError(e.message || "Карантин не выполнен");
    } finally {
      setQuarantining(false);
    }
  }

  async function restoreItem(id) {
    setError("");
    try {
      await api.restoreStorageQuarantine(id);
      await loadQuarantine();
      setNeedsScan(true);
    } catch (e) {
      setError(e.message || "Восстановление не удалось");
    }
  }

  const cards = useMemo(() => {
    if (!summary) return [];
    return [
      { label: "Всего файлов", value: summary.totalFiles },
      { label: "Общий объём", value: formatBytes(summary.totalSizeBytes) },
      { label: "Защищены публикациями", value: summary.pinnedFiles },
      { label: "Используются проектами", value: summary.liveReferencedFiles },
      { label: "Возможные сироты", value: summary.orphanFiles },
      { label: "Битые ссылки", value: summary.missingReferences },
      { label: "Группы дубликатов", value: summary.duplicateGroups },
    ];
  }, [summary]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const selectedOrphans = files.filter((f) => canSelectForQuarantine(f) && checked.has(f.assetPath));

  return (
    <>
      <PageHeader
        title="Файлы и хранилище"
        sub="Учёт uploads. Окончательное удаление недоступно. Карантин — только для подтверждённых pure ORPHAN."
        back={{ to: "/", label: "Проекты" }}
      />
      <div className="content" data-testid="storage-inventory-page">
        <div className="row wrap" style={{ gap: 8, marginBottom: 16 }}>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="storage-scan-btn"
            disabled={scanning}
            onClick={runScan}
          >
            {scanning ? "Сканирование…" : "Сканировать хранилище"}
          </button>
          <button type="button" className="btn" disabled={loading || needsScan} onClick={() => load()}>
            Обновить список
          </button>
          <button
            type="button"
            className="btn"
            data-testid="storage-quarantine-toggle"
            onClick={() => setShowQuarantine((v) => !v)}
          >
            {showQuarantine ? "Скрыть карантин" : "Карантин"}
          </button>
          {summary?.durationMs != null && (
            <span className="muted" style={{ fontSize: 13, alignSelf: "center" }}>
              Последнее сканирование: {summary.durationMs} мс · {summary.scanCompletedAt || "—"}
            </span>
          )}
        </div>

        {error && (
          <p style={{ color: "var(--danger)" }} role="alert">
            {error}
          </p>
        )}

        {needsScan && !scanning && (
          <Empty title="Нет данных сканирования" hint="Запустите сканирование uploads, чтобы увидеть учёт файлов." />
        )}

        {summary && (
          <div
            data-testid="storage-summary-cards"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: 10,
              marginBottom: 16,
            }}
          >
            {cards.map((c) => (
              <div key={c.label} className="card" style={{ padding: "10px 12px" }}>
                <div className="muted" style={{ fontSize: 12 }}>
                  {c.label}
                </div>
                <strong style={{ fontSize: 18 }}>{c.value}</strong>
              </div>
            ))}
          </div>
        )}

        <div className="row wrap" style={{ gap: 8, marginBottom: 12 }} data-testid="storage-filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={"btn btn-sm" + (filter === f.id ? " btn-primary" : "")}
              data-testid={`storage-filter-${f.id}`}
              onClick={() => applyFilter(f.id)}
              disabled={needsScan}
            >
              {f.label}
            </button>
          ))}
          <input
            type="search"
            placeholder="Поиск файла / hash…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setPage(1);
                load({ search: e.target.value, page: 1 });
              }
            }}
            style={{ minWidth: 200, marginLeft: "auto" }}
            disabled={needsScan}
          />
        </div>

        {!needsScan && selectedOrphans.length > 0 && (
          <div className="card" style={{ padding: 12, marginBottom: 12 }} data-testid="storage-quarantine-actions">
            <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
              <span>Выбрано pure ORPHAN: {selectedOrphans.length}</span>
              <button type="button" className="btn btn-primary" data-testid="storage-quarantine-preview-btn" onClick={runPreview}>
                Проверить для карантина
              </button>
            </div>
          </div>
        )}

        {preview && (
          <div className="card" style={{ padding: 14, marginBottom: 16 }} data-testid="storage-quarantine-preview">
            <strong>Проверка карантина</strong>
            <p className="muted" style={{ margin: "6px 0" }}>
              Eligible: {preview.totalFiles} · {formatBytes(preview.totalBytes)} · min age {preview.minAgeDays} дн.
            </p>
            {(preview.eligible || []).length > 0 && (
              <ul style={{ margin: "8px 0", paddingLeft: 18, fontSize: 13 }}>
                {preview.eligible.map((f) => (
                  <li key={f.assetPath}>
                    <code>{f.filename}</code> · {formatBytes(f.sizeBytes)} · hash {(f.contentHash || "").slice(0, 10)} ·{" "}
                    {Number(f.ageDays || 0).toFixed(1)} дн. — {f.reason}
                  </li>
                ))}
              </ul>
            )}
            {(preview.blocked || []).length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div className="muted">Заблокированы:</div>
                <ul style={{ margin: "4px 0", paddingLeft: 18, fontSize: 13 }}>
                  {preview.blocked.map((f) => (
                    <li key={f.assetPath}>
                      <code>{f.filename || f.assetPath}</code> — {f.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(preview.eligible || []).length > 0 && (
              <div style={{ marginTop: 12 }}>
                <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>
                  Для подтверждения введите: <code>{QUARANTINE_CONFIRM_PHRASE}</code>
                </label>
                <input
                  data-testid="storage-quarantine-confirm-input"
                  value={confirmPhrase}
                  onChange={(e) => setConfirmPhrase(e.target.value)}
                  style={{ width: "100%", maxWidth: 420 }}
                  autoComplete="off"
                />
                <div className="row" style={{ gap: 8, marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    data-testid="storage-quarantine-execute-btn"
                    disabled={quarantining || confirmPhrase.trim() !== QUARANTINE_CONFIRM_PHRASE}
                    onClick={runQuarantine}
                  >
                    {quarantining ? "Перемещение…" : "Переместить в карантин"}
                  </button>
                  <button type="button" className="btn" onClick={() => { setPreview(null); setConfirmPhrase(""); }}>
                    Отмена
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {!needsScan && files.length === 0 && !loading && <Empty title="Нет файлов по фильтру" />}

        {files.length > 0 && (
          <div className="card" style={{ padding: 0, overflow: "auto" }}>
            <table data-testid="storage-files-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
                  <th style={{ padding: 10, width: 36 }} />
                  <th style={{ padding: 10 }}>Файл</th>
                  <th style={{ padding: 10 }}>Категория</th>
                  <th style={{ padding: 10 }}>Размер</th>
                  <th style={{ padding: 10 }}>Статус</th>
                  <th style={{ padding: 10 }}>Где используется</th>
                  <th style={{ padding: 10 }}>Публ.</th>
                  <th style={{ padding: 10 }}>Проекты</th>
                  <th style={{ padding: 10 }}>Hash</th>
                  <th style={{ padding: 10 }}>Изменён</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => {
                  const projectIds = [
                    ...new Set((f.references || []).map((r) => r.projectId).filter(Boolean)),
                  ];
                  const where =
                    (f.references || [])
                      .slice(0, 2)
                      .map((r) => r.referenceType || "")
                      .join(", ") || "—";
                  const selectable = canSelectForQuarantine(f);
                  return (
                    <tr
                      key={f.assetPath}
                      style={{ borderBottom: "1px solid var(--line)", cursor: "pointer" }}
                      onClick={() => openFile(f.assetPath)}
                      data-testid={`storage-row-${f.status}`}
                    >
                      <td style={{ padding: 10 }} onClick={(e) => e.stopPropagation()}>
                        {selectable ? (
                          <input
                            type="checkbox"
                            data-testid={`storage-orphan-check-${f.filename}`}
                            checked={checked.has(f.assetPath)}
                            onChange={(e) => toggleCheck(f.assetPath, e)}
                          />
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td style={{ padding: 10 }}>
                        <code style={{ fontSize: 12 }}>{f.filename}</code>
                      </td>
                      <td style={{ padding: 10 }}>{(f.categories || []).join(", ") || "—"}</td>
                      <td style={{ padding: 10 }}>{f.physicalExists ? formatBytes(f.sizeBytes) : "—"}</td>
                      <td style={{ padding: 10 }}>
                        <span className={statusChipClass(f.status)}>
                          {STORAGE_STATUS_LABELS[f.status] || f.status}
                        </span>
                      </td>
                      <td style={{ padding: 10 }}>{where}</td>
                      <td style={{ padding: 10 }}>{f.pinnedReferenceCount || 0}</td>
                      <td style={{ padding: 10 }}>{projectIds.length}</td>
                      <td style={{ padding: 10 }}>
                        <code style={{ fontSize: 11 }}>{(f.contentHash || "").slice(0, 10) || "—"}</code>
                      </td>
                      <td style={{ padding: 10 }} className="muted">
                        {f.modifiedAt ? String(f.modifiedAt).slice(0, 16).replace("T", " ") : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {total > pageSize && (
          <div className="row" style={{ gap: 8, marginTop: 12, justifyContent: "center" }}>
            <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              ←
            </button>
            <span className="muted">
              {page} / {pageCount}
            </span>
            <button type="button" className="btn btn-sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
              →
            </button>
          </div>
        )}

        {showQuarantine && (
          <div className="card" style={{ marginTop: 20, padding: 14 }} data-testid="storage-quarantine-list">
            <strong>Карантин</strong>
            <p className="muted" style={{ fontSize: 13 }}>
              Файлы вне публичного /uploads. Окончательное удаление недоступно.
            </p>
            {quarantineList.length === 0 ? (
              <Empty title="Карантин пуст" hint="Подтверждённые pure ORPHAN появятся здесь после перемещения." />
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
                    <th style={{ padding: 8 }}>Файл</th>
                    <th style={{ padding: 8 }}>Старый URL</th>
                    <th style={{ padding: 8 }}>Размер</th>
                    <th style={{ padding: 8 }}>Hash</th>
                    <th style={{ padding: 8 }}>Дата</th>
                    <th style={{ padding: 8 }}>Причина</th>
                    <th style={{ padding: 8 }} />
                  </tr>
                </thead>
                <tbody>
                  {quarantineList.map((q) => (
                    <tr key={q.quarantineId} style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={{ padding: 8 }}>
                        <code>{q.filename}</code>
                      </td>
                      <td style={{ padding: 8 }}>
                        <code style={{ fontSize: 11 }}>{q.originalAssetPath}</code>
                      </td>
                      <td style={{ padding: 8 }}>{formatBytes(q.sizeBytes)}</td>
                      <td style={{ padding: 8 }}>
                        <code style={{ fontSize: 11 }}>{(q.contentHash || "").slice(0, 10)}</code>
                      </td>
                      <td style={{ padding: 8 }} className="muted">
                        {String(q.quarantinedAt || "").slice(0, 16).replace("T", " ")}
                      </td>
                      <td style={{ padding: 8 }}>{q.reason}</td>
                      <td style={{ padding: 8 }}>
                        <button
                          type="button"
                          className="btn btn-sm"
                          data-testid={`storage-restore-${q.quarantineId}`}
                          onClick={() => restoreItem(q.quarantineId)}
                        >
                          Восстановить
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        <p className="muted" style={{ marginTop: 16, fontSize: 12 }} data-testid="storage-readonly-note">
          Окончательное удаление файлов недоступно. Карантин перемещает только подтверждённые pure ORPHAN старше минимального возраста.
        </p>
      </div>

      {selected && (
        <div className="overlay" data-testid="storage-file-detail" onClick={() => setSelected(null)}>
          <div className="modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>{selected.filename}</strong>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(null)}>
                ✕
              </button>
            </div>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
              <div>
                <span className={statusChipClass(selected.status)}>
                  {STORAGE_STATUS_LABELS[selected.status] || selected.status}
                </span>
              </div>
              <p data-testid="storage-file-explanation" style={{ margin: 0 }}>
                {selected.explanation || STORAGE_STATUS_HINTS[selected.status]}
              </p>
              {selected.missingSeverity && (
                <p style={{ color: "var(--danger)", margin: 0 }} data-testid="storage-missing-warning">
                  Severity: {selected.missingSeverity}. {STORAGE_STATUS_HINTS.MISSING}
                </p>
              )}
              {selected.isDuplicate && (
                <p className="muted" style={{ margin: 0 }} data-testid="storage-duplicate-warning">
                  {STORAGE_STATUS_HINTS.DUPLICATE}
                </p>
              )}
              <div>
                <div className="muted">URL</div>
                <code>{selected.url}</code>
              </div>
              <div className="row wrap" style={{ gap: 16 }}>
                <div>
                  <div className="muted">Размер</div>
                  {selected.physicalExists ? formatBytes(selected.sizeBytes) : "—"}
                </div>
                <div>
                  <div className="muted">MIME</div>
                  {selected.mimeType || "—"}
                </div>
                <div>
                  <div className="muted">Hash</div>
                  <code style={{ fontSize: 11 }}>{selected.contentHash || "—"}</code>
                </div>
              </div>
              <div>
                <div className="muted" style={{ marginBottom: 6 }}>
                  Ссылки ({selected.references?.length || 0})
                </div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {(selected.references || []).map((r, i) => (
                    <li key={i}>
                      {r.referenceType}
                      {r.projectName ? ` · ${r.projectName}` : ""}
                      {r.versionNumber != null ? ` · v${r.versionNumber}` : ""}
                      {r.pinned ? " · pinned" : ""}
                      {r.projectId ? (
                        <>
                          {" "}
                          <Link to={`/project/${r.projectId}`} onClick={(e) => e.stopPropagation()}>
                            проект
                          </Link>
                        </>
                      ) : null}
                    </li>
                  ))}
                  {!selected.references?.length && <li className="muted">Нет ссылок</li>}
                </ul>
              </div>
              <p className="muted" style={{ margin: 0 }}>
                {canSelectForQuarantine(selected)
                  ? "Можно отправить в карантин после повторной проверки (не окончательное удаление)."
                  : selected.pinnedReferenceCount
                    ? "Защищён публикацией — карантин недоступен."
                    : selected.liveReferenceCount
                      ? "Используется проектом — карантин недоступен."
                      : selected.isDuplicate || selected.status === "DUPLICATE"
                        ? "Дубликаты не отправляются в карантин на этом этапе."
                        : "Карантин доступен только для pure ORPHAN."}
              </p>
            </div>
            <div className="modal-foot">
              {selected.physicalExists && (
                <a className="btn" href={selected.url} target="_blank" rel="noopener noreferrer">
                  Открыть файл
                </a>
              )}
              <button type="button" className="btn" onClick={() => copyUrl(selected.url)}>
                Скопировать URL
              </button>
              <button type="button" className="btn" onClick={() => setSelected(null)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
