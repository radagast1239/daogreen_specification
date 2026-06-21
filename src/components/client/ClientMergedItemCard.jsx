import React from "react";
import PhotoGallery from "../PhotoGallery.jsx";
import { StatusChip } from "../ui.jsx";
import { PURCHASE_STATUSES } from "../../data/modules.js";
import { materialSpecLabel } from "../../lib/materialSpecs.js";
import { itemImageUrl } from "../../lib/itemHelpers.js";
import { money, num } from "../../store/helpers.js";
import { isBoughtStatus } from "../../lib/itemHelpers.js";
import ClientStatusActions from "./ClientStatusActions.jsx";

function mergedRowStatus(row) {
  if (row.statusSummary?.status) return row.statusSummary.status;
  const items = row?.sourceItems || [];
  if (!items.length) return "not_bought";
  const unique = [...new Set(items.map((i) => i.status))];
  if (unique.length === 1) return unique[0];
  if (items.every((i) => isBoughtStatus(i.status))) return items[0].status;
  const open = items.find((i) => !isBoughtStatus(i.status));
  return open?.status || "not_bought";
}

function patchMerged(patch, row, payload) {
  return Promise.all((row.sourceItems || []).map((it) => patch(it.id, payload)));
}

export default function ClientMergedItemCard({
  row,
  currency,
  patch,
  bought = false,
  purchaseStatuses = PURCHASE_STATUSES,
}) {
  const statuses = purchaseStatuses || PURCHASE_STATUSES;
  const rep = row.sourceItems?.[0];
  const img = rep ? itemImageUrl(rep) : row.imageUrl;
  const status = mergedRowStatus(row);
  const multi = (row.sourceCount || row.sources?.length || 0) > 1;
  const sourcesLine = row.sourceText || "";

  return (
    <div className={"card card-item" + (bought ? " card-item--bought" : "")}>
      {img ? (
        <PhotoGallery src={img} alt={row.name} />
      ) : (
        <div className="thumb">{(row.name || "?").trim().charAt(0).toUpperCase()}</div>
      )}
      <div style={{ minWidth: 0 }}>
        <div className="between">
          <strong style={{ fontSize: 14 }}>{row.name}</strong>
          {bought ? (
            <span className="chip chip--ok chip-dot" style={{ fontSize: 11 }}>
              Куплено
            </span>
          ) : status === "need_help" ? (
            <StatusChip status={status} statuses={statuses} />
          ) : multi ? (
            <span className="chip chip--brand chip-dot" style={{ fontSize: 11 }}>
              Сводная
            </span>
          ) : null}
        </div>
        {rep && materialSpecLabel(rep) && (
          <div style={{ fontSize: 12, marginTop: 2, color: "var(--brand)" }}>{materialSpecLabel(rep)}</div>
        )}
        <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
          Кол-во: <span className="num">{num(row.qty)}</span> {row.unit}
          {(row.vatRate || 0) > 0 && <span> · НДС {row.vatRate}%</span>}
        </div>
        <div style={{ fontSize: 12.5, marginTop: 4 }}>
          Цена: <span className="num">{money(row.price, currency)}</span>/ед · Сумма:{" "}
          <b className="num">{money(row.sumVat, currency)}</b>
        </div>
        {row.supplier && (
          <div style={{ fontSize: 12.5, marginTop: 4 }}>
            <b>Поставщик:</b> {row.supplier}
          </div>
        )}
        {sourcesLine && (
          <div className="muted client-merged-sources" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.45 }}>
            <b>Из:</b> {sourcesLine}
          </div>
        )}
        {row.clientNote && (
          <div className="client-admin-note" style={{ fontSize: 12.5, marginTop: 6 }}>
            <b>Комментарий Daogreen:</b> {row.clientNote}
          </div>
        )}
        {row.link && (
          <a
            href={row.link}
            target="_blank"
            rel="noreferrer"
            className="btn btn-sm"
            style={{ marginTop: 8, display: "inline-block" }}
          >
            Открыть ссылку ↗
          </a>
        )}

        {!bought ? (
          <ClientStatusActions
            status={status}
            onStatusChange={(next) => patchMerged(patch, row, { status: next })}
            purchaseStatuses={statuses}
          />
        ) : (
          <button
            type="button"
            className="btn btn-sm btn-ghost no-print"
            style={{ marginTop: 10 }}
            onClick={() => patchMerged(patch, row, { status: "not_bought" })}
          >
            Вернуть в список
          </button>
        )}

        {!bought && (
          <div className="row no-print" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
            <div className="field" style={{ flex: "0 0 150px" }}>
              <label>Факт. цена</label>
              <input
                type="number"
                value={rep?.actualPrice ?? ""}
                placeholder={String(row.price)}
                onChange={(e) =>
                  patchMerged(patch, row, {
                    actualPrice: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label>Комментарий</label>
              <input
                value={rep?.clientComment || ""}
                onChange={(e) => patchMerged(patch, row, { clientComment: e.target.value })}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
