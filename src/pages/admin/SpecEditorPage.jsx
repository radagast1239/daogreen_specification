import React, { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useStore } from "../../store/StoreContext.jsx";
import {
  projectTotals,
  projectStats,
  groupBy,
  mergedPurchaseList,
  money,
  num,
} from "../../store/helpers.js";
import { SPECIALIST_MAP } from "../../data/modules.js";
import { VAT_RATES, lineGross } from "../../lib/itemHelpers.js";
import { absolutePhotoUrl } from "../../lib/photoHelpers.js";
import { clientLink, photoSrc } from "../../lib/api.js";
import { PageHeader } from "../../components/Layout.jsx";
import { Progress, Stat, Empty, ClientLinkModal } from "../../components/ui.jsx";
import { downloadCSV } from "../../lib/export.js";
import CoolingFarmTab from "../../components/CoolingFarmTab.jsx";
import RoomsEditor from "../../components/RoomsEditor.jsx";
import { defaultRooms, isFarmGeneralItem, roomLabel } from "../../lib/roomHelpers.js";

export default function SpecEditorPage() {
  const { id } = useParams();
  const { state, actions } = useStore();
  const project = state.projects.find((p) => p.id === id);
  const [tab, setTab] = useState("spec");
  const [versionMsg, setVersionMsg] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);

  useEffect(() => {
    if (id) actions.loadProject(id);
  }, [id, actions]);

  if (!project) {
    return (
      <>
        <PageHeader title="Проект не найден" />
        <div className="content">
          <Empty title="Такого проекта нет" hint="Возможно он удалён.">
            <Link className="btn btn-primary" to="/">К проектам</Link>
          </Empty>
        </div>
      </>
    );
  }

  const totals = projectTotals(project);
  const stats = projectStats(project);

  const patchItem = (itemId, patch) => actions.itemUpdate(project.id, itemId, patch);

  const saveRooms = (rooms) => actions.projectUpdate(project.id, { rooms });

  const approveAll = async () => {
    await actions.approveAll(project.id);
    const v = await actions.createVersion(project.id);
    setVersionMsg(`Версия ${v.versionNumber} сохранена`);
  };

  const publishVersion = async () => {
    const v = await actions.createVersion(project.id);
    setVersionMsg(`Опубликована версия ${v.versionNumber}: Δ ${v.summary.delta} ₽`);
  };

  const exportSpec = () => {
    const rows = project.items.map((it) => ({
      Фото: absolutePhotoUrl(it.imageUrl || it.photoUrl),
      Модуль: it.module,
      Категория: it.category,
      Наименование: it.name,
      Ед: it.unit,
      Кол: it.qty,
      Цена: it.price,
      Сумма: Math.round((it.qty || 0) * (it.price || 0)),
      Ссылка: it.link,
      Видно: it.visible ? "да" : "нет",
      Утверждено: it.approved ? "да" : "нет",
    }));
    downloadCSV(`${project.name}_спецификация`, rows);
  };

  const url = project.clientToken ? clientLink(project.clientToken) : "";

  return (
    <>
      {linkOpen && url && <ClientLinkModal url={url} onClose={() => setLinkOpen(false)} />}
      <PageHeader
        title={project.name}
        sub={`${project.client || "—"}${project.city ? " · " + project.city : ""}${
          project.area ? " · " + project.area + " м²" : ""
        } · ${project.type}`}
        actions={
          <>
            <button className="btn" onClick={exportSpec}>Excel ↓</button>
            <button className="btn" onClick={publishVersion}>Утвердить версию</button>
            <button className="btn" onClick={approveAll}>Утвердить всё</button>
            <button className="btn btn-primary" disabled={!url} onClick={() => setLinkOpen(true)}>Ссылка клиенту</button>
          </>
        }
      />

      <div className="content">
        {/* Summary */}
        <div className="stat-grid" style={{ marginBottom: 18 }}>
          <Stat k="Без НДС" v={money(totals.budgetNet, project.currency)} />
          <Stat k="НДС" v={money(totals.vatAmount, project.currency)} />
          <Stat k="Итого" v={money(totals.budget, project.currency)} />
          <Stat k="Потрачено" v={money(totals.spent, project.currency)} />
          <div className="card stat">
            <div className="k">Прогресс</div>
            <div className="v num">{totals.progress}%</div>
            <div style={{ marginTop: 8 }}><Progress value={totals.progress} /></div>
          </div>
        </div>

        <div className="row wrap" style={{ gap: 14, marginBottom: 14, fontSize: 12.5 }}>
          <span className="muted">Позиций: <b className="num">{stats.total}</b></span>
          <span className="muted">Утверждено: <b className="num">{stats.approved}</b></span>
          <span className="muted">Скрыто: <b className="num">{stats.hidden}</b></span>
          {stats.noPrice > 0 && <span className="chip chip--amber chip-dot">без цены: {stats.noPrice}</span>}
          {stats.noLink > 0 && <span className="chip chip--neutral chip-dot">без ссылки: {stats.noLink}</span>}
        </div>

        {/* Tabs */}
        <div className="toolbar" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 0, gap: 0 }}>
          {[
            ["spec", "Спецификация"],
            ["merged", "Общий список"],
            ["spec_lists", "Специалисты"],
            ["calc", "Расчёт охлаждения ферма"],
          ].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className="btn btn-ghost"
              style={{
                borderRadius: 0,
                borderBottom: tab === k ? "2px solid var(--brand)" : "2px solid transparent",
                color: tab === k ? "var(--brand)" : "var(--muted)",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {versionMsg && <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>{versionMsg}</p>}

        {tab === "spec" && <SpecTab project={project} patchItem={patchItem} actions={actions} saveRooms={saveRooms} />}
        {tab === "merged" && <MergedTab project={project} />}
        {tab === "spec_lists" && <SpecialistTab project={project} />}
        {tab === "calc" && (
          <CoolingFarmTab
            project={project}
            actions={actions}
            onApplyToProject={async ({ coolingKw, coolingBtu }) => {
              const mp =
                project.manualParams && typeof project.manualParams === "object"
                  ? project.manualParams
                  : {};
              await actions.projectUpdate(project.id, {
                manualParams: {
                  ...mp,
                  coolingPower: coolingKw,
                  coolingBtu,
                },
              });
            }}
          />
        )}
      </div>
    </>
  );
}

/* ---------------- Спецификация ---------------- */
function SpecTab({ project, patchItem, actions, saveRooms }) {
  const groups = useMemo(() => groupBy(project.items, "module"), [project.items]);
  const rooms = project.rooms?.length ? project.rooms : defaultRooms();
  const hasFarmItems = project.items.some((it) => isFarmGeneralItem(project, it));

  const addItem = (module) => {
    actions.itemAdd(project.id, {
      module,
      section: module,
      name: "Новая позиция",
      unit: "шт.",
      category: "Прочее",
      link: "",
      clientNote: "",
      qty: 1,
      price: 0,
      visible: true,
      approved: false,
      enabled: true,
      status: "not_bought",
      actualPrice: null,
      clientComment: "",
    });
  };

  if (!project.items.length)
    return <Empty title="В проекте нет позиций" hint="Добавь модули при создании проекта или вручную ниже." />;

  return (
    <div style={{ marginTop: 16 }}>
      {hasFarmItems && (
        <RoomsEditor
          rooms={rooms}
          onChange={(next) => saveRooms(next)}
        />
      )}
      {groups.map(([module, items]) => (
        <section key={module}>
          <div className="section-head">
            <div className="spine" />
            <h3>{module}</h3>
            <span className="count">{items.length} позиц.</span>
            <button className="btn btn-sm btn-ghost" style={{ marginLeft: "auto" }} onClick={() => addItem(module)}>
              ＋ позиция
            </button>
          </div>
          <div className="card" style={{ overflowX: "auto" }}>
            <table className="spec">
              <thead>
                <tr>
                  <th style={{ width: 48 }}>Фото</th>
                  <th>Наименование</th>
                  <th>Ед</th>
                  <th className="right">Кол-во</th>
                  <th className="right">Цена</th>
                  <th>НДС</th>
                  <th>Поставщик</th>
                  {hasFarmItems && <th style={{ width: 130 }}>Комната</th>}
                  <th className="right">Сумма</th>
                  <th>Ссылка</th>
                  <th>Клиенту</th>
                  <th>Утв.</th>
                  <th>Вкл.</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className={!it.visible || !it.enabled ? "row-hidden" : ""}>
                    <td className="spec-photo">
                      {photoSrc(it.imageUrl || it.photoUrl) ? (
                        <img
                          src={photoSrc(it.imageUrl || it.photoUrl)}
                          alt=""
                          className="thumb-img"
                        />
                      ) : (
                        <div className="thumb" style={{ fontSize: 28 }}>
                          {(it.name || "?").trim().charAt(0).toUpperCase()}
                        </div>
                      )}
                    </td>
                    <td style={{ minWidth: 240 }}>
                      <input
                        className="input-inline"
                        value={it.name}
                        onChange={(e) => patchItem(it.id, { name: e.target.value })}
                      />
                      {it.comment && (
                        <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{it.comment}</div>
                      )}
                    </td>
                    <td style={{ width: 70 }}>
                      <input className="input-inline" value={it.unit} onChange={(e) => patchItem(it.id, { unit: e.target.value })} />
                    </td>
                    <td className="right" style={{ width: 90 }}>
                      <input
                        className="input-inline num"
                        style={{ textAlign: "right" }}
                        type="number"
                        value={it.qty}
                        onChange={(e) => patchItem(it.id, { qty: Number(e.target.value) || 0 })}
                      />
                    </td>
                    <td className="right" style={{ width: 100 }}>
                      <input
                        className="input-inline num"
                        style={{ textAlign: "right" }}
                        type="number"
                        value={it.price}
                        onChange={(e) => patchItem(it.id, { price: Number(e.target.value) || 0 })}
                      />
                    </td>
                    <td style={{ width: 56 }}>
                      <select
                        className="input-inline"
                        value={it.vatRate || 0}
                        onChange={(e) => patchItem(it.id, { vatRate: Number(e.target.value) })}
                      >
                        {VAT_RATES.map((r) => (
                          <option key={r} value={r}>
                            {r}%
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ width: 100 }}>
                      <input
                        className="input-inline"
                        value={it.supplier || ""}
                        placeholder="поставщик"
                        onChange={(e) => patchItem(it.id, { supplier: e.target.value })}
                      />
                    </td>
                    {hasFarmItems && (
                      <td style={{ width: 130 }}>
                        {isFarmGeneralItem(project, it) ? (
                          <select
                            className="input-inline"
                            value={it.roomId || ""}
                            onChange={(e) => patchItem(it.id, { roomId: e.target.value })}
                          >
                            <option value="">—</option>
                            {rooms.map((r) => (
                              <option key={r.id} value={r.id}>{roomLabel(rooms, r.id) || r.name}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="muted" style={{ fontSize: 12 }}>—</span>
                        )}
                      </td>
                    )}
                    <td className="right num" style={{ width: 100, fontWeight: 600 }}>
                      {money(lineGross(it), project.currency)}
                    </td>
                    <td style={{ minWidth: 120, maxWidth: 180 }}>
                      {it.link ? (
                        <a href={it.link} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                          ссылка ↗
                        </a>
                      ) : (
                        <input className="input-inline" placeholder="url" onBlur={(e) => patchItem(it.id, { link: e.target.value })} />
                      )}
                    </td>
                    <td style={{ width: 60, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={it.visible}
                        onChange={(e) => patchItem(it.id, { visible: e.target.checked })}
                      />
                    </td>
                    <td style={{ width: 50, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={it.approved}
                        onChange={(e) => patchItem(it.id, { approved: e.target.checked })}
                      />
                    </td>
                    <td style={{ width: 50, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={it.enabled !== false}
                        title="Включена"
                        onChange={(e) => patchItem(it.id, { enabled: e.target.checked })}
                      />
                    </td>
                    <td style={{ width: 36 }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        title="Удалить"
                        onClick={() => actions.itemDelete(project.id, it.id)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

/* ---------------- Общий список ---------------- */
function MergedTab({ project }) {
  const rows = useMemo(() => mergedPurchaseList(project), [project.items]);
  const exportMerged = () =>
    downloadCSV(
      `${project.name}_общий_список`,
      rows.map((r) => ({
        Наименование: r.name,
        Ед: r.unit,
        Кол: r.qty,
        Цена: r.price,
        Сумма: Math.round(r.sum),
        Источники: r.sources.map((s) => `${s.module}: ${num(s.qty)}`).join("; "),
      }))
    );

  if (!rows.length) return <Empty title="Нет утверждённых позиций" hint="Утверди позиции — они попадут в общий список." />;

  return (
    <div style={{ marginTop: 16 }}>
      <div className="toolbar">
        <span className="muted">{rows.length} уникальных позиций · одинаковые объединены</span>
        <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={exportMerged}>Excel ↓</button>
      </div>
      <div className="card" style={{ overflowX: "auto" }}>
        <table className="spec">
          <thead>
            <tr>
              <th>Наименование</th>
              <th>Ед</th>
              <th className="right">Всего</th>
              <th className="right">Сумма</th>
              <th>Откуда</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  {r.name} <span className="tag-cat">{r.category}</span>
                </td>
                <td>{r.unit}</td>
                <td className="right num" style={{ fontWeight: 600 }}>{num(r.qty)}</td>
                <td className="right num">{money(r.sum, project.currency)}</td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {r.sources.map((s) => `${s.module} (${num(s.qty)})`).join(" · ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- Списки специалистов ---------------- */
function SpecialistTab({ project }) {
  const merged = useMemo(() => mergedPurchaseList(project), [project.items]);
  const bySpecialist = useMemo(() => {
    const map = new Map();
    for (const r of merged) {
      const sp = SPECIALIST_MAP[r.category] || "Клиент";
      if (!map.has(sp)) map.set(sp, []);
      map.get(sp).push(r);
    }
    return [...map.entries()];
  }, [merged]);

  if (!merged.length) return <Empty title="Нет утверждённых позиций" />;

  return (
    <div style={{ marginTop: 16 }}>
      {bySpecialist.map(([sp, rows]) => (
        <section key={sp}>
          <div className="section-head">
            <div className="spine" />
            <h3>{sp}</h3>
            <span className="count">{rows.length} позиц.</span>
          </div>
          <div className="card" style={{ overflowX: "auto" }}>
            <table className="spec">
              <thead>
                <tr>
                  <th>Наименование</th>
                  <th>Ед</th>
                  <th className="right">Всего</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.name}</td>
                    <td>{r.unit}</td>
                    <td className="right num">{num(r.qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
