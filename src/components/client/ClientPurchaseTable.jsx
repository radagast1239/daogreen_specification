import React, { useRef, useState } from "react";
import { PURCHASE_STATUSES } from "../../data/modules.js";
import { materialSpecLabel } from "../../lib/materialSpecs.js";
import { isPurchaseClosed } from "../../lib/itemHelpers.js";
import { money, num } from "../../store/helpers.js";
import {
  CLIENT_PRICE_MISSING,
  CLIENT_PRICE_TBD,
  formatClientLineTotal,
  formatClientUnitPrice,
  resolveClientPurchaseStatusLabel,
} from "../../../shared/clientPurchaseRows.js";
import { getPurchaseStatusTone, isPurchaseStatusNeedsAttention } from "../../../shared/purchaseStatusRules.js";
import { clientMergedPhotoSrc, clientPhotoSrc } from "../../lib/photoHelpers.js";
import { Chip } from "../ui.jsx";
import ClientStatusActions from "./ClientStatusActions.jsx";
import { patchMergedRow } from "../../lib/clientMergedPatch.js";
import { t, tStatus, tUnit } from "../../../shared/clientI18n.js";

const PRICE_TBD = CLIENT_PRICE_TBD;
const PRICE_MISSING = CLIENT_PRICE_MISSING;

function clientPriceLabel(rowOrItem, currency, { gross = false, language = "ru" } = {}) {
  const formatted = gross ? formatClientLineTotal(rowOrItem) : formatClientUnitPrice(rowOrItem);
  if (formatted === PRICE_TBD) return t(language, "client.price.tbd");
  if (formatted === PRICE_MISSING) return t(language, "client.price.missing");
  return money(formatted, currency);
}

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

function MergedTableRow({ row, currency, patch, patchBulk, bought, onProposeReplacement, compact, language, clientToken = "" }) {
  const [showPhoto, setShowPhoto] = useState(false);
  const rep = row.sourceItems?.[0];
  const photoUrl = clientMergedPhotoSrc(row, clientToken);
  const hasPhoto = !!photoUrl;
  const img = !compact || showPhoto ? photoUrl : "";
  const status = mergedRowStatus(row);
  const multi = (row.sourceCount || row.sources?.length || 0) > 1;

  const onStatus = (next) => patchMergedRow(patch, patchBulk, row, { status: next });

  const onReplacement = rep && onProposeReplacement ? () => onProposeReplacement(rep) : undefined;

  return (
    <tr className={bought ? "client-purchase-table__row--bought" : ""}>
      {!compact && (
        <td data-label={t(language, "client.purchaseTable.photo")} className="client-purchase-table__photo">
          {img ? (
            <img src={img} alt="" className="client-purchase-table__thumb" loading="lazy" />
          ) : (
            <span className="client-purchase-table__thumb client-purchase-table__thumb--letter">
              {(row.name || "?").trim().charAt(0).toUpperCase()}
            </span>
          )}
        </td>
      )}
      <td data-label={t(language, "client.purchaseTable.name")} className="client-purchase-table__name">
        <div className="client-purchase-table__name-main">
          {row.name}
          {compact && hasPhoto && (
            <button
              type="button"
              className="btn btn-sm btn-ghost client-purchase-table__photo-btn"
              onClick={() => setShowPhoto((v) => !v)}
            >
              {t(language, showPhoto ? "client.purchaseTable.hidePhoto" : "client.purchaseTable.showPhoto")}
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
          <div className="muted client-purchase-table__sources">
            {t(language, "client.purchaseTable.fromSource", { sourceText: row.sourceText })}
          </div>
        )}
        {!compact && row.clientNote && (
          <div className="client-admin-note client-purchase-table__note">{row.clientNote}</div>
        )}
      </td>
      <td data-label={t(language, "client.purchaseTable.qty")} className="client-purchase-table__num">
        <span className="client-qty-badge" title={t(language, "client.purchaseTable.qtyTitle")}>
          <span className="num">{num(row.qty)}</span>
          <span className="client-qty-badge__unit">{tUnit(language, row.unit || "шт.")}</span>
        </span>
      </td>
      <td data-label={t(language, "client.purchaseTable.price")} className="client-purchase-table__num num">
        {clientPriceLabel(row, currency, { language })}
      </td>
      <td data-label={t(language, "client.purchaseTable.sum")} className="client-purchase-table__num client-purchase-table__sum num">
        <b>{clientPriceLabel(row, currency, { gross: true, language })}</b>
      </td>
      <td data-label={t(language, "client.purchaseTable.status")} className="client-purchase-table__status">
        <Chip kind={getPurchaseStatusTone(status)} dot={isPurchaseStatusNeedsAttention(status)}>
          {tStatus(language, status) === status ? resolveClientPurchaseStatusLabel(row) : tStatus(language, status)}
        </Chip>
      </td>
      {!compact && (
        <td data-label={t(language, "client.purchaseTable.supplier")} className="client-purchase-table__supplier">
          {row.supplier || "—"}
        </td>
      )}
      <td data-label={t(language, "client.purchaseTable.actions")} className="client-purchase-table__actions">
        {row.link && (
          <a href={row.link} target="_blank" rel="noreferrer" className="btn btn-sm client-purchase-table__link">
            {t(language, "client.purchaseTable.link")}
          </a>
        )}
        {!bought ? (
          <ClientStatusActions language={language} status={status} onStatusChange={onStatus} onNeedReplacement={onReplacement} />
        ) : (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onStatus("not_bought")}>
            {t(language, "client.purchaseTable.revert")}
          </button>
        )}
      </td>
    </tr>
  );
}

