import React, { useMemo, useState } from "react";
import { summarizeCoolingRooms } from "../lib/projectHqStats.js";
import { isCoolingSpecItem } from "../../shared/itemTypes.js";
import RoomCoolingSummary from "./RoomCoolingSummary.jsx";

/**
 * Компактный блок «Охлаждение и вентиляция» — свёрнут по умолчанию.
 */
export default function ProjectCoolingSummary({
  project,
  onOpenCalc,
  defaultOpen = false,
}) {
  const [open, setOpen] = useState(defaultOpen);

  const cooling = useMemo(() => summarizeCoolingRooms(project || {}), [project]);
  const acCount = useMemo(
    () => (project?.items || []).filter((it) => isCoolingSpecItem(it)).length,
    [project]
  );

  const empty = cooling.roomsWithCooling === 0;
  const summaryLine =
    cooling.roomsWithoutCooling > 0
      ? `Охлаждение: не рассчитано для ${cooling.roomsWithoutCooling} комнат`
      : cooling.label;

  return (
    <section className="project-cooling card no-print" aria-label="Охлаждение и вентиляция">
      <div className="project-cooling__head between wrap" style={{ gap: 8 }}>
        <div>
          <strong className="project-cooling__title">Охлаждение и вентиляция</strong>
          <div className="project-cooling__summary muted" style={{ fontSize: 12, marginTop: 4 }}>
            <span>{summaryLine}</span>
            <span> · Кондиционеры: {acCount} позиций</span>
          </div>
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          {onOpenCalc ? (
            <button type="button" className="btn btn-sm" onClick={onOpenCalc}>
              Открыть расчёт
            </button>
          ) : null}
          {empty ? (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => {
                if (onOpenCalc) onOpenCalc();
                else setOpen(true);
              }}
            >
              Заполнить расчёт
            </button>
          ) : (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen((v) => !v)}>
              {open ? "Свернуть" : "Показать детали"}
            </button>
          )}
        </div>
      </div>

      {open && !empty ? (
        <div className="project-cooling__body" style={{ marginTop: 10 }}>
          <RoomCoolingSummary project={project} forceOpen />
        </div>
      ) : null}
    </section>
  );
}
