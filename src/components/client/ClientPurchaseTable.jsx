import React, { useRef, useState } from "react";
import { PURCHASE_STATUSES } from "../../data/modules.js";
import { materialSpecLabel } from "../../lib/materialSpecs.js";
import { itemImageUrl, isPurchaseClosed } from "../../lib/itemHelpers.js";
import { money, num } from "../../store/helpers.js";
import ClientStatusActions from "./ClientStatusActions.jsx";
import { patchMergedRow } from "../../lib/clientMergedPatch.js";

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

function MergedTableRow({ row, currency, patch, patchBulk, bought, onProposeReplacement, compact }) {
  const [showPhoto, setShowPhoto] = useState(false);
  const rep = row.sourceItems?.[0];
  const photoUrl = rep ? itemImageUrl(rep) : row.imageUrl;
  const hasPhoto = !!photoUrl;
  const img = !compact || showPhoto ? photoUrl : "";
  const status = mergedRowStatus(row);
  const multi = (row.sourceCount || row.sources?.length || 0) > 1;

  const onStatus = (next) => patchMergedRow(patch, patchBulk, row, { status: next });

  const onReplacement = rep && onProposeReplacement ? () => onProposeReplacement(rep) : undefined;

  return (
    <tr className={bought ? "client-purchase-table__row--bought" : ""}>
      {!compact && (
        <td data-label="Фото" className="client-purchase-table__photo">
          {img ? (
            <img src={img} alt="" className="client-purchase-table__thumb" loading="lazy" />
          ) : (
            <span className="client-purchase-table__thumb client-purchase-table__thumb--letter">
              {(row.name || "?").trim().charAt(0).toUpperCase()}
            </span>
          )}
        </td>
      )}
      <td data-label="Наименование" className="client-purchase-table__name">
        <div className="client-purchase-table__name-main">
          {row.name}
          {compact && hasPhoto && (
            <button
              type="button"
              className="btn btn-sm btn-ghost client-purchase-table__photo-btn"
              onClick={() => setShowPhoto((v) => !v)}
            >
              {showPhoto ? "Скрыть фото" : "Фото"}
            </button>
          )}
        </div>
        {compact && showPhoto && img && (
          <img src={img} alt="" className="client-purchase-table__inline-photo" loading="lazy" />
        )}
        {!compact && rep && materialSpecLabel(rep) && (
          <div className="client-purchase-table__spec">{materialSpecLabel(rep)}</div>
        )}
        {multi && (
          <span className="chip chip--brand chip-dot client-purchase-table__chip">
            ×{row.sourceCount || row.sources?.length}
          </span>
        )}
        {!compact && row.sourceText && (
          <div className="muted client-purchase-table__sources">Из: {row.sourceText}</div>
        )}
        {!compact && row.clientNote && (
          <div className="client-admin-note client-purchase-table__note">{row.clientNote}</div>
        )}
      </td>
      <td data-label="Кол-во" className="client-purchase-table__num">
        <span className="num">{num(row.qty)}</span> {row.unit}
      </td>
      <td data-label="Цена" className="client-purchase-table__num num">
        {money(row.price, currency)}
      </td>
      <td data-label="Сумма" className="client-purchase-table__num client-purchase-table__sum num">
        <b>{money(row.sumVat, currency)}</b>
      </td>
      {!compact && (
        <td data-label="Поставщик" className="client-purchase-table__supplier">
          {row.supplier || "—"}
        </td>
      )}
      <td data-label="Действия" className="client-purchase-table__actions">
        {row.link && (
          <a href={row.link} target="_blank" rel="noreferrer" className="btn btn-sm client-purchase-table__link">
            Ссылка ↗
          </a>
        )}
        {!bought ? (
          <ClientStatusActions status={status} onStatusChange={onStatus} onNeedReplacement={onReplacement} />
        ) : (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onStatus("not_bought")}>
            Вернуть
          </button>
        )}
      </td>
    </tr>
  );
}

