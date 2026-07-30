import React, { useMemo, useState } from "react";
import { photoSrc } from "../lib/api.js";
import { formatMaterialModulesLabel } from "../../shared/materialModules.js";
import { materialSpecSubtitle } from "../lib/materialDisplay.js";
import { filterMaterialsForSpecAdd } from "../lib/addProjectItemFromMaterial.js";

/**
 * Modal: pick an existing catalog material to add into a project section.
 */
export default function AddMaterialToSpecModal({
  module,
  materials = [],
  existingItems = [],
  onClose,
  onSelect,
  onCustom,
}) {
  const [q, setQ] = useState("");
  const existingIds = useMemo(() => {
    const mod = String(module || "").trim();
    const set = new Set();
    for (const it of existingItems || []) {
      if (!it?.materialId) continue;
      if (mod && it.module !== mod && it.section !== mod) continue;
      set.add(it.materialId);
    }
    return set;
  }, [existingItems, module]);

  const catalog = useMemo(
    () => filterMaterialsForSpecAdd(materials, q),
    [materials, q]
  );

  const handlePick = (m) => {
    if (existingIds.has(m.id)) {
      const ok = window.confirm(
        `Материал «${m.name}» уже есть в разделе «${module}». Добавить ещё одну позицию?`
      );
      if (!ok) return;
    }
    onSelect?.(m);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: 720, maxHeight: "85vh", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <strong>Добавить позицию из базы</strong>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="muted" style={{ fontSize: 13, margin: "0 0 10px" }}>
          Раздел: <b>{module}</b>. Поиск по названию, категории, поставщику, описанию.
        </p>
        <input
          autoFocus
          className="input"
          placeholder="Поиск…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ marginBottom: 10 }}
        />
        <div className="material-picker-list" style={{ flex: 1, overflow: "auto", minHeight: 200 }}>
          {!catalog.length ? (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              Ничего не найдено.
            </p>
          ) : (
            <table className="spec material-picker-table" style={{ width: "100%" }}>
              <tbody>
                {catalog.map((m) => {
                  const src = photoSrc(m.imageUrl || m.photoUrl);
                  const already = existingIds.has(m.id);
                  return (
                    <tr key={m.id} className={already ? "material-picker-row--added" : undefined}>
                      <td style={{ width: 52 }}>
                        {src ? (
                          <img
                            src={src}
                            alt=""
                            className="thumb-img"
                            style={{ width: 48, height: 32, objectFit: "cover" }}
                          />
                        ) : (
                          <div className="thumb" style={{ width: 40, height: 40, fontSize: 16 }}>
                            {(m.name || "?").charAt(0)}
                          </div>
                        )}
                      </td>
                      <td>
                        <strong style={{ fontSize: 13 }}>{m.name}</strong>
                        <div className="muted" style={{ fontSize: 11 }}>
                          {m.category || "—"}
                          {m.supplier ? ` · ${m.supplier}` : ""}
                          {formatMaterialModulesLabel(m) ? ` · ${formatMaterialModulesLabel(m)}` : ""}
                        </div>
                        {materialSpecSubtitle(m) && (
                          <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>
                            {materialSpecSubtitle(m)}
                          </div>
                        )}
                        {already && (
                          <span className="chip chip--neutral" style={{ fontSize: 10, marginTop: 4 }}>
                            уже в разделе
                          </span>
                        )}
                      </td>
                      <td className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                        {m.unit || "шт."}
                        {m.basePrice ? ` · ${m.basePrice} ₽` : ""}
                      </td>
                      <td style={{ width: 100 }}>
                        <button type="button" className="btn btn-sm btn-primary" onClick={() => handlePick(m)}>
                          Выбрать
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="row wrap" style={{ gap: 8, marginTop: 12, justifyContent: "space-between" }}>
          {typeof onCustom === "function" ? (
            <button type="button" className="btn btn-sm btn-ghost" onClick={onCustom}>
              Произвольная позиция
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
