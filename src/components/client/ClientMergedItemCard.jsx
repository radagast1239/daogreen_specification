import React, { useState } from "react";
import PhotoGallery from "../PhotoGallery.jsx";
import { StatusChip } from "../ui.jsx";
import { PURCHASE_STATUSES } from "../../data/modules.js";
import { materialSpecLabel } from "../../lib/materialSpecs.js";
import { itemImageUrl, isPurchaseClosed } from "../../lib/itemHelpers.js";
import { money, num } from "../../store/helpers.js";
import ClientStatusActions from "./ClientStatusActions.jsx";
import { patchMergedRow } from "../../lib/clientMergedPatch.js";
import { DebouncedInput } from "./ClientDebouncedField.jsx";

function mergedRowStatus(row) {
  if (row.statusSummary?.status) return row.statusSummary.status;
  const items = row?.sourceItems || [];
  if (!items.length) return "not_bought";
  const unique = [...new Set(items.map((i) => i.status))];
  if (unique.length === 1) return unique[0];
  if (items.every((i) => isPurchaseClosed(i))) return items[0].status;
  const open = items.find((i) => !isPurchaseClosed(i));
  return open?.status || "not_bought";
}

function patchMerged(patchFn, patchBulkFn, row, payload) {
  return patchMergedRow(patchFn, patchBulkFn, row, payload);
}

export default function ClientMergedItemCard({
  row,
  currency,
  patch,
  patchBulk,
  bought = false,
  purchaseStatuses = PURCHASE_STATUSES,
  onProposeReplacement,
  compact = false,
}) {
  const [showPhoto, setShowPhoto] = useState(false);
  const statuses = purchaseStatuses || PURCHASE_STATUSES;
  const rep = row.sourceItems?.[0];
  const photoUrl = rep ? itemImageUrl(rep) : row.imageUrl;
  const hasPhoto = !!photoUrl;
  const showImage = !compact || showPhoto;
  const img = showImage ? photoUrl : "";
  const status = mergedRowStatus(row);
  const multi = (row.sourceCount || row.sources?.length || 0) > 1;
  const sourcesLine = compact ? "" : row.sourceText || "";

  const onStatus = (next) => patchMerged(patch, patchBulk, row, { status: next });

  const patchRowField = (payload) => patchMerged(patch, patchBulk, row, payload);

  const onReplacement = rep && onProposeReplacement ? () => onProposeReplacement(rep) : undefined;

  return (
    <div className={"card card-item" + (bought ? " card-item--bought" : "") + (compact ? " card-item--compact" : "")}>
      {showImage && (
        img ? (
          <PhotoGallery src={img} alt={row.name} />
        ) : (
          <div className="thumb">{(row.name || "?").trim().charAt(0).toUpperCase()}</div>
        )
      )}
      <div style={{ minWidth: 0 }}>
        <div className="between">
          <strong style={{ fontSize: compact ? 13 : 14 }}>{row.name}</strong>
          <div className="row" style={{ gap: 6, alignItems: "center" }}>
            {compact && hasPhoto && !showPhoto && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowPhoto(true)}>
                Фото
              </button>
            )}
            {compact && showPhoto && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowPhoto(false)}>
                Скрыть
              </button>
            )}
          {bought ? (
            <span className="chip chip--ok chip-dot" style={{ fontSize: 11 }}>
              Готово
            </span>
          ) : status === "need_help" || status === "replacement_check" ? (
            <StatusChip status={status} statuses={statuses} />
          ) : multi ? (
            <span
              className="chip chip--brand chip-dot"
              style={{ fontSize: 11 }}
              title="Одинаковые позиции с разных стеллажей сложены в одну строку"
            >
              ×{row.sourceCount || row.sources?.length}
            </span>
          ) : null}
          </div>
        </div>
        {!compact && rep && materialSpecLabel(rep) && (
          <div style={{ fontSize: 12, marginTop: 2, color: "var(--brand)" }}>{materialSpecLabel(rep)}</div>
        )}
        <div className="muted" style={{ fontSize: compact ? 12 : 12.5, marginTop: 2 }}>
          <span className="num">{num(row.qty)}</span> {row.unit}
          {!compact && (row.vatRate || 0) > 0 && <span> · НДС {row.vatRate}%</span>}
          {compact && row.price > 0 && (
            <span>
              {" "}
              · <span className="num">{money(row.sumVat, currency)}</span>
            </span>
          )}
        </div>
        {!compact && (
          <div style={{ fontSize: 12.5, marginTop: 4 }}>
            Цена: <span className="num">{money(row.price, currency)}</span>/ед · Сумма:{" "}
            <b className="num">{money(row.sumVat, currency)}</b>
          </div>
        )}
        {!compact && row.supplier && (
          <div style={{ fontSize: 12.5, marginTop: 4 }}>
            <b>Поставщик:</b> {row.supplier}
          </div>
        )}
        {sourcesLine && (
          <div className="muted client-merged-sources" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.45 }}>
            <b>Из:</b> {sourcesLine}
          </div>
        )}
        {!compact && row.clientNote && (
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
            style={{ marginTop: compact ? 6 : 8, display: "inline-block" }}
          >
            {compact ? "Ссылка ↗" : "Открыть ссылку ↗"}
          </a>
        )}

        {!bought ? (
          <ClientStatusActions
            status={status}
            onStatusChange={onStatus}
            onNeedReplacement={onReplacement}
          />
        ) : (
          <button
            type="button"
            className="btn btn-sm btn-ghost no-print"
            style={{ marginTop: 10 }}
            onClick={() => onStatus("not_bought")}
          >
            Вернуть в список
          </button>
        )}

        {!compact && !bought && (
          <div className="row no-print" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
            <div className="field" style={{ flex: "0 0 150px" }}>
              <label>Факт. цена</label>
              <DebouncedInput
                type="number"
                value={rep?.actualPrice ?? ""}
                placeholder={String(row.price)}
                onCommit={(val) => patchRowField({ actualPrice: val })}
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label>Комментарий</label>
              <DebouncedInput
                value={rep?.clientComment || ""}
                onCommit={(val) => patchRowField({ clientComment: val })}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