function ItemTableRow({ it, currency, patch, bought, onProposeReplacement, compact }) {
  const [showPhoto, setShowPhoto] = useState(false);
  const photoUrl = itemImageUrl(it);
  const hasPhoto = !!photoUrl;
  const img = !compact || showPhoto ? photoUrl : "";
  const gross = Number(it.qty || 0) * Number(it.price || 0);

  return (
    <tr className={bought ? "client-purchase-table__row--bought" : ""}>
      {!compact && (
        <td data-label="Фото" className="client-purchase-table__photo">
          {img ? (
            <img src={img} alt="" className="client-purchase-table__thumb" loading="lazy" />
          ) : (
            <span className="client-purchase-table__thumb client-purchase-table__thumb--letter">
              {(it.name || "?").trim().charAt(0).toUpperCase()}
            </span>
          )}
        </td>
      )}
      <td data-label="Наименование" className="client-purchase-table__name">
        <div className="client-purchase-table__name-main">
          {it.name}
          {compact && hasPhoto && (
            <button
              type="button"
              className="btn btn-sm btn-ghost client-purchase-table__photo-btn"
              onClick={() => setShowPhoto((v) => !v)}
            >
              {showPhoto ? "Скрыть фото" : "Фото"}
            </button>
          )}
        </div>
        {compact && showPhoto && img && (
          <img src={img} alt="" className="client-purchase-table__inline-photo" loading="lazy" />
        )}
        {!compact && materialSpecLabel(it) && <div className="client-purchase-table__spec">{materialSpecLabel(it)}</div>}
        {!compact && it.clientNote && <div className="client-admin-note client-purchase-table__note">{it.clientNote}</div>}
      </td>
      <td data-label="Кол-во" className="client-purchase-table__num">
        <span className="num">{num(it.qty)}</span> {it.unit}
      </td>
      <td data-label="Цена" className="client-purchase-table__num num">
        {money(it.price, currency)}
      </td>
      <td data-label="Сумма" className="client-purchase-table__num client-purchase-table__sum num">
        <b>{money(gross, currency)}</b>
      </td>
      {!compact && (
        <td data-label="Поставщик" className="client-purchase-table__supplier">
          {it.supplier || "—"}
        </td>
      )}
      <td data-label="Действия" className="client-purchase-table__actions">
        {it.link && (
          <a href={it.link} target="_blank" rel="noreferrer" className="btn btn-sm client-purchase-table__link">
            Ссылка ↗
          </a>
        )}
        {!bought ? (
          <ClientStatusActions
            status={it.status}
            onStatusChange={(next) => patch(it.id, { status: next })}
            onNeedReplacement={onProposeReplacement ? () => onProposeReplacement(it) : undefined}
          />
        ) : (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => patch(it.id, { status: "not_bought" })}
          >
            Вернуть
          </button>
        )}
      </td>
    </tr>
  );
}

export default function ClientPurchaseTable({
  rows,
  items,
  currency,
  patch,
  patchBulk,
  bought = false,
  purchaseStatuses = PURCHASE_STATUSES,
  onProposeReplacement,
  compact = false,
}) {
  const merged = rows?.length > 0;
  const rowCount = merged ? rows.length : (items || []).length;
  const scrollRef = useRef(null);

  return (
    <div
      ref={scrollRef}
      className={"client-purchase-table-wrap" + (compact ? " client-purchase-table-wrap--compact" : "")}
      style={rowCount >= 48 ? { maxHeight: "min(65vh, 640px)", overflow: "auto" } : undefined}
    >
      <table className="client-purchase-table">
        <thead className="virtual-table-head">
          <tr>
            {!compact && <th aria-label="Фото" />}
            <th>Наименование</th>
            <th>Кол-во</th>
            <th>Цена</th>
            <th>Сумма</th>
            {!compact && <th className="client-purchase-table__col-supplier">Поставщик</th>}
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          {merged
            ? rows.map((row) => (
                <MergedTableRow
                  key={`${row.mergeKey}-${(row.sourceIds || []).join(",")}`}
                  row={row}
                  currency={currency}
                  patch={patch}
                  patchBulk={patchBulk}
                  bought={bought}
                  onProposeReplacement={onProposeReplacement}
                  compact={compact}
                />
              ))
            : (items || []).map((it) => (
                <ItemTableRow
                  key={it.id}
                  it={it}
                  currency={currency}
                  patch={patch}
                  bought={bought}
                  onProposeReplacement={onProposeReplacement}
                  compact={compact}
                />
              ))}
        </tbody>
      </table>
    </div>
  );
}
