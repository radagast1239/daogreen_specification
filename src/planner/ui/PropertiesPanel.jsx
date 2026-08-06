import React, { useState, useEffect } from "react";
import { areaM2, LINK_RULES, layerById, catalogByKind } from "../catalog.js";
import {
  parseLengthInput,
  formatLiveLength,
  resolveLengthEditAnchor,
} from "../core/walls/liveWallMeasurements.js";
import {
  resolveCatalogKind,
  getRackFootprintPresets,
  getTankFootprintPresets,
  getFootprintPresetsForKind,
} from "../plannerMaterialPresets.js";
import { ZONE_FLOW, itemPowerW, panelCapacityW, zoneForItem } from "../farmRules.js";
import { formatZoneAreaM2 } from "../roomZones.js";
import {
  ROOM_CATEGORIES,
  ROOM_CATEGORY_LABELS,
  roomCategoryColor,
} from "../core/rooms/categories.js";
import { formatRoomHeightLabel, formatRoomAreaLabel } from "../core/rooms/format.js";
import { formatSocketHeightLabel } from "../farmObjects.js";
import {
  RACK_TYPES, RACK_PURPOSES, isRackKind, computeGrowAreaM2, nextRackNumber, nextRowLabel,
  rackIconForType, computeRackWeightKg, computeFloorLoadKgM2,
} from "../rackProperties.js";
import {
  STROKE_STYLES, ROUTING_HEIGHTS, LINE_TRAFFIC_TYPES,
  resolveLineVisual, linePlanLengthMm, lineTotalLengthMm,
} from "../lineProperties.js";
import { isPipeLine, calculatePipeLength, resolvePipeLabel } from "../pipes.js";
import { isPowerLine, calculatePowerLineLength } from "../electrical.js";
import { isDuctLine, calculateDuctLength, calculateRoomAirExchange, calculateRoomVolume } from "../climate.js";
import { isDoorKind, doorStyle, isOpeningKind } from "../doorTypes.js";
import { openingStyle } from "../openingTypes.js";
import { WALL_KINDS, THICKNESS_SIDES } from "../wallTypes.js";
import { projectSectionTemplates } from "../specSync.js";
import { collectPlannerWarnings } from "../geometry.js";
import { linkLengthMm, linksForItem, resolveLinkColor } from "../linkGeometry.js";
import {
  LABEL_DISPLAY_MODES, LABEL_AUDIENCES, LABEL_FONT_SIZES, DEFAULT_LABEL_FONT_PT,
  buildItemLabelLines, resolveItemLabelPlacement, resolveLabelAnchor, autoCalloutPlacement, itemAnchor,
} from "../labelProperties.js";
import { LINK_TYPE_OPTIONS } from "../linkRules.js";
import {
  OBJECT_STATUSES,
  PORT_TYPES,
  PORT_SIDES,
  defaultServiceZone,
  serviceZoneProfile,
  resolveServiceZone,
} from "../objectProperties.js";
import { isAcWallUnit, acMountHeightPlanLabel } from "../acProperties.js";
import { isTankKind, formatTankPlanSize } from "../tankProperties.js";
import {
  DEFAULT_DUCT_SIZE_H_MM,
  DEFAULT_DUCT_SIZE_W_MM,
  formatDuctSizeLabel,
} from "../ventDuctRender.jsx";