function ItemTableRow({ it, currency, patch, bought, onProposeReplacement, compact, language, clientToken = "" }) {
  const [showPhoto, setShowPhoto] = useState(false);
  const photoUrl = clientPhotoSrc(it, clientToken);
  const hasPhoto = !!photoUrl;
  const img = !compact || showPhoto ? photoUrl : "";

  return (
    <tr className={bought ? "client-purchase-table__row--bought" : ""}>
      {!compact && (
        <td data-label={t(language, "client.purchaseTable.photo")} className="client-purchase-table__photo">
          {img ? (
            <img src={img} alt="" className="client-purchase-table__thumb" loading="lazy" />
          ) : (
            <span className="client-purchase-table__thumb client-purchase-table__thumb--letter">
              {(it.name || "?").trim().charAt(0).toUpperCase()}
            </span>
          )}
        </td>
      )}
      <td data-label={t(language, "client.purchaseTable.name")} className="client-purchase-table__name">
        <div className="client-purchase-table__name-main">
          {it.name}
          {compact && hasPhoto && (
            <button
              type="button"
              className="btn btn-sm btn-ghost client-purchase-table__photo-btn"
              onClick={() => setShowPhoto((v) => !v)}
            >
              {t(language, showPhoto ? "client.purchaseTable.hidePhoto" : "client.purchaseTable.showPhoto")}
            </button>
          )}
        </div>
        {compact && showPhoto && img && (
          <img src={img} alt="" className="client-purchase-table__inline-photo" loading="lazy" />
        )}
        {!compact && materialSpecLabel(it) && <div className="client-purchase-table__spec">{materialSpecLabel(it)}</div>}
        {!compact && it.clientNote && <div className="client-admin-note client-purchase-table__note">{it.clientNote}</div>}
      </td>
      <td data-label={t(language, "client.purchaseTable.qty")} className="client-purchase-table__num">
        <span className="client-qty-badge" title={t(language, "client.purchaseTable.qtyTitle")}>
          <span className="num">{num(it.qty)}</span>
          <span className="client-qty-badge__unit">{tUnit(language, it.unit || "шт.")}</span>
        </span>
      </td>
      <td data-label={t(language, "client.purchaseTable.price")} className="client-purchase-table__num num">
        {clientPriceLabel(it, currency, { language })}
      </td>
      <td data-label={t(language, "client.purchaseTable.sum")} className="client-purchase-table__num client-purchase-table__sum num">
        <b>{clientPriceLabel(it, currency, { gross: true, language })}</b>
      </td>
      <td data-label={t(language, "client.purchaseTable.status")} className="client-purchase-table__status">
        <Chip kind={getPurchaseStatusTone(it.status)} dot={isPurchaseStatusNeedsAttention(it.status)}>
          {tStatus(language, it.status) === it.status ? resolveClientPurchaseStatusLabel(it) : tStatus(language, it.status)}
        </Chip>
      </td>
      {!compact && (
        <td data-label={t(language, "client.purchaseTable.supplier")} className="client-purchase-table__supplier">
          {it.supplier || "—"}
        </td>
      )}
      <td data-label={t(language, "client.purchaseTable.actions")} className="client-purchase-table__actions">
        {it.link && (
          <a href={it.link} target="_blank" rel="noreferrer" className="btn btn-sm client-purchase-table__link">
            {t(language, "client.purchaseTable.link")}
          </a>
        )}
        {!bought ? (
          <ClientStatusActions
            language={language}
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
            {t(language, "client.purchaseTable.revert")}
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
  language = "ru",
  clientToken = "",
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
            {!compact && <th aria-label={t(language, "client.purchaseTable.photo")} />}
            <th>{t(language, "client.purchaseTable.name")}</th>
            <th>{t(language, "client.purchaseTable.qty")}</th>
            <th>{t(language, "client.purchaseTable.price")}</th>
            <th>{t(language, "client.purchaseTable.sum")}</th>
            <th>{t(language, "client.purchaseTable.status")}</th>
            {!compact && <th className="client-purchase-table__col-supplier">{t(language, "client.purchaseTable.supplier")}</th>}
            <th>{t(language, "client.purchaseTable.actions")}</th>
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
                  language={language}
                  clientToken={clientToken}
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
                  language={language}
                  clientToken={clientToken}
                />
              ))}
        </tbody>
      </table>
    </div>
  );
}
