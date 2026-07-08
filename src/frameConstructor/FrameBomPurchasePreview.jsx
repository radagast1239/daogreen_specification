import React from "react";
import {
  CRAB_PREVIEW_LABELS,
  PREVIEW_BANNER_TEXT,
  PREVIEW_FUTURE_NOTE,
  findMissingMaterialIds,
  formatTubeStockLines,
  groupPurchasePreviewItems,
  visiblePurchaseDraftItems,
} from "./frameBomPurchasePreviewData.js";

function PreviewLine({ label, qty, unit }) {
  return (
    <li className="fc-bom-preview__line">
      <span className="fc-bom-preview__name">{label}</span>
      <span className="fc-bom-preview__qty">
        — {qty} {unit}
      </span>
    </li>
  );
}

function PipeCutsList({ pipeCuts }) {
  if (!pipeCuts?.length) return null;
  return (
    <div className="fc-bom-preview__sub">
      <div className="fc-bom-preview__sub-title">Отрезки:</div>
      <ul className="fc-bom-preview__cuts">
        {pipeCuts.map((cut) => (
          <li key={`${cut.lengthMm}-${cut.qty}`}>
            {cut.lengthMm} мм × {cut.qty}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TechNote({ text }) {
  if (!text) return null;
  return <div className="fc-bom-preview__note muted">{text}</div>;
}

/**
 * @param {{ purchaseDraft: object[], constructionType?: string, stockRecommended?: object|null, warnings?: string[] }} props
 */
export default function FrameBomPurchasePreview({
  purchaseDraft = [],
  constructionType = "tube_crab",
  stockRecommended = null,
  warnings = [],
}) {
  const isAngle = constructionType === "perforated_angle";
  const visible = visiblePurchaseDraftItems(purchaseDraft);
  const groups = groupPurchasePreviewItems(purchaseDraft);
  const missingIds = findMissingMaterialIds(purchaseDraft);
  const stockLines = formatTubeStockLines(stockRecommended, isAngle);

  return (
    <section className="fc-bom-preview" aria-label="BOM каркаса для закупки">
      <h4 className="fc-bom-preview__title">BOM каркаса для закупки</h4>
      <p className="fc-bom-preview__banner">{PREVIEW_BANNER_TEXT}</p>
      <p className="fc-bom-preview__future muted">{PREVIEW_FUTURE_NOTE}</p>

      {warnings.length > 0 && (
        <div className="fc-bom-preview__warn" role="alert">
          {warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}

      {missingIds.length > 0 && (
        <div className="fc-bom-preview__warn" role="alert">
          {missingIds.map((key) => (
            <div key={key}>Не найден material_id для позиции {key}</div>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="fc-bom-preview__empty muted">Нет рассчитанных позиций BOM для закупки.</p>
      ) : (
        <div className="fc-bom-preview__body">
          {!isAngle && groups.tube.map((item) => (
            <div key={item.key} className="fc-bom-preview__block">
              <div className="fc-bom-preview__main-line">
                <strong>{item.name}</strong>
                <span> — {item.qty} {item.unit}</span>
              </div>
              <PipeCutsList pipeCuts={item.pipeCuts} />
              {stockRecommended?.title && (
                <TechNote
                  text={[
                    `Рекомендованный хлыст: ${stockRecommended.title}`,
                    ...stockLines,
                    item.techNote,
                  ]
                    .filter(Boolean)
                    .join(". ")}
                />
              )}
              {!stockRecommended?.title && <TechNote text={item.techNote} />}
            </div>
          ))}

          {!isAngle && groups.crabs.length > 0 && (
            <div className="fc-bom-preview__block">
              <div className="fc-bom-preview__sub-title">Крабы</div>
              <ul className="fc-bom-preview__list">
                {groups.crabs.map((item) => (
                  <PreviewLine
                    key={item.key}
                    label={CRAB_PREVIEW_LABELS[item.key] || item.name}
                    qty={item.qty}
                    unit={item.unit}
                  />
                ))}
              </ul>
            </div>
          )}

          {isAngle && groups.angleStock.length > 0 && (
            <div className="fc-bom-preview__block">
              <div className="fc-bom-preview__sub-title">Хлысты уголка</div>
              <ul className="fc-bom-preview__list">
                {groups.angleStock.map((item) => (
                  <PreviewLine
                    key={item.key}
                    label={item.name}
                    qty={item.qty}
                    unit={item.unit}
                  />
                ))}
              </ul>
              <TechNote text={groups.angleStock[0]?.techNote} />
            </div>
          )}

          {isAngle && groups.fasteners.length > 0 && (
            <div className="fc-bom-preview__block">
              <div className="fc-bom-preview__sub-title">Крепёж</div>
              <ul className="fc-bom-preview__list">
                {groups.fasteners.map((item) => (
                  <PreviewLine
                    key={item.key}
                    label={item.name}
                    qty={item.qty}
                    unit={item.unit}
                  />
                ))}
              </ul>
            </div>
          )}

          {groups.other.length > 0 && (
            <div className="fc-bom-preview__block">
              <ul className="fc-bom-preview__list">
                {groups.other.map((item) => (
                  <PreviewLine
                    key={item.key || item.materialId}
                    label={item.name}
                    qty={item.qty}
                    unit={item.unit}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