export function PropertiesPanel({
  tab: tabProp,
  onTabChange,
  sel,
  selObj,
  selection,
  plan,
  project,
  active,
  materials,
  modules,
  updateObj,
  rotateItem,
  delSel,
  onGroup,
  onUngroup,
  fmtU,
  onSync,
  specSummary,
  allWarnings = [],
  onFocusWarning,
  onClose,
  onSelectLink,
  onFit,
  planLevel,
  onApplyExactLength = null,
}) {
  const [tabLocal, setTabLocal] = useState("props");
  const tab = tabProp ?? tabLocal;
  const setTab = onTabChange ?? setTabLocal;
  const warnings = allWarnings.length ? allWarnings : collectPlannerWarnings(plan, sel);
  const objWarnings = sel?.id
    ? warnings.filter((w) => w.objectIds?.includes(sel.id) || (sel.coll === "lines" && w.id?.includes(sel.id)))
    : warnings;
  const summary = specSummary || { objects: 0, lines: 0, links: 0, linked: 0, kitObjects: 0 };

  const headTitle = panelHeadTitle(sel, selObj, selection, plan);
  const headSub = panelHeadSub(sel, selObj);

  return (
    <aside className="planner-side planner-side--right no-print">
      <div className="planner-props-head">
        <div className="planner-props-head__main">
          <div className="planner-props-head__title">{headTitle}</div>
          {headSub && <div className="planner-props-head__sub">{headSub}</div>}
        </div>
        {onClose && (
          <button type="button" className="planner-props-head__close" onClick={onClose} title="??????? ??????">
            �
          </button>
        )}
      </div>
      <div className="planner-props-tabs">
        {[
          { id: "props", label: "????????" },
          { id: "spec", label: "????????????" },
          { id: "links", label: "?????" },
          { id: "errors", label: `??????${warnings.length ? ` (${warnings.length})` : ""}` },
          { id: "comments", label: "???????????" },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            className={"planner-props-tab" + (tab === t.id ? " planner-props-tab--active" : "")}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="planner-side__scroll">
        {tab === "errors" && (
          <ErrorsTab
            warnings={sel?.id ? objWarnings : warnings}
            filterLabel={sel?.id ? "?????? ??? ?????????? ???????" : "??? ?????????????? ?????"}
            onFocus={onFocusWarning}
          />
        )}

        {tab === "links" && (
          <LinksTab sel={sel} selObj={selObj} plan={plan} fmtU={fmtU} onSelectLink={onSelectLink} />
        )}

        {tab === "comments" && (
          <CommentsTab sel={sel} selObj={selObj} updateObj={updateObj} />
        )}

        {tab === "spec" && (
          <div>
            <div className="planner-side__title">????? ?? ?????????????</div>
            <div style={{ fontSize: 12, color: "var(--pl-text-muted)", marginBottom: 12 }}>
              <div>???????: <b>{summary.objects}</b></div>
              <div>??????: <b>{summary.lines}</b></div>
              <div>?????: <b>{summary.links ?? 0}</b></div>
              <div>??????? ? ?????: <b>{summary.linked}</b></div>
            </div>
            <button type="button" className="planner-btn planner-btn--primary" style={{ width: "100%" }} onClick={onSync} disabled={!onSync}>
              {onSync ? "???????? ???????????? ?? ?????" : "????? ???? ???????"}
            </button>
            {selObj && sel?.coll === "items" && (
              <ItemSpecFields
                obj={selObj}
                updateObj={updateObj}
                materials={materials}
                modules={modules}
                projectItems={project.items || []}
              />
            )}
          </div>
        )}

        {tab === "props" && !selObj && selection?.coll === "items" && selection.ids.length > 1 && (
          <div>
            <div className="planner-side__title">???????? ????????: {selection.ids.length}</div>
            <p style={{ fontSize: 12, color: "var(--pl-text-muted)", marginBottom: 12 }}>
              ??????????? ??????, ??????????? (Ctrl+G) ??? ???????? (Del).
            </p>
            <div className="planner-row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="planner-btn planner-btn--primary" onClick={onGroup}>?????????????</button>
              <button type="button" className="planner-btn" onClick={onUngroup}>???????????????</button>
              <button type="button" className="planner-btn" onClick={delSel}>??????? ???</button>
            </div>
          </div>
        )}

        {tab === "props" && !selObj && !(selection?.coll === "items" && selection.ids.length > 1) && (
          <div className="planner-empty-props">
            <p className="planner-empty-props__title">????</p>
            <p>???????? ?????, ??????, ????? ??? ?????? ? ???????? ???????? ?????.</p>
            <ul className="planner-empty-props__hints">
              <li>????? ? ?????????? ?????</li>
              <li>Esc ? ????????? ? ??????</li>
              <li>Fit ? ???????? ???? ????</li>
            </ul>
            <div className="planner-empty-props__meta">
              <div>????: <b>{active}</b></div>
              {planLevel != null && planLevel !== "" && <div>???????: <b>{planLevel}</b></div>}
              <div>??????? ???????: <b>{plan.room.w} � {plan.room.h} ??</b></div>
              <div>???????: {areaM2(plan.room.w, plan.room.h)} ?�</div>
              <div>????: {plan.walls.length} � ????????: {plan.items.length}</div>
            </div>
            {onFit && (
              <div className="planner-empty-props__actions">
                <button type="button" className="planner-btn planner-btn--primary" onClick={onFit}>
                  ???????? ???? ????
                </button>
              </div>
            )}
          </div>
        )}

        {tab === "props" && selObj && (
          <SelFields
            sel={sel}
            selection={selection}
            obj={selObj}
            plan={plan}
            updateObj={updateObj}
            rotateItem={rotateItem}
            delSel={delSel}
            fmtU={fmtU}
            active={active}
          />
        )}
      </div>
    </aside>
  );
}

function SelFields({ sel, selection, obj, plan, updateObj, rotateItem, delSel, fmtU, active }) {
  if (!sel?.coll || !obj) return null;
  if (sel.coll === "item-label") {
    const lines = buildItemLabelLines(obj, plan);
    const place = resolveItemLabelPlacement(obj, plan.room);
    return (
      <>
        <div className="planner-side__title">??????? ???????</div>
        <div className="planner-field">
          <label>??????</label>
          <input readOnly value={obj.label || catalogByKind(obj.kind)?.label || obj.id} />
        </div>
        <div className="planner-field">
          <label>????? ?? ?????</label>
          <textarea readOnly rows={3} value={lines.join("\n")} />
        </div>
        {place && (
          <div className="planner-row">
            <div className="planner-field">
              <label>X, ??</label>
              <input readOnly value={Math.round(place.x)} />
            </div>
            <div className="planner-field">
              <label>Y, ??</label>
              <input readOnly value={Math.round(place.y)} />
            </div>
          </div>
        )}
        <p style={{ fontSize: 12, color: "var(--pl-text-muted)", margin: "0 0 10px" }}>
          ?????????? ??????? ?? ????? � Del ? ?????? � ??????? ? ?????
        </p>
        {obj.labelPinned && (
          <button
            type="button"
            className="planner-btn"
            onClick={() => updateObj("items", obj.id, {
              labelPinned: false,
              labelOffsetX: null,
              labelOffsetY: null,
            })}
          >
            ???????????
          </button>
        )}
        <button type="button" className="planner-btn" onClick={delSel}>?????? ???????</button>
      </>
    );
  }
  if (sel.coll === "labels") {
    const tgt = obj.targetId ? plan.items.find((i) => i.id === obj.targetId) : null;
    return (
      <>
        <div className="planner-side__title">???????</div>
        {tgt && (
          <div className="planner-field">
            <label>????????</label>
            <input readOnly value={tgt.label || tgt.id} />
          </div>
        )}
        <div className="planner-field">
          <label>?????</label>
          <textarea rows={4} value={obj.text} onChange={(e) => updateObj("labels", obj.id, { text: e.target.value })} />
        </div>
        <div className="planner-field">
          <label>?????? ??????, pt</label>
          <select
            value={obj.fontSizePt ?? DEFAULT_LABEL_FONT_PT}
            onChange={(e) => updateObj("labels", obj.id, { fontSizePt: +e.target.value })}
          >
            {LABEL_FONT_SIZES.map((pt) => (
              <option key={pt} value={pt}>{pt}</option>
            ))}
          </select>
        </div>
        <div className="planner-field">
          <label>?????????</label>
          <select value={obj.audience || "internal"} onChange={(e) => updateObj("labels", obj.id, { audience: e.target.value })}>
            {LABEL_AUDIENCES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </div>
        <label className="planner-chk">
          <input
            type="checkbox"
            checked={obj.pinned === true}
            onChange={(e) => updateObj("labels", obj.id, { pinned: e.target.checked })}
          />
          {" "}????????????? ?????????
        </label>
        {tgt && !obj.pinned && (
          <button
            type="button"
            className="planner-btn"
            onClick={() => {
              const anchor = resolveLabelAnchor(obj, tgt) || itemAnchor(tgt);
              const box = autoCalloutPlacement(anchor, plan.room, tgt);
              updateObj("labels", obj.id, {
                x: box.x,
                y: box.y,
                offsetX: box.x - anchor.x,
                offsetY: box.y - anchor.y,
              });
            }}
          >
            ???????? ???????
          </button>
        )}
        <button type="button" className="planner-btn" onClick={delSel}>???????</button>
      </>
    );
  }
  if (sel.coll === "zones") {
    const auto = obj.auto !== false;
    const heightMm = obj.heightMm || obj.height || plan.room?.defaultRoomHeightMm || plan.room?.height || 3000;
    const climateRoom = {
      areaMm2: obj.areaMm2 || ((+formatZoneAreaM2(obj) || 0) * 1_000_000),
      areaM2: +formatZoneAreaM2(obj) || 0,
      heightMm,
      targetAirChanges: obj.targetAirChanges,
      airChanges: obj.targetAirChanges,
    };
    const roomVolumeM3 = calculateRoomVolume(climateRoom);
    const roomExchange = calculateRoomAirExchange(climateRoom);
    return (
      <>
        <div className="planner-side__title">{obj.name || "?????????"}</div>
        <p style={{ fontSize: 12, color: "var(--pl-text-muted)", margin: "0 0 10px" }}>
          ????????????? ?? ????????? ???????????. ???? ?? ??????? ??? ???? ? ????? ?????????.
        </p>
        <div className="planner-field">
          <label>????????</label>
          <input value={obj.name || ""} onChange={(e) => updateObj("zones", obj.id, { name: e.target.value, auto: true })} />
        </div>
        <div className="planner-field">
          <label>?????????</label>
          <select value={obj.category || "other"} onChange={(e) => updateObj("zones", obj.id, { category: e.target.value })}>
            {ROOM_CATEGORIES.map((id) => (
              <option key={id} value={id}>{ROOM_CATEGORY_LABELS[id] || id}</option>
            ))}
          </select>
        </div>
        <div className="planner-field">
          <label>?????? ?????????, ??</label>
          <input
            type="number"
            min={1200}
            value={heightMm}
            onChange={(e) => updateObj("zones", obj.id, {
              heightMm: Math.max(1200, +e.target.value || 0),
              height: Math.max(1200, +e.target.value || 0),
            })}
          />
          <p className="planner-hint" style={{ margin: "4px 0 0", fontSize: 11, color: "var(--pl-text-muted)" }}>
            {formatRoomHeightLabel(heightMm)}
          </p>
        </div>
        <div className="planner-field">
          <label>???????</label>
          <input readOnly value={formatRoomAreaLabel(obj.areaMm2 || ((+formatZoneAreaM2(obj) || 0) * 1_000_000))} />
        </div>
        <div className="planner-field">
          <label>???? ????</label>
          <input
            type="color"
            value={obj.fillColor || obj.zoneColor || roomCategoryColor(obj.category || "other")}
            onChange={(e) => updateObj("zones", obj.id, {
              fillColor: e.target.value,
              zoneColor: e.target.value,
            })}
          />
        </div>
        <div className="planner-row">
          <div className="planner-field">
            <label>????????????? ????</label>
            <input value={obj.climateZone || ""} onChange={(e) => updateObj("zones", obj.id, { climateZone: e.target.value })} />
          </div>
          <div className="planner-field">
            <label>?????????? ????</label>
            <input value={obj.sanitationZone || ""} onChange={(e) => updateObj("zones", obj.id, { sanitationZone: e.target.value })} />
          </div>
        </div>
        <div className="planner-side__title" style={{ marginTop: 12 }}>?????? ????</div>
        <div className="planner-row">
          <div className="planner-field">
            <label>Target Temperature, �C</label>
            <input
              type="number"
              value={obj.targetTemperatureC ?? ""}
              onChange={(e) => updateObj("zones", obj.id, { targetTemperatureC: e.target.value === "" ? null : +e.target.value })}
            />
          </div>
          <div className="planner-field">
            <label>Target RH, %</label>
            <input
              type="number"
              value={obj.targetRh ?? ""}
              onChange={(e) => updateObj("zones", obj.id, { targetRh: e.target.value === "" ? null : +e.target.value })}
            />
          </div>
        </div>
        <div className="planner-row">
          <div className="planner-field">
            <label>Target CO?, ppm</label>
            <input
              type="number"
              value={obj.targetCo2Ppm ?? ""}
              onChange={(e) => updateObj("zones", obj.id, { targetCo2Ppm: e.target.value === "" ? null : +e.target.value })}
            />
          </div>
          <div className="planner-field">
            <label>Air Changes, 1/?</label>
            <input
              type="number"
              step="0.1"
              value={obj.targetAirChanges ?? ""}
              onChange={(e) => updateObj("zones", obj.id, { targetAirChanges: e.target.value === "" ? null : +e.target.value })}
            />
          </div>
        </div>
        <div className="planner-field">
          <label>Air Velocity, ?/?</label>
          <input
            type="number"
            step="0.1"
            value={obj.targetAirVelocityMs ?? ""}
            onChange={(e) => updateObj("zones", obj.id, { targetAirVelocityMs: e.target.value === "" ? null : +e.target.value })}
          />
        </div>
        <div className="planner-field">
          <label>?????? ?????? / ?????????????</label>
          <input readOnly value={`V=${roomVolumeM3.toFixed(2)} ?3 � ACH=${roomExchange.airChanges} � Q=${roomExchange.requiredAirflowM3h.toFixed(2)} ?3/?`} />
        </div>
        <div className="planner-field">
          <label>??????????</label>
          <textarea rows={3} value={obj.notes || ""} onChange={(e) => updateObj("zones", obj.id, { notes: e.target.value })} />
        </div>
        <div className="planner-field">
          <label className="planner-chk">
            <input type="checkbox" checked={obj.showName !== false} onChange={(e) => updateObj("zones", obj.id, { showName: e.target.checked })} />
            {" "}?????????? ????????
          </label>
        </div>
        <div className="planner-field">
          <label className="planner-chk">
            <input type="checkbox" checked={obj.showArea !== false} onChange={(e) => updateObj("zones", obj.id, { showArea: e.target.checked })} />
            {" "}?????????? ???????
          </label>
        </div>
        {!auto && (
          <button type="button" className="planner-btn" onClick={delSel}>???????</button>
        )}
      </>
    );
  }
  if (sel.coll === "lines") {
    const vis = resolveLineVisual(obj);
    const pipeLine = isPipeLine(obj);
    const powerLine = isPowerLine(obj);
    const ductLine = isDuctLine(obj);
    const planLen = pipeLine
      ? calculatePipeLength(obj).planMm
      : ductLine
        ? calculateDuctLength(obj)
        : linePlanLengthMm(obj.pts);
    const totalLen = pipeLine
      ? calculatePipeLength(obj).withReserveM * 1000
      : powerLine
        ? calculatePowerLineLength(obj) * 1.15
        : ductLine
          ? calculateDuctLength(obj) * (1 + (obj.reservePct ?? 10) / 100)
        : lineTotalLengthMm(obj);
    const from = plan.items.find((i) => i.id === obj.fromItemId);
    const to = plan.items.find((i) => i.id === obj.toItemId);
    return (
      <>
        <div className="planner-side__title">{vis.label || "??????"}</div>
        <div className="planner-field">
          <label>????</label>
          <input readOnly value={layerById(obj.layer)?.name || obj.layer} />
        </div>
        {pipeLine && (
          <>
            <div className="planner-row">
              <div className="planner-field">
                <label>???????</label>
                <input
                  value={obj.pipeSystem || ""}
                  onChange={(e) => updateObj("lines", obj.id, { pipeSystem: e.target.value })}
                />
              </div>
              <div className="planner-field">
                <label>????</label>
                <input
                  value={obj.pipeRole || ""}
                  onChange={(e) => updateObj("lines", obj.id, { pipeRole: e.target.value })}
                />
              </div>
            </div>
            <div className="planner-row">
              <div className="planner-field">
                <label>???????, ??</label>
                <input
                  type="number"
                  min={8}
                  value={obj.diameterMm ?? 32}
                  onChange={(e) => updateObj("lines", obj.id, { diameterMm: Math.max(8, +e.target.value || 32) })}
                />
              </div>
              <div className="planner-field">
                <label>????????</label>
                <input
                  value={obj.material || "pp"}
                  onChange={(e) => updateObj("lines", obj.id, { material: e.target.value })}
                />
              </div>
            </div>
            {(obj.layer === "drain" || obj.pipeSystem === "drainage" || obj.pipeSystem === "waste") && (
              <div className="planner-field">
                <label>?????, %</label>
                <input
                  type="number"
                  step="0.1"
                  value={obj.slopePercent ?? ""}
                  onChange={(e) => updateObj("lines", obj.id, { slopePercent: e.target.value === "" ? null : +e.target.value })}
                />
              </div>
            )}
            <div className="planner-field">
              <label>??????? ?????</label>
              <input readOnly value={resolvePipeLabel(obj)} />
            </div>
          </>
        )}
        {powerLine && (
          <>
            <div className="planner-row">
              <div className="planner-field">
                <label>??? ?????</label>
                <select value={obj.lineType || "wall_cable"} onChange={(e) => updateObj("lines", obj.id, { lineType: e.target.value })}>
                  <option value="wall_cable">?? ?????</option>
                  <option value="ceiling_cable">?? ???????</option>
                  <option value="floor_cable">?? ????</option>
                  <option value="cable_tray">? ?????</option>
                  <option value="sensor_wire">??????/??????????</option>
                </select>
              </div>
              <div className="planner-field">
                <label>??????</label>
                <input value={obj.groupName || ""} placeholder="A/B/C/D/E" onChange={(e) => updateObj("lines", obj.id, { groupName: e.target.value })} />
              </div>
            </div>
            <div className="planner-row">
              <div className="planner-field">
                <label>??????</label>
                <input value={obj.cableType || "?????-LS"} onChange={(e) => updateObj("lines", obj.id, { cableType: e.target.value })} />
              </div>
              <div className="planner-field">
                <label>????????, ??</label>
                <input type="number" value={obj.powerW || 0} onChange={(e) => updateObj("lines", obj.id, { powerW: Math.max(0, +e.target.value || 0) })} />
              </div>
            </div>
            <div className="planner-row">
              <div className="planner-field">
                <label>??????????, ?</label>
                <input type="number" value={obj.voltage || 220} onChange={(e) => updateObj("lines", obj.id, { voltage: Math.max(0, +e.target.value || 0) })} />
              </div>
              <div className="planner-field">
                <label>????</label>
                <input type="number" value={obj.phases || 1} onChange={(e) => updateObj("lines", obj.id, { phases: Math.max(1, +e.target.value || 1) })} />
              </div>
            </div>
          </>
        )}
        {ductLine && (
          <>
            <div className="planner-row">
              <div className="planner-field">
                <label>??? ???????????</label>
                <select value={obj.lineType || "duct"} onChange={(e) => updateObj("lines", obj.id, { lineType: e.target.value })}>
                  <option value="duct">????????</option>
                  <option value="supply_duct">??????</option>
                  <option value="exhaust_duct">???????</option>
                  <option value="recirculation_duct">????????????</option>
                  <option value="airflow_arrow">??????? ??????</option>
                </select>
              </div>
              <div className="planner-field">
                <label>???????, ??</label>
                <input type="number" value={obj.diameterMm || 250} onChange={(e) => updateObj("lines", obj.id, { diameterMm: Math.max(80, +e.target.value || 80) })} />
              </div>
            </div>
            <div className="planner-row">
              <div className="planner-field">
                <label>??????, ?3/?</label>
                <input type="number" value={obj.airflowM3h || 0} onChange={(e) => updateObj("lines", obj.id, { airflowM3h: Math.max(0, +e.target.value || 0) })} />
              </div>
              <div className="planner-field">
                <label>???????????</label>
                <select value={obj.flowDirection || "forward"} onChange={(e) => updateObj("lines", obj.id, { flowDirection: e.target.value })}>
                  <option value="forward">??????</option>
                  <option value="reverse">???????</option>
                </select>
              </div>
            </div>
          </>
        )}
        {obj.layer === "vent" ? (
          <>
            <div className="planner-row">
              <div className="planner-field">
                <label>?????? ???????, ??</label>
                <input
                  type="number"
                  min={100}
                  step={10}
                  value={obj.ductSizeWmm ?? DEFAULT_DUCT_SIZE_W_MM}
                  onChange={(e) => updateObj("lines", obj.id, { ductSizeWmm: Math.max(100, +e.target.value || DEFAULT_DUCT_SIZE_W_MM) })}
                />
              </div>
              <div className="planner-field">
                <label>?????? ???????, ??</label>
                <input
                  type="number"
                  min={50}
                  step={10}
                  value={obj.ductSizeHmm ?? DEFAULT_DUCT_SIZE_H_MM}
                  onChange={(e) => updateObj("lines", obj.id, { ductSizeHmm: Math.max(50, +e.target.value || DEFAULT_DUCT_SIZE_H_MM) })}
                />
              </div>
            </div>
            <div className="planner-field">
              <label>??????? ?? ?????</label>
              <input readOnly value={formatDuctSizeLabel(obj.ductSizeWmm, obj.ductSizeHmm)} />
            </div>
          </>
        ) : (
          <div className="planner-field">
            <label>????? ?????</label>
            <select value={obj.strokeStyle || "solid"} onChange={(e) => updateObj("lines", obj.id, { strokeStyle: e.target.value })}>
              {Object.entries(STROKE_STYLES).map(([id, s]) => (
                <option key={id} value={id}>{s.label}</option>
              ))}
            </select>
          </div>
        )}
        {obj.layer === "staff" && (
          <div className="planner-field">
            <label>?????????? ????????</label>
            <select value={obj.traffic || ""} onChange={(e) => updateObj("lines", obj.id, { traffic: e.target.value })}>
              {LINE_TRAFFIC_TYPES.map((t) => (
                <option key={t.id || "none"} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
        )}
        <div className="planner-field">
          <label>?????? ?????????</label>
          <select value={obj.routingHeight || "floor"} onChange={(e) => updateObj("lines", obj.id, { routingHeight: e.target.value })}>
            {ROUTING_HEIGHTS.map((h) => (
              <option key={h.id} value={h.id}>{h.label}</option>
            ))}
          </select>
        </div>
        <div className="planner-row">
          <div className="planner-field">
            <label>????? ?????</label>
            <input readOnly value={fmtU(planLen)} />
          </div>
          <div className="planner-field">
            <label>?????, %</label>
            <input type="number" value={obj.reservePct ?? 10} onChange={(e) => updateObj("lines", obj.id, { reservePct: Math.max(0, +e.target.value || 0) })} />
          </div>
        </div>
        <div className="planner-field">
          <label>????? ? ???????</label>
          <input readOnly value={fmtU(totalLen)} />
        </div>
        {pipeLine && (
          <div className="planner-field">
            <label>????? ? ???????????? (?)</label>
            <input readOnly value={calculatePipeLength(obj).withReserveRoundedM.toFixed(1)} />
          </div>
        )}
        {powerLine && (
          <div className="planner-field">
            <label>?????? ? ???????????? (?)</label>
            <input readOnly value={(Math.round((calculatePowerLineLength(obj) / 1000) * 1.15 * 100) / 100).toFixed(2)} />
          </div>
        )}
        {ductLine && (
          <div className="planner-field">
            <label>?????????? ? ???????????? (?)</label>
            <input readOnly value={(Math.round((calculateDuctLength(obj) / 1000) * (1 + (obj.reservePct ?? 10) / 100) * 100) / 100).toFixed(2)} />
          </div>
        )}
        <div className="planner-field">
          <label>???? ?????</label>
          <input type="color" value={obj.color || vis.color} onChange={(e) => updateObj("lines", obj.id, { color: e.target.value })} />
        </div>
        <div className="planner-row">
          <div className="planner-field">
            <label>???????</label>
            <input type="number" step="0.5" value={obj.strokeW ?? ""} placeholder={String(vis.w)} onChange={(e) => updateObj("lines", obj.id, { strokeW: e.target.value ? +e.target.value : null })} />
          </div>
        </div>
        {obj.layer !== "vent" && (
          <label className="planner-chk">
            <input type="checkbox" checked={obj.showArrows !== false} onChange={(e) => updateObj("lines", obj.id, { showArrows: e.target.checked })} />
            {" "}??????? ???????????
          </label>
        )}
        <label className="planner-chk">
          <input type="checkbox" checked={obj.orthoRoute !== false} onChange={(e) => updateObj("lines", obj.id, { orthoRoute: e.target.checked })} />
          {" "}????????????? ??????????? (90�)
        </label>
        <div className="planner-field">
          <label>?? ???????</label>
          <input readOnly value={from?.label || "?"} />
        </div>
        <div className="planner-field">
          <label>? ???????</label>
          <input readOnly value={to?.label || "?"} />
        </div>
        <button type="button" className="planner-btn" onClick={delSel}>???????</button>
      </>
    );
  }
  if (sel.coll === "links") {
    const rule = LINK_RULES[obj.type] || { label: "?????", color: "#5a5f5c" };
    const from = plan.items.find((i) => i.id === obj.fromId);
    const to = plan.items.find((i) => i.id === obj.toId);
    const len = linkLengthMm(obj, plan.items, plan.room);
    const color = resolveLinkColor(obj);
    return (
      <>
        <div className="planner-side__title">{rule.label}</div>
        <div className="planner-field">
          <label>??? ?????</label>
          <select
            value={obj.type || "irrigation"}
            onChange={(e) => updateObj("links", obj.id, { type: e.target.value, color: LINK_RULES[e.target.value]?.color || null })}
          >
            {LINK_TYPE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="planner-field">
          <label>??</label>
          <input readOnly value={from?.label || "?"} />
        </div>
        <div className="planner-field">
          <label>?</label>
          <input readOnly value={to?.label || "?"} />
        </div>
        <div className="planner-field">
          <label>????, ??</label>
          <input readOnly value={Math.round(len.plan2d)} />
        </div>
        <div className="planner-field">
          <label>??????, ??</label>
          <input
            type="number"
            value={obj.riseMm ?? len.vertical}
            onChange={(e) => updateObj("links", obj.id, { riseMm: Math.max(0, +e.target.value || 0) })}
          />
        </div>
        <div className="planner-field">
          <label>?????</label>
          <input readOnly value={fmtU(len.total)} />
        </div>
        <div className="planner-field">
          <label>????</label>
          <input
            type="color"
            value={color}
            onChange={(e) => updateObj("links", obj.id, { color: e.target.value })}
          />
        </div>
        <div className="planner-field">
          <label>???????????</label>
          <input
            value={obj.comment || ""}
            onChange={(e) => updateObj("links", obj.id, { comment: e.target.value })}
          />
        </div>
        <div className="planner-field">
          <label>
            <input type="checkbox" checked={obj.ortho !== false} onChange={(e) => updateObj("links", obj.id, { ortho: e.target.checked })} />
            {" "}????????????? ???????
          </label>
        </div>
        <div className="planner-field">
          <label>
            <input type="checkbox" checked={obj.visible !== false} onChange={(e) => updateObj("links", obj.id, { visible: e.target.checked })} />
            {" "}?????????? ?? ?????
          </label>
        </div>
        <button type="button" className="planner-btn" onClick={delSel}>??????? ?????</button>
      </>
    );
  }
  if (sel.coll === "dimensions") {
    const modeLabel = obj.mode === "angle" ? "???????" : obj.mode === "diagonal" ? "????????????" : "????????";
    const kindLabel = obj.auto ? "????" : (obj.kind || "manual");
    const status = obj.invalid
      ? "????? ?????????????? ? ????????? ????????"
      : null;
    const stylePreset = obj.style?.importance || "normal";
    const persisted = (plan.dimensions || []).some((d) => d.id === obj.id);
    const editable = persisted && !obj.auto && !obj.locked;
    return (
      <>
        <div className="planner-side__title">??????</div>
        <div className="planner-field">
          <label>???</label>
          <input value={`${modeLabel} (${kindLabel})`} readOnly />
        </div>
        {status && (
          <div className="planner-field" style={{ color: "#a33", fontSize: 12 }}>{status}</div>
        )}
        {!persisted && (
          <div className="planner-field" style={{ fontSize: 12, opacity: 0.75 }}>
            ?????????????? ?????? ? ?????? ??????? ??????????.
          </div>
        )}
        <div className="planner-field">
          <label>????? / ???????</label>
          <input
            value={obj.labelOverride ?? ""}
            placeholder="????"
            disabled={!editable}
            onChange={(e) => updateObj("dimensions", obj.id, { labelOverride: e.target.value || null })}
          />
        </div>
        {obj.mode !== "angle" && (
          <div className="planner-field">
            <label>??????, ??</label>
            <input
              type="number"
              step={10}
              value={Number.isFinite(obj.offset) ? obj.offset : 120}
              disabled={!editable}
              onChange={(e) => updateObj("dimensions", obj.id, { offset: Number(e.target.value) || 0 })}
            />
          </div>
        )}
        <div className="planner-field">
          <label>
            <input
              type="checkbox"
              checked={obj.visible !== false}
              disabled={!editable}
              onChange={(e) => updateObj("dimensions", obj.id, { visible: e.target.checked })}
            />
            {" "}??????????
          </label>
        </div>
        <div className="planner-field">
          <label>????? ?????</label>
          <select
            value={stylePreset}
            disabled={!editable}
            onChange={(e) => {
              const importance = e.target.value;
              updateObj("dimensions", obj.id, {
                style: {
                  ...(obj.style || {}),
                  importance: importance === "normal" ? undefined : importance,
                },
              });
            }}
          >
            <option value="normal">???????</option>
            <option value="important">??????</option>
            <option value="error">?????? / review</option>
          </select>
        </div>
        {editable && (
          <button type="button" className="planner-btn" onClick={delSel}>??????? ??????</button>
        )}
        {obj.auto && (
          <div className="planner-field" style={{ fontSize: 12, opacity: 0.75 }}>
            ?????????????? ?????? ????????? ?????? ? ?????????? ??? ????????? auto.
          </div>
        )}
      </>
    );
  }
  if (sel.coll === "walls") {
    return (
      <WallLengthProps
        obj={obj}
        plan={plan}
        selection={selection}
        updateObj={updateObj}
        delSel={delSel}
        onApplyExactLength={onApplyExactLength}
      />
    );
  }
  if (sel.coll === "items") {
    const dStyle = isDoorKind(obj.kind) ? doorStyle(obj.kind) : null;
    const oStyle = isOpeningKind(obj.kind) ? openingStyle(obj.kind) : null;
    return (
      <>
        <div className="planner-side__title">{obj.label}</div>
        {dStyle && (
          <p style={{ fontSize: 12, color: "var(--pl-text-muted)", margin: "0 0 10px" }}>
            ???: <b style={{ color: dStyle.accent || dStyle.color }}>{dStyle.label}</b>
          </p>
        )}
        {oStyle && (
          <p style={{ fontSize: 12, color: "var(--pl-text-muted)", margin: "0 0 10px" }}>
            ???: <b style={{ color: oStyle.accent || oStyle.color }}>{oStyle.label}</b>
          </p>
        )}
        <div className="planner-field">
          <label>????????</label>
          <input value={obj.label} onChange={(e) => updateObj("items", obj.id, { label: e.target.value })} />
        </div>
        <div className="planner-field">
          <label>?????????</label>
          <input readOnly value={zoneForItem(plan, obj)?.name || obj.zoneName || "? ??? ????????? ?"} />
        </div>
        {obj.type === "farm_object" && (
          <FarmObjectFields obj={obj} updateObj={updateObj} />
        )}
        {isRackKind(obj.kind) && (
          <RackPropertyFields obj={obj} plan={plan} updateObj={updateObj} />
        )}
        {isAcWallUnit(obj.kind) && (
          <>
            <div className="planner-side__title" style={{ marginTop: 12 }}>??????? ?????</div>
            <div className="planner-row">
              <div className="planner-field">
                <label>??????, ??</label>
                <input
                  type="number"
                  value={obj.w}
                  onChange={(e) => updateObj("items", obj.id, { w: Math.max(400, +e.target.value || 0) })}
                />
              </div>
              <div className="planner-field">
                <label>??????? ?? ?????, ??</label>
                <input
                  type="number"
                  value={obj.h}
                  onChange={(e) => updateObj("items", obj.id, { h: Math.max(80, +e.target.value || 0) })}
                />
              </div>
            </div>
            <div className="planner-field">
              <label>?????? ?? ????, ??</label>
              <input
                type="number"
                min={0}
                value={obj.mountHeightMm ?? 2100}
                onChange={(e) => updateObj("items", obj.id, { mountHeightMm: Math.max(0, +e.target.value || 0) })}
              />
              {acMountHeightPlanLabel(obj.mountHeightMm ?? 2100) && (
                <p className="planner-hint" style={{ margin: "4px 0 0", fontSize: 11, color: "var(--pl-text-muted)" }}>
                  ?? ?????: {acMountHeightPlanLabel(obj.mountHeightMm ?? 2100)} (?? ?? ????)
                </p>
              )}
            </div>
          </>
        )}
        {isTankKind(obj.kind) && (
          <>
            <div className="planner-side__title" style={{ marginTop: 12 }}>??????? ???????</div>
            <div className="planner-field">
              <label>??????? ???????</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {getTankFootprintPresets().map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className="planner-btn planner-btn--sm"
                    onClick={() => updateObj("items", obj.id, { w: p.w, h: p.h })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="planner-row">
              <div className="planner-field">
                <label>??????, ??</label>
                <input
                  type="number"
                  min={400}
                  value={obj.w}
                  onChange={(e) => updateObj("items", obj.id, { w: Math.max(400, +e.target.value || 0) })}
                />
              </div>
              <div className="planner-field">
                <label>???????, ??</label>
                <input
                  type="number"
                  min={400}
                  value={obj.h}
                  onChange={(e) => updateObj("items", obj.id, { h: Math.max(400, +e.target.value || 0) })}
                />
              </div>
            </div>
            <div className="planner-field">
              <label>?? ????? (??)</label>
              <input readOnly value={formatTankPlanSize(obj.w, obj.h)} />
            </div>
          </>
        )}
        {isDoorKind(obj.kind) && (
          <>
            <div className="planner-field">
              <label>?????</label>
              <input value={obj.doorNum || ""} placeholder="?01" onChange={(e) => updateObj("items", obj.id, { doorNum: e.target.value })} />
            </div>
            <div className="planner-field">
              <label>?????, ??</label>
              <input type="number" value={obj.w} onChange={(e) => updateObj("items", obj.id, { w: Math.max(600, +e.target.value || 0) })} />
            </div>
            <div className="planner-field">
              <label>?????? ??????, ??</label>
              <input type="number" value={obj.doorHeightMm ?? 2100} onChange={(e) => updateObj("items", obj.id, { doorHeightMm: Math.max(1800, +e.target.value || 0) })} />
            </div>
            <div className="planner-field">
              <label>??????? ??????</label>
              <select value={obj.doorSwing || "left"} onChange={(e) => updateObj("items", obj.id, { doorSwing: e.target.value })}>
                <option value="left">?????</option>
                <option value="right">??????</option>
              </select>
            </div>
            <div className="planner-field">
              <label>
                <input type="checkbox" checked={obj.doorOpenIn !== false} onChange={(e) => updateObj("items", obj.id, { doorOpenIn: e.target.checked })} />
                {" "}?????????? ?????? ?????????
              </label>
            </div>
            {obj.kind !== "door_slide" && (
              <label className="planner-chk">
                <input
                  type="checkbox"
                  checked={(obj.serviceZone || defaultServiceZone(obj.kind)).enabled !== false}
                  onChange={(e) => updateObj("items", obj.id, {
                    serviceZone: { ...(obj.serviceZone || defaultServiceZone(obj.kind)), enabled: e.target.checked, swing: true },
                  })}
                />
                {" "}?????????? ???? ??????????
              </label>
            )}
          </>
        )}
        {isOpeningKind(obj.kind) && (
          <>
            <div className="planner-field">
              <label>?????</label>
              <input value={obj.openingNum || ""} placeholder="?01" onChange={(e) => updateObj("items", obj.id, { openingNum: e.target.value })} />
            </div>
            <div className="planner-field">
              <label>?????, ??</label>
              <input type="number" value={obj.w} onChange={(e) => updateObj("items", obj.id, { w: Math.max(300, +e.target.value || 0) })} />
            </div>
            <div className="planner-field">
              <label>?????? ??????, ??</label>
              <input type="number" value={obj.openingHeightMm ?? 1200} onChange={(e) => updateObj("items", obj.id, { openingHeightMm: Math.max(200, +e.target.value || 0) })} />
            </div>
            <div className="planner-field">
              <label>?????? ?? ????, ??</label>
              <input type="number" value={obj.openingSillMm ?? 900} onChange={(e) => updateObj("items", obj.id, { openingSillMm: Math.max(0, +e.target.value || 0) })} />
            </div>
            <div className="planner-field">
              <label>?????</label>
              <select value={obj.openingShape || "rect"} onChange={(e) => updateObj("items", obj.id, { openingShape: e.target.value })}>
                <option value="rect">?????????????</option>
                <option value="arch">???????</option>
              </select>
            </div>
          </>
        )}
        {!isDoorKind(obj.kind) && !isOpeningKind(obj.kind) && (
        <div className="planner-side__title" style={{ marginTop: 12 }}>??????? ? ???????</div>
        )}
        {(isDoorKind(obj.kind) || isOpeningKind(obj.kind)) && (
        <div className="planner-side__title" style={{ marginTop: 12 }}>???????</div>
        )}
        <div className="planner-row">
          <div className="planner-field">
            <label>X, ??</label>
            <input type="number" value={Math.round(obj.x)} onChange={(e) => updateObj("items", obj.id, { x: +e.target.value || 0 })} />
          </div>
          <div className="planner-field">
            <label>Y, ??</label>
            <input type="number" value={Math.round(obj.y)} onChange={(e) => updateObj("items", obj.id, { y: +e.target.value || 0 })} />
          </div>
        </div>
        {!isDoorKind(obj.kind) && !isOpeningKind(obj.kind) && !isAcWallUnit(obj.kind) && !isTankKind(obj.kind) && !isRackKind(obj.kind) && (
          <FootprintPresetChips
            kind={obj.kind}
            onApply={(p) => updateObj("items", obj.id, { w: p.w, h: p.h })}
          />
        )}
        {!isDoorKind(obj.kind) && !isOpeningKind(obj.kind) && !isAcWallUnit(obj.kind) && !isTankKind(obj.kind) && (
        <div className="planner-row">
          <div className="planner-field">
            <label>??????, ??</label>
            <input type="number" value={obj.w} onChange={(e) => updateObj("items", obj.id, { w: Math.max(50, +e.target.value || 0) })} />
          </div>
          <div className="planner-field">
            <label>???????, ??</label>
            <input type="number" value={obj.h} onChange={(e) => updateObj("items", obj.id, { h: Math.max(50, +e.target.value || 0) })} />
          </div>
        </div>
        )}
        <div className="planner-field">
          <label>???????, �</label>
          <input
            type="range"
            min={0}
            max={359}
            value={obj.angle || 0}
            onChange={(e) => updateObj("items", obj.id, { angle: +e.target.value })}
            disabled={isDoorKind(obj.kind)}
          />
          <input
            type="number"
            min={0}
            max={359}
            value={obj.angle || 0}
            onChange={(e) => updateObj("items", obj.id, { angle: ((+e.target.value || 0) % 360 + 360) % 360 })}
            style={{ marginTop: 4 }}
            disabled={isDoorKind(obj.kind)}
          />
        </div>
        {obj.params?.tiers && (
          <div className="planner-field">
            <label>??????</label>
            <input type="number" value={obj.params.tiers} onChange={(e) => updateObj("items", obj.id, { params: { ...obj.params, tiers: +e.target.value || 1 } })} />
          </div>
        )}
        {obj.kind === "panel" && (
          <div className="planner-field">
            <label>??????? ????, ??</label>
            <input
              type="number"
              value={obj.powerW ?? panelCapacityW(obj)}
              onChange={(e) => updateObj("items", obj.id, { powerW: Math.max(1000, +e.target.value || 0) })}
            />
          </div>
        )}
        {(obj.kind === "rack" || obj.kind === "seed_rack" || obj.kind === "pump") && (
          <div className="planner-field">
            <label>????????, ??</label>
            <input
              type="number"
              value={obj.powerW ?? itemPowerW(obj)}
              onChange={(e) => updateObj("items", obj.id, { powerW: Math.max(0, +e.target.value || 0) })}
            />
          </div>
        )}
        <ItemPropertyFields obj={obj} plan={plan} updateObj={updateObj} fmtU={fmtU} hideComments hideMountHeight={isAcWallUnit(obj.kind)} />
        {!isDoorKind(obj.kind) && (
        <p style={{ fontSize: 12, color: "var(--pl-text-muted)", marginTop: 8 }}>
          [ ] ? ??????? 15� � Shift 90� � Alt 1� � ??????? ? ????? 50/500/10 ??
        </p>
        )}
        <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
          <button type="button" className="planner-btn" onClick={() => rotateItem(obj, 90)}>? 90�</button>
          <button type="button" className="planner-btn" onClick={delSel}>???????</button>
        </div>
      </>
    );
  }
  return null;
}

function FarmObjectFields({ obj, updateObj }) {
  const params = obj.params || {};
  const patchParams = (patch) => updateObj("items", obj.id, { params: { ...params, ...patch } });
  return (
    <>
      <div className="planner-side__title" style={{ marginTop: 12 }}>FarmObject</div>
      <div className="planner-row">
        <div className="planner-field">
          <label>?????????</label>
          <input readOnly value={obj.category || "custom"} />
        </div>
        <div className="planner-field">
          <label>??????</label>
          <input readOnly value={obj.subtype || obj.kind || ""} />
        </div>
      </div>
      <div className="planner-row">
        <div className="planner-field">
          <label>??????, ??</label>
          <input
            type="number"
            value={obj.widthMm ?? obj.w}
            onChange={(e) => updateObj("items", obj.id, {
              widthMm: Math.max(1, +e.target.value || 1),
              w: Math.max(1, +e.target.value || 1),
            })}
          />
        </div>
        <div className="planner-field">
          <label>???????, ??</label>
          <input
            type="number"
            value={obj.depthMm ?? obj.h}
            onChange={(e) => updateObj("items", obj.id, {
              depthMm: Math.max(1, +e.target.value || 1),
              h: Math.max(1, +e.target.value || 1),
            })}
          />
        </div>
      </div>
      {obj.category === "rack" && (
        <>
          <div className="planner-row">
            <div className="planner-field">
              <label>??? ????????</label>
              <input value={params.rackType || ""} onChange={(e) => patchParams({ rackType: e.target.value })} />
            </div>
            <div className="planner-field">
              <label>??????</label>
              <input
                type="number"
                value={params.levels ?? obj.tierCount ?? 5}
                onChange={(e) => patchParams({ levels: Math.max(1, +e.target.value || 1) })}
              />
            </div>
          </div>
          <div className="planner-row">
            <div className="planner-field">
              <label>????????</label>
              <input value={params.cropType || obj.culture || ""} onChange={(e) => patchParams({ cropType: e.target.value })} />
            </div>
            <div className="planner-field">
              <label>?????</label>
              <input value={params.irrigationType || ""} onChange={(e) => patchParams({ irrigationType: e.target.value })} />
            </div>
          </div>
          <div className="planner-field">
            <label>???? ?? ????, ??</label>
            <input
              type="number"
              value={params.lightingPerLevel ?? 1}
              onChange={(e) => patchParams({ lightingPerLevel: Math.max(0, +e.target.value || 0) })}
            />
          </div>
        </>
      )}
      {(obj.category === "pipe" || obj.category === "drain_pipe") && (
        <div className="planner-row">
          <div className="planner-field">
            <label>??? ?????</label>
            <input value={params.pipeType || "supply"} onChange={(e) => patchParams({ pipeType: e.target.value })} />
          </div>
          <div className="planner-field">
            <label>???????, ??</label>
            <input type="number" value={params.diameterMm || 32} onChange={(e) => patchParams({ diameterMm: Math.max(1, +e.target.value || 1) })} />
          </div>
        </div>
      )}
      {obj.category === "electrical_panel" && (
        <>
          <div className="planner-row">
            <div className="planner-field">
              <label>??? ????</label>
              <input value={params.panelType || "distribution"} onChange={(e) => patchParams({ panelType: e.target.value })} />
            </div>
            <div className="planner-field">
              <label>??????</label>
              <input value={params.groupName || "A"} onChange={(e) => patchParams({ groupName: e.target.value })} />
            </div>
          </div>
          <div className="planner-row">
            <div className="planner-field">
              <label>??????????, ?</label>
              <input type="number" value={params.voltage || 380} onChange={(e) => patchParams({ voltage: Math.max(0, +e.target.value || 0) })} />
            </div>
            <div className="planner-field">
              <label>????</label>
              <input type="number" value={params.phases || 3} onChange={(e) => patchParams({ phases: Math.max(1, +e.target.value || 1) })} />
            </div>
          </div>
          <div className="planner-row">
            <div className="planner-field">
              <label>????. ????????, ???</label>
              <input type="number" value={params.maxPowerKw || 0} onChange={(e) => patchParams({ maxPowerKw: Math.max(0, +e.target.value || 0) })} />
            </div>
            <div className="planner-field">
              <label>??????? ??????</label>
              <input value={params.protectionIp || "IP31"} onChange={(e) => patchParams({ protectionIp: e.target.value })} />
            </div>
          </div>
          <div className="planner-row">
            <div className="planner-field">
              <label>??????, ??</label>
              <input
                type="number"
                value={params.heightMm || obj.mountHeightMm || 1200}
                onChange={(e) => patchParams({ heightMm: Math.max(0, +e.target.value || 0) })}
              />
            </div>
            <div className="planner-field">
              <label>??????? ??????</label>
              <input readOnly value={formatSocketHeightLabel(params.heightMm || obj.mountHeightMm || 1200)} />
            </div>
          </div>
        </>
      )}
      {obj.category === "socket" && (
        <>
          <div className="planner-row">
            <div className="planner-field">
              <label>??? ???????</label>
              <input value={params.socketType || "standard_220"} onChange={(e) => patchParams({ socketType: e.target.value })} />
            </div>
            <div className="planner-field">
              <label>??????</label>
              <input value={params.groupName || "A"} onChange={(e) => patchParams({ groupName: e.target.value })} />
            </div>
          </div>
          <div className="planner-row">
            <div className="planner-field">
              <label>??????????, ?</label>
              <input type="number" value={params.voltage || 220} onChange={(e) => patchParams({ voltage: Math.max(0, +e.target.value || 0) })} />
            </div>
            <div className="planner-field">
              <label>????</label>
              <input type="number" value={params.phases || 1} onChange={(e) => patchParams({ phases: Math.max(1, +e.target.value || 1) })} />
            </div>
          </div>
          <div className="planner-row">
            <div className="planner-field">
              <label>????????, ??</label>
              <input type="number" value={params.powerW || 0} onChange={(e) => patchParams({ powerW: Math.max(0, +e.target.value || 0) })} />
            </div>
            <div className="planner-field">
              <label>IP</label>
              <input value={params.protectionIp || ""} onChange={(e) => patchParams({ protectionIp: e.target.value })} />
            </div>
          </div>
          <div className="planner-row">
            <div className="planner-field">
              <label>??????, ??</label>
              <input
                type="number"
                value={params.heightMm || obj.mountHeightMm || 1200}
                onChange={(e) => patchParams({ heightMm: Math.max(0, +e.target.value || 0) })}
              />
            </div>
            <div className="planner-field">
              <label>??????? ??????</label>
              <input readOnly value={formatSocketHeightLabel(params.heightMm || obj.mountHeightMm || 1200)} />
            </div>
          </div>
          <label className="planner-chk">
            <input
              type="checkbox"
              checked={params.waterproof === true}
              onChange={(e) => patchParams({ waterproof: e.target.checked })}
            />
            {" "}???????????????
          </label>
        </>
      )}
      {obj.category === "light" && (
        <>
          <div className="planner-row">
            <div className="planner-field">
              <label>??? ?????</label>
              <input value={params.lightType || "linear_100"} onChange={(e) => patchParams({ lightType: e.target.value })} />
            </div>
            <div className="planner-field">
              <label>??????</label>
              <input value={params.groupName || "D"} onChange={(e) => patchParams({ groupName: e.target.value })} />
            </div>
          </div>
          <div className="planner-row">
            <div className="planner-field">
              <label>?????, ??</label>
              <input type="number" value={params.lengthMm || 1000} onChange={(e) => patchParams({ lengthMm: Math.max(100, +e.target.value || 100) })} />
            </div>
            <div className="planner-field">
              <label>????????, ??</label>
              <input type="number" value={params.powerW || 0} onChange={(e) => patchParams({ powerW: Math.max(0, +e.target.value || 0) })} />
            </div>
          </div>
          <div className="planner-row">
            <div className="planner-field">
              <label>?? ????, ??</label>
              <input type="number" value={params.perLevel || 1} onChange={(e) => patchParams({ perLevel: Math.max(1, +e.target.value || 1) })} />
            </div>
            <div className="planner-field">
              <label>??????</label>
              <input type="number" value={params.levels || 1} onChange={(e) => patchParams({ levels: Math.max(1, +e.target.value || 1) })} />
            </div>
          </div>
          <div className="planner-field">
            <label>????????? ??????? (id)</label>
            <input value={params.linkedRackId || ""} onChange={(e) => patchParams({ linkedRackId: e.target.value || null })} />
          </div>
        </>
      )}
      {(obj.category === "air_conditioner" || obj.category === "indoor_unit" || obj.category === "outdoor_unit") && (
        <>
          <div className="planner-row">
            <div className="planner-field">
              <label>??????????, ???</label>
              <input type="number" value={params.coolingPowerKw || 0} onChange={(e) => patchParams({ coolingPowerKw: Math.max(0, +e.target.value || 0) })} />
            </div>
            <div className="planner-field">
              <label>??????, ???</label>
              <input type="number" value={params.heatingPowerKw || 0} onChange={(e) => patchParams({ heatingPowerKw: Math.max(0, +e.target.value || 0) })} />
            </div>
          </div>
          <div className="planner-row">
            <div className="planner-field">
              <label>??????, ?3/?</label>
              <input type="number" value={params.airflowM3h || 0} onChange={(e) => patchParams({ airflowM3h: Math.max(0, +e.target.value || 0) })} />
            </div>
            <div className="planner-field">
              <label>????????, ??</label>
              <input type="number" value={params.powerW || 0} onChange={(e) => patchParams({ powerW: Math.max(0, +e.target.value || 0) })} />
            </div>
          </div>
        </>
      )}
      {(obj.category === "fan" || obj.category === "circulation_fan" || obj.category === "supply" || obj.category === "exhaust") && (
        <div className="planner-row">
          <div className="planner-field">
            <label>??????, ?3/?</label>
            <input type="number" value={params.airflowM3h || 0} onChange={(e) => patchParams({ airflowM3h: Math.max(0, +e.target.value || 0) })} />
          </div>
          <div className="planner-field">
            <label>???????</label>
            <input type="number" value={params.diameter || 0} onChange={(e) => patchParams({ diameter: Math.max(0, +e.target.value || 0) })} />
          </div>
        </div>
      )}
      {obj.category === "dehumidifier" && (
        <div className="planner-row">
          <div className="planner-field">
            <label>??????????????????, ?/???</label>
            <input type="number" value={params.capacityLDay || 0} onChange={(e) => patchParams({ capacityLDay: Math.max(0, +e.target.value || 0) })} />
          </div>
          <div className="planner-field">
            <label>????????, ??</label>
            <input type="number" value={params.powerW || 0} onChange={(e) => patchParams({ powerW: Math.max(0, +e.target.value || 0) })} />
          </div>
        </div>
      )}
      {obj.category === "humidifier" && (
        <div className="planner-row">
          <div className="planner-field">
            <label>??????????????????, ?/?</label>
            <input type="number" value={params.capacityLh || 0} onChange={(e) => patchParams({ capacityLh: Math.max(0, +e.target.value || 0) })} />
          </div>
          <div className="planner-field">
            <label>????????, ??</label>
            <input type="number" value={params.powerW || 0} onChange={(e) => patchParams({ powerW: Math.max(0, +e.target.value || 0) })} />
          </div>
        </div>
      )}
      {(
        obj.category === "temperature_sensor"
        || obj.category === "humidity_sensor"
        || obj.category === "co2_sensor"
        || obj.category === "air_quality_sensor"
        || obj.category === "dew_point_sensor"
        || obj.category === "pressure_sensor"
      ) && (
        <div className="planner-row">
          <div className="planner-field">
            <label>??? ???????</label>
            <input value={params.sensorType || obj.category || ""} onChange={(e) => patchParams({ sensorType: e.target.value })} />
          </div>
          <div className="planner-field">
            <label>??. ???.</label>
            <input value={params.unit || ""} onChange={(e) => patchParams({ unit: e.target.value })} />
          </div>
        </div>
      )}
      {obj.category === "climate_controller" && (
        <div className="planner-row">
          <div className="planner-field">
            <label>Target T, �C</label>
            <input type="number" value={params.targetTemperatureC || 0} onChange={(e) => patchParams({ targetTemperatureC: +e.target.value || 0 })} />
          </div>
          <div className="planner-field">
            <label>Target RH, %</label>
            <input type="number" value={params.targetRh || 0} onChange={(e) => patchParams({ targetRh: +e.target.value || 0 })} />
          </div>
        </div>
      )}
    </>
  );
}

function ItemPropertyFields({ obj, plan, updateObj, fmtU, hideComments = false, hideMountHeight = false }) {
  const cat = catalogByKind(obj.kind);
  const layer = layerById(obj.layer);
  const room = zoneForItem(plan, obj);
  const sz = resolveServiceZone(obj);
  const patchSz = (p) => updateObj("items", obj.id, { serviceZone: { ...sz, ...p } });
  const profile = serviceZoneProfile(obj.kind);

  return (
    <>
      <div className="planner-side__title" style={{ marginTop: 12 }}>??????</div>
      <div className="planner-field">
        <label>???</label>
        <input readOnly value={cat?.label || obj.kind || "?"} />
      </div>
      <div className="planner-row">
        <div className="planner-field">
          <label>????</label>
          <input readOnly value={layer?.name || obj.layer || "?"} />
        </div>
        <div className="planner-field">
          <label>?????????</label>
          <input readOnly value={room?.name || "?"} />
        </div>
      </div>
      {obj.wallId && (
        <div className="planner-field">
          <label>?????</label>
          <input readOnly value={obj.wallId} />
        </div>
      )}

      <div className="planner-field">
        <label>??????? ?? ?????</label>
        <select
          value={obj.labelMode || ""}
          onChange={(e) => updateObj("items", obj.id, { labelMode: e.target.value || null })}
        >
          <option value="">?? ????????? ?????</option>
          {LABEL_DISPLAY_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </div>
      {!isDoorKind(obj.kind) && !isOpeningKind(obj.kind) && (
        <>
          <label className="planner-chk">
            <input
              type="checkbox"
              checked={obj.labelHidden !== true}
              onChange={(e) => updateObj("items", obj.id, { labelHidden: !e.target.checked })}
            />
            {" "}?????????? ???????
          </label>
          {obj.labelHidden && (
            <button
              type="button"
              className="planner-btn"
              style={{ marginTop: 6 }}
              onClick={() => updateObj("items", obj.id, { labelHidden: false })}
            >
              ???????? ???????
            </button>
          )}
          {obj.labelPinned && obj.labelHidden !== true && (
            <button
              type="button"
              className="planner-btn"
              style={{ marginTop: 6 }}
              onClick={() => updateObj("items", obj.id, {
                labelPinned: false,
                labelOffsetX: null,
                labelOffsetY: null,
              })}
            >
              ??????????? ???????
            </button>
          )}
        </>
      )}

      <div className="planner-side__title" style={{ marginTop: 12 }}>?????? ? ?????????</div>
      <div className="planner-field">
        <label>??????</label>
        <select
          value={obj.objectStatus || "draft"}
          onChange={(e) => {
            const objectStatus = e.target.value;
            updateObj("items", obj.id, {
              objectStatus,
              approved: objectStatus === "approved",
              includedInProject: objectStatus !== "excluded",
            });
          }}
        >
          {Object.entries(OBJECT_STATUSES).map(([id, s]) => (
            <option key={id} value={id}>{s.label}</option>
          ))}
        </select>
      </div>
      <label className="planner-chk">
        <input
          type="checkbox"
          checked={obj.includedInProject !== false}
          onChange={(e) => updateObj("items", obj.id, { includedInProject: e.target.checked })}
        />
        {" "}???????? ? ??????
      </label>
      <label className="planner-chk">
        <input
          type="checkbox"
          checked={obj.visibleToClient !== false}
          onChange={(e) => updateObj("items", obj.id, { visibleToClient: e.target.checked })}
        />
        {" "}???????? ???????
      </label>
      <label className="planner-chk">
        <input
          type="checkbox"
          checked={obj.locked === true}
          onChange={(e) => updateObj("items", obj.id, { locked: e.target.checked })}
        />
        {" "}????????????? ?? ?????
      </label>

      {!isDoorKind(obj.kind) && !isOpeningKind(obj.kind) && (
        <>
          <div className="planner-side__title" style={{ marginTop: 12 }}>????????? ? ????????</div>
          <div className="planner-row">
            {!hideMountHeight && (
              <div className="planner-field">
                <label>?????? ?? ????, ??</label>
                <input
                  type="number"
                  value={obj.mountHeightMm ?? 0}
                  onChange={(e) => updateObj("items", obj.id, { mountHeightMm: Math.max(0, +e.target.value || 0) })}
                />
              </div>
            )}
            <div className="planner-field">
              <label>?????? ???????, ??</label>
              <input
                type="number"
                value={obj.height ?? ""}
                placeholder={String(plan.room?.height || 3000)}
                onChange={(e) => updateObj("items", obj.id, { height: +e.target.value || 0 })}
              />
            </div>
          </div>
          <div className="planner-row">
            <div className="planner-field">
              <label>???, ??</label>
              <input
                type="number"
                value={obj.weightKg ?? ""}
                placeholder="?"
                onChange={(e) => updateObj("items", obj.id, { weightKg: e.target.value === "" ? "" : +e.target.value })}
              />
            </div>
            <div className="planner-field">
              <label>???????? ?? ???, ??</label>
              <input
                type="number"
                value={obj.floorLoadKg ?? ""}
                placeholder="?"
                onChange={(e) => updateObj("items", obj.id, { floorLoadKg: e.target.value === "" ? "" : +e.target.value })}
              />
            </div>
          </div>

          <div className="planner-side__title" style={{ marginTop: 12 }}>????????? ????</div>
          {profile && (
            <p className="planner-hint" style={{ margin: "0 0 8px", fontSize: 12, color: "#6d7772" }}>
              ???????: {profile.label}
              {profile.hints?.front ? ` � ${profile.hints.front}` : ""}
            </p>
          )}
          <label className="planner-chk">
            <input
              type="checkbox"
              checked={sz.enabled !== false}
              onChange={(e) => patchSz({
                enabled: e.target.checked,
                ...(e.target.checked ? defaultServiceZone(obj.kind) : {}),
              })}
            />
            {" "}?????????? ???? ????????????
          </label>
          {sz.enabled !== false && (
            <div className="planner-row">
              <div className="planner-field">
                <label>???????, ??</label>
                <input type="number" value={sz.front ?? 0} onChange={(e) => patchSz({ front: Math.max(0, +e.target.value || 0) })} />
              </div>
              <div className="planner-field">
                <label>?????, ??</label>
                <input type="number" value={sz.back ?? 0} onChange={(e) => patchSz({ back: Math.max(0, +e.target.value || 0) })} />
              </div>
            </div>
          )}
          {sz.enabled !== false && (
            <div className="planner-row">
              <div className="planner-field">
                <label>?????, ??</label>
                <input type="number" value={sz.left ?? 0} onChange={(e) => patchSz({ left: Math.max(0, +e.target.value || 0) })} />
              </div>
              <div className="planner-field">
                <label>??????, ??</label>
                <input type="number" value={sz.right ?? 0} onChange={(e) => patchSz({ right: Math.max(0, +e.target.value || 0) })} />
              </div>
            </div>
          )}
          <div className="planner-field">
            <label>???? ??????? ?????????, ??</label>
            <input
              type="number"
              value={obj.accessZoneMm ?? sz.access ?? 0}
              onChange={(e) => updateObj("items", obj.id, { accessZoneMm: Math.max(0, +e.target.value || 0) })}
            />
          </div>
          {(profile?.defaults?.flow != null || (sz.flow ?? 0) > 0) && (
            <div className="planner-field">
              <label>???? ?????? (????.), ??</label>
              <input type="number" value={sz.flow ?? 0} onChange={(e) => patchSz({ flow: Math.max(0, +e.target.value || 0) })} />
            </div>
          )}

          {(obj.ports?.length > 0) && (
            <>
              <div className="planner-side__title" style={{ marginTop: 12 }}>????? ???????????</div>
              {obj.ports.map((port, i) => (
                <div key={i} className="planner-row" style={{ marginBottom: 6 }}>
                  <div className="planner-field">
                    <label>{PORT_TYPES[port.type]?.label || port.type}</label>
                    <select
                      value={port.side || "back"}
                      onChange={(e) => {
                        const ports = [...obj.ports];
                        ports[i] = { ...ports[i], side: e.target.value };
                        updateObj("items", obj.id, { ports });
                      }}
                    >
                      {PORT_SIDES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}

      {!hideComments && (
        <>
          <div className="planner-side__title" style={{ marginTop: 12 }}>???????????</div>
          <div className="planner-field">
            <label>??????????</label>
            <textarea rows={2} value={obj.commentInternal || ""} onChange={(e) => updateObj("items", obj.id, { commentInternal: e.target.value })} />
          </div>
          <div className="planner-field">
            <label>???????</label>
            <textarea rows={2} value={obj.commentClient || ""} onChange={(e) => updateObj("items", obj.id, { commentClient: e.target.value })} />
          </div>
          <div className="planner-field">
            <label>??????????</label>
            <textarea rows={2} value={obj.commentInstall || ""} onChange={(e) => updateObj("items", obj.id, { commentInstall: e.target.value })} />
          </div>
        </>
      )}

      <div className="planner-side__title" style={{ marginTop: 12 }}>?????? ? ???????</div>
      <div className="planner-field">
        <label>???? (URL)</label>
        <input value={obj.photoUrl || ""} placeholder="https://?" onChange={(e) => updateObj("items", obj.id, { photoUrl: e.target.value })} />
      </div>
      <div className="planner-field">
        <label>??????</label>
        <input value={obj.externalUrl || ""} placeholder="https://?" onChange={(e) => updateObj("items", obj.id, { externalUrl: e.target.value })} />
      </div>
      <div className="planner-row">
        <div className="planner-field">
          <label>?????????</label>
          <input value={obj.supplier || ""} onChange={(e) => updateObj("items", obj.id, { supplier: e.target.value })} />
        </div>
        <div className="planner-field">
          <label>????, ?</label>
          <input type="number" value={obj.specPrice ?? ""} onChange={(e) => updateObj("items", obj.id, { specPrice: e.target.value })} />
        </div>
      </div>
      <div className="planner-row">
        <div className="planner-field">
          <label>???-??</label>
          <input type="number" value={obj.specQty ?? 1} onChange={(e) => updateObj("items", obj.id, { specQty: Math.max(0, +e.target.value || 0) })} />
        </div>
        <div className="planner-field">
          <label>??. ???.</label>
          <input value={obj.specUnit || "??."} onChange={(e) => updateObj("items", obj.id, { specUnit: e.target.value })} />
        </div>
      </div>
    </>
  );
}

function ItemLinksList({ itemId, plan, onSelectLink, clickable = false }) {
  const links = linksForItem(plan.links, itemId);
  if (!links.length) {
    return (
      <p style={{ fontSize: 12, color: "var(--pl-text-muted)", marginTop: 12 }}>
        ?????? ???. ?????????? �?????� ?? ????? ??????/?????????.
      </p>
    );
  }
  return (
    <div style={{ marginTop: 12 }}>
      <div className="planner-side__title">????? ???????</div>
      <ul className="planner-links-list">
        {links.map((l) => {
          const otherId = l.fromId === itemId ? l.toId : l.fromId;
          const other = plan.items.find((i) => i.id === otherId);
          const rule = LINK_RULES[l.type];
          const len = linkLengthMm(l, plan.items, plan.room);
          return (
            <li key={l.id}>
              {clickable ? (
                <button type="button" className="planner-link-row" onClick={() => onSelectLink?.(l.id, otherId)}>
                  <span>{rule?.label || l.type}: {l.fromId === itemId ? "?" : "?"} {other?.label || "?"}</span>
                  <span className="planner-link-row__meta">{Math.round(len.total)} ??</span>
                </button>
              ) : (
                <>
                  {rule?.label || l.type}: {l.fromId === itemId ? "?" : "?"} {other?.label || "?"}{" "}
                  <span style={{ color: "var(--pl-text-muted)" }}>({Math.round(len.total)} ??)</span>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function panelHeadTitle(sel, selObj, selection, plan) {
  if (selection?.coll === "items" && (selection.ids?.length || 0) > 1) {
    return `??????? ????????: ${selection.ids.length}`;
  }
  if (!selObj) return "???????? ?????";
  if (sel?.coll === "items") return selObj.label || catalogByKind(selObj.kind)?.label || "??????";
  if (sel?.coll === "walls") return selObj.role === "outer" ? "???????? ?????" : "???????????";
  if (sel?.coll === "zones") return selObj.name || "?????????";
  if (sel?.coll === "lines") return resolveLineVisual(selObj).label || "??????";
  if (sel?.coll === "links") return (LINK_RULES[selObj.type] || {}).label || "?????";
  if (sel?.coll === "labels") return "???????";
  if (sel?.coll === "item-label") return "??????? ???????";
  if (sel?.coll === "dimensions") return "??????";
  return "??????";
}

function panelHeadSub(sel, selObj) {
  if (!selObj || !sel?.coll) return null;
  if (sel.coll === "items") {
    const cat = catalogByKind(selObj.kind);
    return cat?.label || selObj.kind;
  }
  if (sel.coll === "walls") return WALL_KINDS[selObj.kind || "new"]?.label;
  if (sel.coll === "zones") return ROOM_CATEGORY_LABELS[selObj.category] || selObj.purpose || ZONE_FLOW[selObj.flow]?.label;
  if (sel.coll === "lines") return layerById(selObj.layer)?.name;
  if (sel.coll === "item-label") return catalogByKind(selObj.kind)?.label || selObj.kind;
  if (sel.coll === "dimensions") {
    if (selObj.mode === "angle") return "????";
    if (selObj.mode === "diagonal") return "?????????";
    return selObj.auto ? "????" : "????????";
  }
  return null;
}

function ErrorsTab({ warnings, filterLabel, onFocus }) {
  return (
    <div>
      <p className="planner-hint" style={{ margin: "0 0 10px", fontSize: 12, color: "var(--pl-text-muted)" }}>
        {filterLabel}. ???? ? ??????? ? ???????.
      </p>
      {warnings.length === 0 && (
        <div className="planner-empty-props">?????????????? ???</div>
      )}
      {warnings.map((w) => (
        <button
          key={w.id}
          type="button"
          className={"planner-warn planner-warn--clickable planner-warn--" + (w.severity || "warning")}
          onClick={() => onFocus?.(w)}
          disabled={!onFocus || (!w.objectIds?.length && !w.wallIds?.length)}
        >
          <span className="planner-warn__icon">{w.severity === "critical" ? "?" : w.severity === "info" ? "i" : "!"}</span>
          <span>{w.text}</span>
        </button>
      ))}
    </div>
  );
}

function LinksTab({ sel, selObj, plan, fmtU, onSelectLink }) {
  if (sel?.coll === "links" && selObj) {
    const from = plan.items.find((i) => i.id === selObj.fromId);
    const to = plan.items.find((i) => i.id === selObj.toId);
    const len = linkLengthMm(selObj, plan.items, plan.room);
    const rule = LINK_RULES[selObj.type];
    return (
      <>
        <div className="planner-side__title">{rule?.label || "?????"}</div>
        <div className="planner-field"><label>??</label><input readOnly value={from?.label || "?"} /></div>
        <div className="planner-field"><label>?</label><input readOnly value={to?.label || "?"} /></div>
        <div className="planner-field"><label>?????</label><input readOnly value={fmtU(len.total)} /></div>
        {selObj.comment && (
          <div className="planner-field"><label>???????????</label><input readOnly value={selObj.comment} /></div>
        )}
      </>
    );
  }
  if (sel?.coll === "items" && selObj) {
    return <ItemLinksList itemId={selObj.id} plan={plan} onSelectLink={onSelectLink} clickable />;
  }
  const all = plan.links || [];
  if (!all.length) {
    return <div className="planner-empty-props">?????? ?? ????? ???? ???</div>;
  }
  return (
    <div>
      <div className="planner-side__title">??? ????? ({all.length})</div>
      <ul className="planner-links-list">
        {all.map((l) => {
          const from = plan.items.find((i) => i.id === l.fromId);
          const to = plan.items.find((i) => i.id === l.toId);
          const rule = LINK_RULES[l.type];
          return (
            <li key={l.id}>
              <button type="button" className="planner-link-row" onClick={() => onSelectLink?.(l.id)}>
                <span>{rule?.label || l.type}: {from?.label || "?"} ? {to?.label || "?"}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CommentsTab({ sel, selObj, updateObj }) {
  if (sel?.coll !== "items" || !selObj) {
    return (
      <div className="planner-empty-props">
        ???????? ?????? ?? ?????, ????? ????????????? ??????????? ??? ???????, ??????? ? ?????????? ???????.
      </div>
    );
  }
  return (
    <>
      <div className="planner-side__title">{selObj.label}</div>
      <div className="planner-field">
        <label>?????????? ???????????</label>
        <textarea rows={4} value={selObj.commentInternal || ""} onChange={(e) => updateObj("items", selObj.id, { commentInternal: e.target.value })} />
      </div>
      <div className="planner-field">
        <label>??????????? ???????</label>
        <textarea rows={4} value={selObj.commentClient || ""} onChange={(e) => updateObj("items", selObj.id, { commentClient: e.target.value })} />
        <p className="planner-hint" style={{ fontSize: 11, margin: "4px 0 0", color: "var(--pl-text-muted)" }}>
          ?? ???????? ? ?????????? PDF, ???? ?????? ????? ?? ???????.
        </p>
      </div>
      <div className="planner-field">
        <label>??????????? ??????????</label>
        <textarea rows={4} value={selObj.commentInstall || ""} onChange={(e) => updateObj("items", selObj.id, { commentInstall: e.target.value })} />
      </div>
      <div className="planner-field">
        <label>??????????? ?? ????? / ??????</label>
        <p className="planner-hint" style={{ fontSize: 12, color: "var(--pl-text-muted)", margin: 0 }}>
          ??? ?????????? ?????? ???????? ??????? �?????� ??? ???????? ????? ?? ?????.
        </p>
      </div>
    </>
  );
}

function FootprintPresetChips({ kind, onApply }) {
  const presets = getFootprintPresetsForKind(kind);
  const def = resolveCatalogKind(kind);
  const chips = presets.length
    ? presets
    : [{ label: `${def.w}�${def.h}`, w: def.w, h: def.h }];
  if (!chips.length) return null;
  return (
    <div className="planner-field">
      <label>??????? ???????</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {chips.map((p) => (
          <button
            key={`${p.label}-${p.w}x${p.h}`}
            type="button"
            className="planner-btn planner-btn--sm"
            onClick={() => onApply(p)}
          >
            {p.label || `${p.w}�${p.h}`}
          </button>
        ))}
      </div>
    </div>
  );
}

function RackPropertyFields({ obj, plan, updateObj }) {
  const growArea = computeGrowAreaM2(obj);
  const weight = computeRackWeightKg(obj);
  const floorLoad = computeFloorLoadKgM2(obj);
  const applyPreset = (p) => {
    updateObj("items", obj.id, { w: p.w, h: p.h });
  };
  return (
    <>
      <div className="planner-side__title" style={{ marginTop: 12 }}>???????</div>
      <div className="planner-field">
        <label>??????? ???????</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {getRackFootprintPresets().map((p) => (
            <button
              key={`${p.w}x${p.h}`}
              type="button"
              className="planner-btn planner-btn--sm"
              onClick={() => applyPreset(p)}
            >
              {p.w}�{p.h}
            </button>
          ))}
        </div>
      </div>
      <div className="planner-row">
        <div className="planner-field">
          <label>?????</label>
          <input
            value={obj.rackNum || ""}
            placeholder={nextRackNumber(plan.items, obj.id)}
            onChange={(e) => updateObj("items", obj.id, { rackNum: e.target.value })}
          />
        </div>
        <div className="planner-field">
          <label>???</label>
          <input
            value={obj.rowNum || ""}
            placeholder={nextRowLabel(plan.items)}
            onChange={(e) => updateObj("items", obj.id, { rowNum: e.target.value })}
          />
        </div>
      </div>
      <div className="planner-field">
        <label>??? ???????</label>
        <select
          value={obj.rackType || "nft"}
          onChange={(e) => updateObj("items", obj.id, {
            rackType: e.target.value,
            icon: rackIconForType(e.target.value),
          })}
        >
          {RACK_TYPES.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
      </div>
      <div className="planner-field">
        <label>??????????</label>
        <select value={obj.rackPurpose || "production"} onChange={(e) => updateObj("items", obj.id, { rackPurpose: e.target.value })}>
          {RACK_PURPOSES.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </div>
      <div className="planner-row">
        <div className="planner-field">
          <label>?????, ??</label>
          <input type="number" value={obj.w} onChange={(e) => updateObj("items", obj.id, { w: Math.max(400, +e.target.value || 0) })} />
        </div>
        <div className="planner-field">
          <label>??????, ??</label>
          <input type="number" value={obj.h} onChange={(e) => updateObj("items", obj.id, { h: Math.max(300, +e.target.value || 0) })} />
        </div>
      </div>
      <div className="planner-field">
        <label>?????? ???????? H, ??</label>
        <input
          type="number"
          value={obj.rackHeightMm ?? 2400}
          onChange={(e) => updateObj("items", obj.id, { rackHeightMm: Math.max(1200, +e.target.value || 0) })}
        />
      </div>
      <div className="planner-row">
        <div className="planner-field">
          <label>??????</label>
          <input
            type="number"
            value={obj.tierCount ?? obj.params?.tiers ?? 5}
            onChange={(e) => {
              const tierCount = Math.max(1, +e.target.value || 1);
              updateObj("items", obj.id, {
                tierCount,
                params: { ...(obj.params || {}), tiers: tierCount },
              });
            }}
          />
        </div>
        <div className="planner-field">
          <label>??????? / ????</label>
          <input
            type="number"
            value={obj.channelCount ?? obj.params?.levels ?? 4}
            onChange={(e) => {
              const channelCount = Math.max(1, +e.target.value || 1);
              updateObj("items", obj.id, {
                channelCount,
                params: { ...(obj.params || {}), levels: channelCount },
              });
            }}
          />
        </div>
      </div>
      <div className="planner-row">
        <div className="planner-field">
          <label>??? ??????, ??</label>
          <input type="number" value={obj.tierSpacingMm ?? 400} onChange={(e) => updateObj("items", obj.id, { tierSpacingMm: Math.max(200, +e.target.value || 0) })} />
        </div>
        <div className="planner-field">
          <label>????????, ??</label>
          <input value={obj.plantCount ?? ""} onChange={(e) => updateObj("items", obj.id, { plantCount: e.target.value })} />
        </div>
      </div>
      <div className="planner-field">
        <label>????????</label>
        <input value={obj.culture || ""} placeholder="?????, ?????????" onChange={(e) => updateObj("items", obj.id, { culture: e.target.value })} />
      </div>
      <div className="planner-row">
        <div className="planner-field">
          <label>S ?????., ?�</label>
          <input
            value={obj.growAreaM2 ?? ""}
            placeholder={growArea}
            onChange={(e) => updateObj("items", obj.id, { growAreaM2: e.target.value })}
          />
        </div>
        <div className="planner-field">
          <label>?????? ????, ?/?</label>
          <input value={obj.waterFlowLh ?? ""} onChange={(e) => updateObj("items", obj.id, { waterFlowLh: e.target.value })} />
        </div>
      </div>
      <div className="planner-row">
        <div className="planner-field">
          <label>???????? ?????, ??</label>
          <input type="number" value={obj.lightPowerW ?? ""} onChange={(e) => updateObj("items", obj.id, { lightPowerW: Math.max(0, +e.target.value || 0) })} />
        </div>
        <div className="planner-field">
          <label>??? ? ?????, ??</label>
          <input
            value={obj.weightKg ?? ""}
            placeholder={String(weight)}
            onChange={(e) => updateObj("items", obj.id, { weightKg: e.target.value })}
          />
        </div>
      </div>
      <div className="planner-field">
        <label>???????? ?? ???</label>
        <input readOnly value={`~${floorLoad} ??/?� (??? ~${weight} ??)`} />
      </div>
      <p style={{ fontSize: 12, color: "var(--pl-text-muted)", margin: "4px 0 0" }}>
        S ?????. {growArea} ?� � ??? ? ??? ??? ????? � ?????: ????? / ????????? / ????
      </p>
    </>
  );
}

function polyLen(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return l;
}

function ItemSpecFields({ obj, updateObj, materials, modules, projectItems }) {
  const templates = projectSectionTemplates(projectItems);
  const activeModules = (modules || []).filter((m) => m.active !== false);
  return (
    <div style={{ marginTop: 16, borderTop: "1px solid var(--pl-border)", paddingTop: 12 }}>
      <div className="planner-side__title">?????? ? ????????????</div>
      <label className="planner-chk">
        <input type="checkbox" checked={obj.includedInProject !== false} onChange={(e) => updateObj("items", obj.id, { includedInProject: e.target.checked })} />
        ???????? ? ??????
      </label>
      <label className="planner-chk">
        <input type="checkbox" checked={obj.visibleToClient !== false} onChange={(e) => updateObj("items", obj.id, { visibleToClient: e.target.checked })} />
        ???????? ???????
      </label>
      <div className="planner-field">
        <label>?????? ?? ?????</label>
        <select
          value={obj.objectStatus || "draft"}
          onChange={(e) => updateObj("items", obj.id, { objectStatus: e.target.value, approved: e.target.value === "approved" })}
        >
          {Object.entries(OBJECT_STATUSES).map(([id, s]) => (
            <option key={id} value={id}>{s.label}</option>
          ))}
        </select>
      </div>
      <div className="planner-field">
        <label>????????</label>
        <select value={obj.specMode || "custom"} onChange={(e) => updateObj("items", obj.id, { specMode: e.target.value })}>
          <option value="projectSection">???????? ?? ???????</option>
          <option value="module">???????? ?? ??????</option>
          <option value="material">???? ????????</option>
          <option value="custom">?????? ???????</option>
        </select>
      </div>
      {(obj.specMode || "custom") === "projectSection" && (
        <div className="planner-field">
          <label>??????</label>
          <select value={obj.specSourceSection || ""} onChange={(e) => updateObj("items", obj.id, { specSourceSection: e.target.value })}>
            <option value="">??????????</option>
            {templates.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
          </select>
        </div>
      )}
      {(obj.specMode || "custom") === "module" && (
        <div className="planner-field">
          <label>??????</label>
          <select value={obj.specModuleName || ""} onChange={(e) => updateObj("items", obj.id, { specModuleName: e.target.value })}>
            <option value="">??????????</option>
            {activeModules.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
          </select>
        </div>
      )}
      <div className="planner-field">
        <label>?????????</label>
        <input type="number" value={obj.specQty ?? 1} onChange={(e) => updateObj("items", obj.id, { specQty: Math.max(0, Number(e.target.value) || 0) })} />
      </div>
    </div>
  );
}

function WallLengthProps({ obj, plan, selection, updateObj, delSel, onApplyExactLength }) {
  const segLen = obj.pts?.length >= 2
    ? Math.hypot(obj.pts[obj.pts.length - 1].x - obj.pts[obj.pts.length - 2].x, obj.pts[obj.pts.length - 1].y - obj.pts[obj.pts.length - 2].y)
    : 0;
  const anchor = resolveLengthEditAnchor(plan, obj.id, {
    selectedEndpoint: selection?.nodeIdx === 0 ? 0 : selection?.nodeIdx === 1 ? 1 : null,
  });
  const [draft, setDraft] = useState(String(Math.round(segLen)));
  const [error, setError] = useState(null);
  useEffect(() => {
    setDraft(String(Math.round(segLen)));
    setError(null);
  }, [obj.id, segLen]);

  const apply = () => {
    const parsed = parseLengthInput(draft);
    if (!parsed.ok) {
      setError(parsed.reason === "non_positive" ? "????? ?????? ???? ?????? ????." : "???????????? ???????? ?????.");
      return;
    }
    if (!anchor.ok) {
      setError(anchor.message || "????? ??????????.");
      return;
    }
    if (typeof onApplyExactLength === "function") {
      const r = onApplyExactLength(obj.id, parsed.mm, {
        selectedEndpoint: selection?.nodeIdx === 0 ? 0 : selection?.nodeIdx === 1 ? 1 : null,
      });
      if (r && r.ok === false) setError(r.message || "?? ??????? ???????? ?????.");
      else setError(null);
      return;
    }
    // Fallback when host does not wire apply: refuse silent no-op mutation.
    setError("?????? ????? ???????? ????? ????????? ????? (??????? ????).");
  };

  return (
    <>
      <div className="planner-side__title">{obj.role === "outer" ? "???????? ?????" : "???????????"}</div>
      <div className="planner-field">
        <label>???</label>
        <select value={obj.kind || "new"} onChange={(e) => updateObj("walls", obj.id, { kind: e.target.value })}>
          {Object.entries(WALL_KINDS).map(([id, k]) => (
            <option key={id} value={id}>{k.label}</option>
          ))}
        </select>
      </div>
      <div className="planner-field">
        <label>????</label>
        <select value={obj.role || "partition"} onChange={(e) => updateObj("walls", obj.id, { role: e.target.value })}>
          <option value="outer">????????</option>
          <option value="partition">???????????</option>
        </select>
      </div>
      <div className="planner-field">
        <label>???????, ??</label>
        <input type="number" min={0} value={obj.thk ?? 100} onChange={(e) => updateObj("walls", obj.id, { thk: Math.max(0, +e.target.value || 0) })} />
      </div>
      <div className="planner-field">
        <label>??????? ???????</label>
        <select value={obj.thicknessSide || "center"} onChange={(e) => updateObj("walls", obj.id, { thicknessSide: e.target.value })}>
          {THICKNESS_SIDES.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </div>
      <div className="planner-field">
        <label>??????, ??</label>
        <input type="number" min={0} value={obj.height ?? 2700} onChange={(e) => updateObj("walls", obj.id, { height: Math.max(0, +e.target.value || 0) })} />
      </div>
      <div className="planner-field">
        <label>????????</label>
        <input value={obj.material || ""} placeholder="??? / ???????" onChange={(e) => updateObj("walls", obj.id, { material: e.target.value })} />
      </div>
      <div className="planner-field">
        <label>????? ({formatLiveLength(segLen)})</label>
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          disabled={!anchor.ok}
          onChange={(e) => { setDraft(e.target.value); setError(null); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setDraft(String(Math.round(segLen)));
              setError(null);
            }
            if (e.key === "Enter") {
              e.preventDefault();
              apply();
            }
          }}
        />
      </div>
      {!anchor.ok && (
        <p style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>{anchor.message}</p>
      )}
      {error && (
        <p style={{ fontSize: 12, color: "#c0392b" }}>{error}</p>
      )}
      <p style={{ fontSize: 12, color: "var(--pl-text-muted)", marginTop: 8 }}>
        ?? (3000) ??? ? ? ???????? (3 ?). Enter ? ?????????, Escape ? ??????.
      </p>
      <button type="button" className="planner-btn" onClick={delSel}>???????</button>
    </>
  );
}
