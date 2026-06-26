import React, { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

const DEFAULT_THRESHOLD = 48;

/** Прокси-ref для scroll-контейнеров по ключу (модуль спецификации и т.п.). */
export function scrollRefFor(refs, key) {
  return {
    get current() {
      return refs.current[key] || null;
    },
  };
}

function rowIdFromSpecRow(row) {
  const id = row?.props?.id;
  if (typeof id === "string" && id.startsWith("spec-item-")) return id.slice("spec-item-".length);
  return null;
}

/**
 * Виртуализация строк <tbody>: при count < threshold рендерит все строки как обычно.
 * scrollParentRef — внешний scroll-контейнер (например .table-scroll-wrap); иначе свой div.
 */
export default function VirtualTbody({
  count,
  threshold = DEFAULT_THRESHOLD,
  estimateSize = 88,
  maxHeight = "min(70vh, 720px)",
  colSpan = 1,
  scrollParentRef,
  className = "",
  renderRow,
  scrollToKey,
  rowIds,
  bodyRows,
}) {
  const ownScrollRef = useRef(null);
  const scrollRef = scrollParentRef || ownScrollRef;
  const virtualize = count >= threshold;

  const ids =
    rowIds ||
    (bodyRows ? bodyRows.map((row) => rowIdFromSpecRow(row)) : Array.from({ length: count }, () => null));

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateSize,
    overscan: 12,
  });

  useEffect(() => {
    if (!scrollToKey || !virtualize || count < threshold) return;
    const idx = ids.findIndex((id) => id === scrollToKey);
    if (idx < 0) return;
    virtualizer.scrollToIndex(idx, { align: "center" });
    const t = window.setTimeout(() => {
      const el = document.getElementById(`spec-item-${scrollToKey}`);
      if (!el) return;
      el.classList.add("spec-row--highlight");
      window.setTimeout(() => el.classList.remove("spec-row--highlight"), 3500);
    }, 150);
    return () => window.clearTimeout(t);
  }, [scrollToKey, virtualize, count, threshold, ids, virtualizer]);

  if (!virtualize || count === 0) {
    return (
      <tbody>
        {Array.from({ length: count }, (_, i) => renderRow(i))}
      </tbody>
    );
  }

  const items = virtualizer.getVirtualItems();
  const padTop = items.length ? items[0].start : 0;
  const padBottom = items.length ? virtualizer.getTotalSize() - items[items.length - 1].end : 0;

  const body = (
    <tbody>
      {padTop > 0 && (
        <tr className="virtual-tbody-pad" aria-hidden>
          <td colSpan={colSpan} style={{ height: padTop, padding: 0, border: "none", background: "transparent" }} />
        </tr>
      )}
      {items.map((vi) => renderRow(vi.index))}
      {padBottom > 0 && (
        <tr className="virtual-tbody-pad" aria-hidden>
          <td colSpan={colSpan} style={{ height: padBottom, padding: 0, border: "none", background: "transparent" }} />
        </tr>
      )}
    </tbody>
  );

  if (scrollParentRef) return body;

  return (
    <div
      ref={ownScrollRef}
      className={`virtual-tbody-scroll ${className}`}
      style={{ maxHeight, overflow: "auto", WebkitOverflowScrolling: "touch" }}
    >
      <table style={{ width: "100%" }}>{body}</table>
    </div>
  );
}
