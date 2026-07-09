import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useSearchParams, useNavigate } from "react-router-dom";
import { useStore } from "../../store/StoreContext.jsx";
import {
  projectTotals,
  projectStats,
  groupBy,
  mergedPurchaseList,
  money,
  num,
} from "../../store/helpers.js";
import { SPECIALIST_MAP, PURCHASE_STATUSES } from "../../data/modules.js";
import { VAT_RATES, lineGross, lineContributesToSum, RESPONSIBLE_OPTIONS } from "../../lib/itemHelpers.js";
import { PROJECT_LINE_TYPES, PROJECT_LINE_TYPE_LABELS } from "../../../shared/itemTypes.js";
import { matchSpecLineFilter } from "../../../shared/specLineFilters.js";
import { FARM_LINE_GROUPS, farmLineGroupLabel } from "../../../shared/farmLineGroups.js";
import SpecSectionToolbar from "../../components/SpecSectionToolbar.jsx";
import { absolutePhotoUrl } from "../../lib/photoHelpers.js";
import { clientLink, photoSrc } from "../../lib/api.js";
import { PageHeader } from "../../components/Layout.jsx";
import { Progress, Stat, Empty, ClientLinkModal, StatusChip } from "../../components/ui.jsx";
import Breadcrumbs from "../../components/Breadcrumbs.jsx";
import Collapsible from "../../components/Collapsible.jsx";
import PageSkeleton from "../../components/PageSkeleton.jsx";
import { useToast } from "../../components/Toast.jsx";
import StellageFrameDrawingsPanel from "../../components/StellageFrameDrawingsPanel.jsx";
import { buildProjectStellagesReturnPath } from "../../../shared/frameDrawingContext.js";
import { resolveAdminItemSourceLabel } from "../../../shared/frameBomProjectItems.js";
import { buildBuilderDraftPath, isDraftProject, resolveBuilderWizardStep } from "../../../shared/projectLifecycle.js";
import SaveSectionTemplateModal from "../../components/SaveSectionTemplateModal.jsx";
import { api } from "../../lib/api.js";
import CoolingFarmTab from "../../components/CoolingFarmTab.jsx";
import RoomsEditor from "../../components/RoomsEditor.jsx";
import StructuredSpecEditor from "../../components/StructuredSpecEditor.jsx";
import { hasStructuredSpecEditor } from "../../lib/materialDisplay.js";
import FloorPlanField from "../../components/FloorPlanField.jsx";
import FloorPlanPin from "../../components/FloorPlanPin.jsx";
import { defaultRooms, isFarmGeneralItem, newRoom, roomLabel } from "../../lib/roomHelpers.js";
import {
  applyAndSelectNextRoom,
  applyCoolingCalcToRoom,
  clearRoomCooling,
} from "../../../shared/roomCoolingWorkflow.js";
import RoomCoolingSummary from "../../components/RoomCoolingSummary.jsx";
import RoomCoolingEditor from "../../components/RoomCoolingEditor.jsx";
import { syncRoomAcSpecItems } from "../../../shared/roomAcSync.js";
import ReplacementReviewModal from "../../components/ReplacementReviewModal.jsx";
import { findStaleProjectPrices } from "../../../shared/staleProjectPrices.js";
import ActivityFeed from "../../components/ActivityFeed.jsx";
import PublishChecklist, { PublishGateModal } from "../../components/PublishChecklist.jsx";
import ProjectHqBar from "../../components/ProjectHqBar.jsx";
import PrePublishCheckModal from "../../components/PrePublishCheckModal.jsx";
import ImportFromProjectModal from "../../components/ImportFromProjectModal.jsx";
import CompareProjectsModal from "../../components/CompareProjectsModal.jsx";
import DuplicateProjectModal from "../../components/DuplicateProjectModal.jsx";
import ClientSchemesEditor from "../../components/ClientSchemesEditor.jsx";
import { filterItemsForViewMode } from "../../../shared/projectReadiness.js";
import { parsePublishRulesSettings } from "../../lib/publishRulesConfig.js";
import { copyToClipboard } from "../../lib/copyText.js";
import {
  compositionGroupLabel,
  groupItemsByComposition,
  isStellageModuleTitle,
  STELLAGE_GROUPS,
} from "../../../shared/stellageComposition.js";
const TAB_LABELS = {
  spec: "Спецификация",
  merged: "Общий список",
  spec_lists: "Специалисты",
  calc: "Расчёт охлаждения",
};

export default function SpecEditorPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const highlightItemId = searchParams.get("item");
  const sectionParam = searchParams.get("section");
  const stellagesPanelRef = useRef(null);
  const { state, actions } = useStore();
  const { confirm, success, error } = useToast();
  const project = state.projects.find((p) => p.id === id);
  const [tab, setTab] = useState("spec");
  const [versionMsg, setVersionMsg] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [loading, setLoading] = useState(!project);
  const [companyName, setCompanyName] = useState("Daogreen");
  const [linkTemplate, setLinkTemplate] = useState("");
  const [activity, setActivity] = useState([]);
  const [publishCheck, setPublishCheck] = useState(null);
  const [publishCheckLoading, setPublishCheckLoading] = useState(false);
  const [gateModal, setGateModal] = useState(null);
  const [prePublishOpen, setPrePublishOpen] = useState(false);
  const [viewMode, setViewMode] = useState("designer");
  const [importOpen, setImportOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [sectionTemplates, setSectionTemplates] = useState([]);
  const [applyTplId, setApplyTplId] = useState("");
  const [replacementReviewItem, setReplacementReviewItem] = useState(null);
  const [activeCoolingRoomId, setActiveCoolingRoomId] = useState(null);

  const stalePrices = useMemo(
    () => findStaleProjectPrices(project?.items || [], state.materials),
    [project?.items, state.materials]
  );
  const replacementPending = useMemo(
    () => (project?.items || []).filter((i) => i.status === "replacement_check"),
    [project?.items]
  );
  const clientSectionIssueCount = useMemo(() => {
    const by = publishCheck?.counts?.byIssue || {};
    return (by.no_client_section || 0) + (by.no_client_subsection || 0);
  }, [publishCheck]);

  const syncAllClientSections = async () => {
    const ids = (project?.items || []).filter((it) => it.materialId).map((it) => it.id);
    if (!ids.length) {
      error("Нет позиций с привязкой к материалу");
      return;
    }
    const ok = await confirm({
      title: "Клиентские разделы из базы",
      message: `Подтянуть раздел и подраздел из материалов для ${ids.length} строк спецификации (не путать с ${state.materials?.length || "—"} поз. в справочнике)?`,
      confirmLabel: "Обновить",
    });
    if (!ok) return;
    try {
      const res = await api.refreshItemsFromMaterial(project.id, { itemIds: ids, fields: ["clientSection"] });
      await actions.loadProject(project.id);
      refreshPublishCheck();
      success(`Обновлено позиций: ${res.updated?.length || 0}`);
    } catch (e) {
      error(e.message);
    }
  };

  useEffect(() => {
    api.getSettings().then((s) => {
      setCompanyName(s.companyName || "Daogreen");
      setLinkTemplate(parsePublishRulesSettings(s).clientLinkTemplate);
    }).catch(() => {});
  }, []);

  const refreshPublishCheck = () => {
    if (!id) return Promise.resolve();
    setPublishCheckLoading(true);
    return api
      .publishCheck(id)
      .then(setPublishCheck)
      .catch(() => setPublishCheck(null))
      .finally(() => setPublishCheckLoading(false));
  };

  useEffect(() => {
    refreshPublishCheck();
  }, [id, project?.updatedAt]);

  useEffect(() => {
    if (!id) return;
    api.getProjectActivity(id).then(setActivity).catch(() => setActivity([]));
  }, [id, project?.updatedAt]);

  useEffect(() => {
    if (highlightItemId) setTab("spec");
  }, [highlightItemId]);

  useEffect(() => {
    if (sectionParam !== "stellages" || !project?.id) return;
    setTab("spec");
    const timer = window.setTimeout(() => {
      stellagesPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [sectionParam, project?.id]);

  useEffect(() => {
    api.listSectionTemplates().then(setSectionTemplates).catch(() => setSectionTemplates([]));
  }, [project?.updatedAt]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    actions.loadProject(id).finally(() => setLoading(false));
  }, [id, actions]);

  useEffect(() => {
    if (!project || loading) return;
    if (!isDraftProject(project)) return;
    nav(buildBuilderDraftPath(project.id, { step: resolveBuilderWizardStep(project) }), { replace: true });
  }, [project, loading, nav]);

  if (loading && !project) {
    return (
      <div className="content">
        <PageSkeleton lines={3} />
      </div>
    );
  }

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

  const patchItem = (itemId, patch) =>
    actions
      .itemUpdate(project.id, itemId, patch)
      .then(() => {
        api.getProjectActivity(project.id).then(setActivity).catch(() => {});
        refreshPublishCheck();
      })
      .catch((e) => error(e.message || "Не удалось сохранить позицию"));

  const saveRooms = async (rooms) => {
    await actions.projectUpdate(project.id, { rooms });
    await syncRoomAcSpecItems({ ...project, rooms }, rooms, actions);
  };

  // ---- Cooling calculator → room workflow (calc tab) ----
  const coolingRooms = project.rooms?.length ? project.rooms : [];
  const activeCoolingRoom =
    coolingRooms.find((r) => r.id === activeCoolingRoomId) || coolingRooms[0] || null;
  const effectiveCoolingRoomId = activeCoolingRoom?.id || null;

  const applyCoolingToRoom = async ({ roomId, snapshot }) => {
    const id = roomId || effectiveCoolingRoomId;
    if (!id) return;
    const next = coolingRooms.map((r) => (r.id === id ? applyCoolingCalcToRoom(r, snapshot) : r));
    await saveRooms(next);
  };

  const applyCoolingAndNext = async ({ roomId, snapshot }) => {
    const id = roomId || effectiveCoolingRoomId;
    if (!id) return;
    const { rooms: next, nextRoomId } = applyAndSelectNextRoom(coolingRooms, id, snapshot);
    await saveRooms(next);
    if (nextRoomId) setActiveCoolingRoomId(nextRoomId);
  };

  const duplicateCoolingToNewRoom = async ({ fromRoomId, snapshot }) => {
    const from = coolingRooms.find((r) => r.id === (fromRoomId || effectiveCoolingRoomId)) || null;
    const created = applyCoolingCalcToRoom(newRoom(from?.name ? `Копия — ${from.name}` : "Новая комната"), snapshot);
    await saveRooms([...coolingRooms, created]);
    setActiveCoolingRoomId(created.id);
  };

  const clearCoolingRoom = async ({ roomId }) => {
    const id = roomId || effectiveCoolingRoomId;
    if (!id) return;
    const next = coolingRooms.map((r) => (r.id === id ? clearRoomCooling(r) : r));
    await saveRooms(next);
  };

  const saveManualParam = (key, value) => {
    const mp = project.manualParams && typeof project.manualParams === "object" ? project.manualParams : {};
    return actions.projectUpdate(project.id, { manualParams: { ...mp, [key]: value } });
  };

  const floorPlanUrl = project.manualParams?.floorPlanUrl || "";
  const showFloorPlanPin = !!floorPlanUrl && (tab === "spec" || tab === "calc");

  const doPublishVersion = async (force = false) => {
    try {
      const v = await actions.createVersion(project.id, force ? { force: true } : {});
      setVersionMsg(`Опубликована версия ${v.versionNumber}: Δ ${v.summary.delta} ₽`);
      success(force ? "Версия опубликована (принудительно)" : "Версия опубликована");
      await refreshPublishCheck();
    } catch (e) {
      if (e.problems?.length) {
        error(`Не хватает данных: ${e.problems.length} замечаний`);
        setPublishCheck((prev) => ({ ...prev, ok: false, problems: e.problems }));
      } else {
        error(e.message);
      }
    }
  };

  const requestPublishVersion = () => {
    if (publishCheck?.status === "blocked") setGateModal({ action: "version" });
    else doPublishVersion(false);
  };

  const requestClientLink = () => {
    if (!url) return;
    if (publishCheck?.status === "blocked") setGateModal({ action: "link" });
    else setLinkOpen(true);
  };

  const approveAll = async () => {
    await actions.approveAll(project.id);
    await refreshPublishCheck();
    api.getProjectActivity(project.id).then(setActivity).catch(() => {});
    success("Все позиции отмечены для клиента");
  };

  const publishVersion = requestPublishVersion;

  const exportSpec = async () => {
    const { downloadXlsx } = await import("../../lib/exportXlsx.js");
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
      Источник: it.source === "planner" ? `план: ${it.sourceType || ""}` : "ручная/модуль",
    }));
    downloadXlsx(`${project.name}_спецификация`, rows);
  };

  const url = project.clientToken ? clientLink(project.clientToken) : "";

  const regenerateLink = async () => {
    if (
      !(await confirm({
        title: "Перегенерировать ссылку?",
        message: "Старая ссылка клиента перестанет работать.",
        confirmLabel: "Перегенерировать",
      }))
    )
      return;
    await actions.regenerateToken(project.id);
    success("Новая ссылка создана");
    setLinkOpen(true);
  };

  const copyClientLink = async () => {
    if (!url) return;
    const ok = await copyToClipboard(url);
    if (ok) success("Ссылка скопирована");
    else error("Не удалось скопировать — выделите ссылку вручную");
  };

  const exportClientPdf = async () => {
    try {
      const visibleItems = filterItemsForViewMode(project.items, "client");
      if (!visibleItems.length) {
        error("Нет позиций для клиента");
        return;
      }
      const { generateClientPurchasePdf } = await import("../../lib/clientPdfExport.js");
      await generateClientPurchasePdf({
        project,
        items: visibleItems,
        branding: { companyName },
        purchaseStatuses: PURCHASE_STATUSES,
        pageUrl: url || window.location.href,
        mode: "client_full",
        clientToken: project.clientToken,
      });
    } catch (e) {
      error(e.message || "Ошибка PDF");
    }
  };

  const exportClientExcel = async () => {
    try {
      const visibleItems = filterItemsForViewMode(project.items, "client");
      if (!visibleItems.length) {
        error("Нет позиций для клиента");
        return;
      }
      const { downloadClientWorkbook } = await import("../../lib/clientExcelExport.js");
      downloadClientWorkbook(project, visibleItems, {
        purchaseStatuses: PURCHASE_STATUSES,
        branding: { companyName },
        versionInfo: project.version > 0 ? { versionNumber: project.version } : null,
      });
    } catch (e) {
      error(e.message || "Ошибка Excel");
    }
  };

  const prepareClientNotice = () => {
    window.alert("Мастер подготовки клиентской выдачи будет добавлен следующим шагом.");
  };

  const breadcrumbs = (
    <Breadcrumbs
      items={[
        { label: "Проекты", to: "/" },
        { label: project.client || "Клиент", to: "/clients" },
        { label: project.name, to: `/project/${project.id}` },
        { label: TAB_LABELS[tab] || tab },
      ]}
    />
  );

  return (
    <>
      {linkOpen && url && (
        <ClientLinkModal
          url={url}
          projectName={project.name}
          clientName={project.client}
          companyName={companyName}
          linkTemplate={linkTemplate}
          onClose={() => setLinkOpen(false)}
        />
      )}
      {replacementReviewItem && (
        <ReplacementReviewModal
          projectId={project.id}
          item={replacementReviewItem}
          currency={project.currency}
          onClose={() => setReplacementReviewItem(null)}
          onDone={() => actions.loadProject(project.id)}
        />
      )}
      {gateModal && publishCheck && (
        <PublishGateModal
          title={gateModal.action === "link" ? "Ссылка клиенту — проверка" : "Утверждение версии — проверка"}
          check={publishCheck}
          onClose={() => setGateModal(null)}
          proceedLabel={gateModal.action === "link" ? "Всё равно открыть ссылку" : "Всё равно утвердить"}
          projectId={project.id}
          onProceed={async () => {
            setGateModal(null);
            if (gateModal.action === "link") setLinkOpen(true);
            else await doPublishVersion(true);
          }}
        />
      )}
      {dupOpen && (
        <DuplicateProjectModal
          sourceProject={project}
          onClose={() => setDupOpen(false)}
          onSubmit={async (body) => {
            const p = await actions.projectDuplicate(project.id, body);
            setDupOpen(false);
            success(`Создан проект «${p.name}»`);
            window.location.href = `/spec/project/${p.id}`;
          }}
        />
      )}
      {importOpen && (
        <ImportFromProjectModal
          targetProjectId={project.id}
          projects={state.projects}
          onClose={() => setImportOpen(false)}
          onImported={async () => {
            await actions.loadProject(project.id);
            success("Позиции добавлены");
            api.getProjectActivity(project.id).then(setActivity).catch(() => {});
          }}
        />
      )}
      {compareOpen && (
        <CompareProjectsModal
          projectId={project.id}
          projects={state.projects}
          onClose={() => setCompareOpen(false)}
        />
      )}
      {prePublishOpen && (
        <PrePublishCheckModal
          check={publishCheck}
          loading={publishCheckLoading}
          projectId={project.id}
          onClose={() => setPrePublishOpen(false)}
          onProceed={
            publishCheck?.status !== "blocked"
              ? async () => {
                  setPrePublishOpen(false);
                  await doPublishVersion(false);
                }
              : publishCheck?.allowForcePublish
                ? async () => {
                    setPrePublishOpen(false);
                    await doPublishVersion(true);
                  }
                : undefined
          }
          proceedLabel="Утвердить версию"
        />
      )}
      <PageHeader
        title={project.name}
        breadcrumbs={breadcrumbs}
        back={{ to: "/", label: "Проекты" }}
        sub={`${project.client || "—"}${project.city ? " · " + project.city : ""}${
          project.area ? " · " + project.area + " м²" : ""
        } · ${project.type}`}
        actions={
          <>
            <Link className="btn" to={`/project/${project.id}/plan`}>▦ План</Link>
            <button className="btn" onClick={exportSpec} title="Внутренний Excel (все поля)">Excel ↓</button>
            <button className="btn" onClick={() => setImportOpen(true)}>Из прошлого</button>
            <button className="btn" onClick={() => setCompareOpen(true)}>Сравнить</button>
            <details style={{ position: "relative" }}>
              <summary className="btn btn-ghost" style={{ cursor: "pointer" }}>Ещё ▾</summary>
              <div
                className="card"
                style={{
                  position: "absolute",
                  right: 0,
                  top: "100%",
                  marginTop: 4,
                  padding: 8,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  zIndex: 100,
                  minWidth: 200,
                }}
              >
                <button className="btn btn-sm" onClick={() => setDupOpen(true)}>На основе прошлого</button>
                <button className="btn btn-sm" onClick={approveAll}>Показать всё клиенту</button>
                <button className="btn btn-sm" disabled={!url} onClick={requestClientLink}>QR / Шаблон ссылки</button>
                <button className="btn btn-sm btn-ghost" onClick={regenerateLink}>↻ Сбросить ссылку</button>
              </div>
            </details>
          </>
        }
      />

      <div className="content">
        <ProjectHqBar
          project={project}
          items={project.items || []}
          publishCheck={publishCheck}
          publishCheckLoading={publishCheckLoading}
          clientUrl={url}
          onRefreshPublishCheck={refreshPublishCheck}
          onOpenPrePublish={() => setPrePublishOpen(true)}
          onOpenClientLink={requestClientLink}
          onOpenClientPreview={() => url && window.open(url, "_blank", "noopener,noreferrer")}
          onCopyClientLink={copyClientLink}
          onExportPdf={exportClientPdf}
          onExportExcel={exportClientExcel}
          onPrepareClient={prepareClientNotice}
        />

        <div className="print-header">
          <h1>{project.name}</h1>
          <p>
            {project.client || "—"}
            {project.city ? ` · ${project.city}` : ""} · спецификация · {new Date().toLocaleDateString("ru-RU")}
          </p>
        </div>

        {clientSectionIssueCount > 0 && (
          <div className="card" style={{ padding: "12px 16px", marginBottom: 14, borderColor: "var(--danger)" }}>
            <strong>Нет клиентского раздела/подраздела: {clientSectionIssueCount} поз.</strong>
            <p className="muted" style={{ fontSize: 13, margin: "6px 0 10px" }}>
              В материалах разделы заполнены, но в проекте — старый снимок. Подтяните из базы одной кнопкой.
            </p>
            <button type="button" className="btn btn-sm btn-primary" onClick={syncAllClientSections}>
              Клиент. разделы из базы
            </button>
          </div>
        )}

        {stalePrices.length > 0 && (
          <div className="card" style={{ padding: "12px 16px", marginBottom: 14, borderColor: "var(--warn)" }}>
            <strong>Цена в базе изменилась у {stalePrices.length} поз.</strong>
            <p className="muted" style={{ fontSize: 13, margin: "6px 0 10px" }}>
              Старые проекты не обновляются автоматически. Обновить цену в проекте из базы?
            </p>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={async () => {
                await api.refreshItemsFromMaterial(project.id, {
                  itemIds: stalePrices.map((s) => s.itemId),
                  fields: ["price"],
                });
                await actions.loadProject(project.id);
                success("Цены обновлены из базы");
              }}
            >
              Обновить {stalePrices.length} поз.
            </button>
          </div>
        )}

        {replacementPending.length > 0 && (
          <div className="card" style={{ padding: "12px 16px", marginBottom: 14, borderColor: "var(--accent)" }}>
            <strong>Замены на проверке: {replacementPending.length}</strong>
            <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
              {replacementPending.slice(0, 6).map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setReplacementReviewItem(it)}
                >
                  {it.name.slice(0, 40)}
                  {it.name.length > 40 ? "…" : ""}
                </button>
              ))}
            </div>
          </div>
        )}

        {project.version > 0 && (
          <p className="muted no-print" style={{ fontSize: 12, margin: "0 0 12px" }}>
            Версия {project.version} опубликована. Правки сохраняются без новой версии — для снимка нажмите «Утвердить версию».
          </p>
        )}

        <div className="row wrap no-print view-mode-toggle" style={{ gap: 8, marginBottom: 14 }}>
          <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>Режим:</span>
          {[
            ["designer", "Проектировщик"],
            ["client", "Предпросмотр клиента"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`btn btn-sm${viewMode === id ? " btn-primary" : ""}`}
              onClick={() => setViewMode(id)}
            >
              {label}
            </button>
          ))}
          {viewMode === "client" && (
            <span className="chip chip--amber" style={{ fontSize: 11 }}>
              Только то, что увидит клиент
            </span>
          )}
        </div>

        {sectionTemplates.length > 0 && (
          <div className="row wrap no-print" style={{ gap: 8, marginBottom: 14, alignItems: "center" }}>
            <span className="muted" style={{ fontSize: 12 }}>Шаблон раздела:</span>
            <select
              value={applyTplId}
              onChange={(e) => setApplyTplId(e.target.value)}
              style={{ width: "auto", minWidth: 220 }}
            >
              <option value="">— выберите —</option>
              {sectionTemplates.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.moduleName})</option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!applyTplId}
              onClick={async () => {
                const tpl = sectionTemplates.find((t) => t.id === applyTplId);
                await api.applySectionTemplate(project.id, {
                  templateId: applyTplId,
                  targetModule: tpl?.moduleName,
                });
                await actions.loadProject(project.id);
                success(`Шаблон «${tpl?.name}» добавлен`);
              }}
            >
              Вставить шаблон
            </button>
          </div>
        )}

        <div ref={stellagesPanelRef}>
          <StellageFrameDrawingsPanel
            project={project}
            returnPath={buildProjectStellagesReturnPath(project.id)}
          />
        </div>
        <ProjectDocuments projectId={project.id} />

        <Collapsible title="История: клиент и Daogreen" subtitle={`${activity.length} записей`} defaultOpen={activity.length > 0}>
          <ActivityFeed activity={activity} title="" />
        </Collapsible>

        <Collapsible title="Сводка и прогресс" subtitle={`${stats.total} позиций`} defaultOpen>
        <div className="stat-grid" style={{ marginBottom: 0 }}>
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
          <span className="muted">Для клиента: <b className="num">{stats.approved}</b></span>
          <span className="muted">Скрыто: <b className="num">{stats.hidden}</b></span>
          {stats.noPrice > 0 && <span className="chip chip--amber chip-dot">без цены: {stats.noPrice}</span>}
          {stats.noLink > 0 && <span className="chip chip--neutral chip-dot">без ссылки: {stats.noLink}</span>}
        </div>
        </Collapsible>

        {/* Tabs */}
        <div className="toolbar toolbar--tabs" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 0, gap: 0 }}>
          {[
            ["spec", "Спецификация"],
            ["merged", "Общий список"],
            ["spec_lists", "Специалисты"],
            ["calc", "Расчёт охлаждения фермы"],
          ].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className="btn btn-ghost"
              style={{
                borderRadius: "6px 6px 0 0",
                borderBottom: tab === k ? "3px solid var(--brand)" : "3px solid transparent",
                color: tab === k ? "var(--brand)" : "var(--muted)",
                background: tab === k ? "var(--bg-light)" : "transparent",
                fontWeight: tab === k ? 700 : 500,
                padding: "10px 16px",
                marginRight: 4,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {versionMsg && <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>{versionMsg}</p>}

        {tab === "spec" && (
          <>
            <RoomCoolingSummary project={project} />
            <SpecTab
              project={project}
              patchItem={patchItem}
              actions={actions}
              saveRooms={saveRooms}
              floorPlanUrl={floorPlanUrl}
              onFloorPlanChange={(url) => saveManualParam("floorPlanUrl", url)}
              manualParams={project.manualParams}
              onManualParamsChange={(mp) => actions.projectUpdate(project.id, { manualParams: mp })}
              highlightItemId={highlightItemId}
              viewMode={viewMode}
            />
          </>
        )}
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
            rooms={coolingRooms}
            activeRoomId={effectiveCoolingRoomId}
            onActiveRoomChange={setActiveCoolingRoomId}
            onApplyToRoom={applyCoolingToRoom}
            onApplyAndNext={applyCoolingAndNext}
            onDuplicateToNewRoom={duplicateCoolingToNewRoom}
            onClearRoomCooling={clearCoolingRoom}
          />
        )}
      </div>

      {showFloorPlanPin && <FloorPlanPin url={floorPlanUrl} title="Схема помещения" />}
    </>
  );
}

const DOC_TYPES = [
  ["invoice", "Счёт"],
  ["quote", "КП"],
  ["manual", "Инструкция"],
  ["frame_drawing", "Чертёж каркаса"],
  ["other", "Прочее"],
];

function ProjectDocuments({ projectId }) {
  const { confirm, success, error } = useToast();
  const [docs, setDocs] = useState([]);
  const [docType, setDocType] = useState("other");
  const [loading, setLoading] = useState(true);

  const load = () =>
    api
      .getProjectDocuments(projectId)
      .then(setDocs)
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, [projectId]);

  const upload = async (file) => {
    if (!file) return;
    try {
      await api.uploadProjectDocument(projectId, file, docType);
      success("Файл загружен");
      load();
    } catch (e) {
      error(e.message);
    }
  };

  const remove = async (d) => {
    if (!(await confirm({ title: "Удалить документ?", message: d.filename, confirmLabel: "Удалить" }))) return;
    await api.deleteDocument(d.id);
    load();
  };

  const typeLabel = (t) => DOC_TYPES.find(([k]) => k === t)?.[1] || t;

  return (
    <Collapsible title="Документы проекта" subtitle={loading ? "…" : `${docs.length} файлов`} defaultOpen={false}>
      <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
        <select value={docType} onChange={(e) => setDocType(e.target.value)} style={{ width: "auto" }}>
          {DOC_TYPES.map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
        <label className="btn btn-sm">
          Загрузить файл
          <input type="file" hidden onChange={(e) => upload(e.target.files?.[0])} />
        </label>
      </div>
      {!docs.length ? (
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>Счета, КП и инструкции — видны клиенту во вкладке «Документы».</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
          {docs.map((d) => (
            <li key={d.id} style={{ marginBottom: 6 }}>
              <span className="chip chip--neutral" style={{ marginRight: 6 }}>{typeLabel(d.type)}</span>
              <a href={photoSrc(d.url)} target="_blank" rel="noreferrer">{d.filename}</a>
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }} onClick={() => remove(d)}>✕</button>
            </li>
          ))}
        </ul>
      )}
    </Collapsible>
  );
}

/* ---------------- Спецификация ---------------- */
function SpecTab({
  project,
  patchItem,
  actions,
  saveRooms,
  floorPlanUrl,
  onFloorPlanChange,
  manualParams,
  onManualParamsChange,
  highlightItemId,
  viewMode = "designer",
}) {
  const { confirm, success, error } = useToast();
  const { state } = useStore();
  const materials = state.materials;
  const modules = state.modules;
  const stellageGroups = state.reference?.stellageGroups?.length
    ? state.reference.stellageGroups
    : STELLAGE_GROUPS;
  const clientPreview = viewMode === "client";
  const readOnly = clientPreview;
  const displayItems = useMemo(
    () => (clientPreview ? filterItemsForViewMode(project.items, "client") : project.items),
    [project.items, clientPreview]
  );
  const groups = useMemo(() => groupBy(displayItems, "module"), [displayItems]);
  const rooms = project.rooms?.length ? project.rooms : defaultRooms();
  const hasFarmItems = project.items.some((it) => isFarmGeneralItem(project, it));
  const [quickFilter, setQuickFilter] = useState("");
  const [moduleFilters, setModuleFilters] = useState({});
  const [moduleSelected, setModuleSelected] = useState({});
  const [suppliers, setSuppliers] = useState([]);
  const [saveTplModule, setSaveTplModule] = useState(null);
  const moduleScrollRefs = useRef({});

  useEffect(() => {
    api.getSuppliers().then(setSuppliers).catch(() => setSuppliers([]));
  }, []);

  const selectedItemIds = useMemo(() => {
    const ids = [];
    for (const set of Object.values(moduleSelected)) {
      for (const id of set || []) ids.push(id);
    }
    return ids;
  }, [moduleSelected]);

  const refreshFromBase = async (itemIds, fields) => {
    if (!itemIds.length) {
      error("Выберите позиции с materialId");
      return;
    }
    try {
      const res = await api.refreshItemsFromMaterial(project.id, { itemIds, fields });
      await actions.loadProject(project.id);
      success(`Обновлено позиций: ${res.updated?.length || 0}`);
    } catch (e) {
      error(e.message);
    }
  };

  const syncClientSections = async (itemIds) => {
    const ids =
      itemIds?.length > 0
        ? itemIds
        : project.items.filter((it) => it.materialId).map((it) => it.id);
    if (!ids.length) {
      error("Нет позиций с привязкой к материалу в базе");
      return;
    }
    if (!itemIds?.length) {
      const ok = await confirm({
        title: "Клиентские разделы из базы",
        message: `Подтянуть раздел и подраздел из материалов для ${ids.length} строк спецификации?`,
        confirmLabel: "Обновить",
      });
      if (!ok) return;
    }
    await refreshFromBase(ids, ["clientSection"]);
  };

  const REFRESH_ACTIONS = [
    ["price", "Обновить цену из базы"],
    ["link", "Обновить ссылку из базы"],
    ["supplier", "Обновить поставщика из базы"],
    ["photo", "Обновить фото из базы"],
    ["clientSection", "Обновить клиентский раздел из базы"],
    ["all", "Обновить выбранные из базы"],
  ];

  const scrolledHighlightRef = useRef(null);

  useEffect(() => {
    if (!highlightItemId) {
      scrolledHighlightRef.current = null;
      return;
    }
    if (scrolledHighlightRef.current === highlightItemId) return;

    const scrollToItem = () => {
      const el = document.getElementById(`spec-item-${highlightItemId}`);
      if (!el) return false;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("spec-row--highlight");
      window.setTimeout(() => el.classList.remove("spec-row--highlight"), 3500);
      scrolledHighlightRef.current = highlightItemId;
      return true;
    };

    const t = window.setTimeout(() => {
      if (!scrollToItem()) {
        window.setTimeout(scrollToItem, 300);
      }
    }, 200);
    return () => window.clearTimeout(t);
  }, [highlightItemId, project.items.length]);

  const passesFilter = (it, moduleFilter = "") => {
    if (!matchSpecLineFilter(it, moduleFilter, "project")) return false;
    if (!quickFilter) return true;
    if (quickFilter === "no_photo") return !photoSrc(it.imageUrl || it.photoUrl);
    if (quickFilter === "not_approved") return !it.visibleToClient;
    if (quickFilter === "no_supplier") return !(it.supplier || "").trim();
    return true;
  };

  const sectionNames = useMemo(() => groups.map(([m]) => m), [groups]);

  const bulkPatchModule = async (module, patch) => {
    const ids = [...(moduleSelected[module] || [])];
    if (!ids.length) return;
    try {
      if (patch.__copyToSection) {
        const target = patch.__copyToSection;
        for (const id of ids) {
          const it = project.items.find((i) => i.id === id);
          if (!it) continue;
          await actions.itemAdd(project.id, {
            ...it,
            module: target,
            section: target,
          });
        }
      } else {
        await api.bulkPatchItems(project.id, { itemIds: ids, patch });
        await actions.loadProject(project.id);
      }
      setModuleSelected((s) => ({ ...s, [module]: new Set() }));
      success(`Обновлено позиций: ${ids.length}`);
    } catch (e) {
      error(e.message);
    }
  };

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
      itemType: "material",
      includedInProject: true,
      visibleToClient: true,
      visible: true,
      approved: true,
      enabled: true,
      status: "not_bought",
      actualPrice: null,
      clientComment: "",
    });
  };

  if (!project.items.length)
    return <Empty title="В проекте нет позиций" hint="Добавь модули при создании проекта или вручную ниже." />;

  if (clientPreview && !displayItems.length)
    return (
      <Empty
        title="Клиенту пока нечего показать"
        hint="Включите позиции в проект или снимите отметку «Скрыто»."
      />
    );

  return (
    <div style={{ marginTop: 16 }}>
      {saveTplModule && (
        <SaveSectionTemplateModal
          module={saveTplModule}
          itemCount={project.items.filter((it) => it.module === saveTplModule).length}
          onClose={() => setSaveTplModule(null)}
          onSave={async ({ name, note }) => {
            await api.saveSectionTemplate(project.id, saveTplModule, { name, note });
            setSaveTplModule(null);
            success(`Шаблон «${name}» сохранён`);
          }}
        />
      )}
      {!clientPreview && (
      <>
      <Collapsible title="Схема и комнаты" defaultOpen={hasFarmItems || !!floorPlanUrl}>
        <FloorPlanField value={floorPlanUrl || ""} onChange={onFloorPlanChange} />
        {hasFarmItems && (
          <div style={{ marginTop: 12 }}>
            <RoomsEditor rooms={rooms} onChange={(next) => saveRooms(next)} compact />
            <RoomCoolingEditor
              rooms={rooms}
              onChange={(next) => saveRooms(next)}
            />
          </div>
        )}
      </Collapsible>

      <Collapsible title="Схемы для клиента" subtitle="трубы, стеллажи, помещения…" defaultOpen={false}>
        <ClientSchemesEditor
          manualParams={manualParams}
          onChange={onManualParamsChange}
        />
      </Collapsible>

      <Collapsible title="Корзина расходников" defaultOpen={!!manualParams?.consumablesCartUrl}>
        <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
          Ссылка на собранную корзину расходных материалов (из мастера «Новый проект»).
        </p>
        <input
          type="url"
          className="spec-cell-input"
          placeholder="https://…"
          value={manualParams?.consumablesCartUrl || ""}
          onChange={(e) =>
            onManualParamsChange({ ...(manualParams || {}), consumablesCartUrl: e.target.value })
          }
        />
      </Collapsible>

      <div className="spec-quick-filters no-print">
        <span className="muted" style={{ fontSize: 12 }}>Быстрый фильтр:</span>
        {[
          ["", "Все"],
          ["no_photo", "Без фото"],
          ["not_approved", "Не для клиента"],
          ["no_supplier", "Без поставщика"],
        ].map(([id, label]) => (
          <button
            key={id || "all"}
            type="button"
            className={`btn btn-sm${quickFilter === id ? " btn-primary" : ""}`}
            onClick={() => setQuickFilter(id)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => syncClientSections(selectedItemIds)}
          title="Раздел и подраздел для клиентской закупки из справочника материалов"
        >
          Клиент. разделы из базы
          {selectedItemIds.length > 0 ? ` (${selectedItemIds.length})` : ""}
        </button>
        {selectedItemIds.length > 0 && (
          <span className="spec-refresh-toolbar">
            <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
              Выбрано: {selectedItemIds.length}
            </span>
            {REFRESH_ACTIONS.map(([field, label]) => (
              <button
                key={field}
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  refreshFromBase(selectedItemIds, field === "all" ? ["all"] : [field])
                }
              >
                {label}
              </button>
            ))}
          </span>
        )}
      </div>
      </>
      )}

      {groups.map(([module, items]) => {
        const moduleFilter = moduleFilters[module] || "";
        const modSelected = moduleSelected[module] || new Set();
        const visibleItems = items.filter((it) => passesFilter(it, moduleFilter));
        const selectAllVisible = () => {
          setModuleSelected((s) => ({
            ...s,
            [module]: new Set(visibleItems.map((it) => it.id)),
          }));
        };
        if (!visibleItems.length) return null;
        const modSum = visibleItems.filter(lineContributesToSum).reduce((s, i) => s + lineGross(i), 0);
        const specColSpan = clientPreview
          ? (hasFarmItems ? 11 : 10)
          : (hasFarmItems ? 21 : 20);
        const isStellage = isStellageModuleTitle(module, modules);
        const lineGroups = isStellage ? stellageGroups : FARM_LINE_GROUPS;
        const editItem = readOnly ? () => Promise.resolve() : patchItem;
        const renderItemRow = (it) => {
          const frameBomSourceLabel = clientPreview ? "" : resolveAdminItemSourceLabel(it);
          return (
                  <tr
                    key={it.id}
                    id={`spec-item-${it.id}`}
                    className={((it.includedInProject === false ? "row-hidden " : "") + (highlightItemId === it.id ? "spec-row--highlight" : ""))}
                  >
                    {!clientPreview && (
                    <td style={{ width: 36, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={modSelected.has(it.id)}
                        onChange={(e) => {
                          setModuleSelected((s) => {
                            const next = new Set(s[module] || []);
                            if (e.target.checked) next.add(it.id);
                            else next.delete(it.id);
                            return { ...s, [module]: next };
                          });
                        }}
                      />
                    </td>
                    )}
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
                      {readOnly ? (
                        <div>
                          <strong style={{ fontSize: 13 }}>{it.name}</strong>
                          {it.clientNote && (
                            <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{it.clientNote}</div>
                          )}
                        </div>
                      ) : (
                        <>
                      <input
                        className="input-inline"
                        value={it.name}
                        onChange={(e) => editItem(it.id, { name: e.target.value })}
                      />
                      {it.comment && !hasStructuredSpecEditor(it.name) && (
                        <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{it.comment}</div>
                      )}
                      {it.source === "planner" && (
                        <div className="chip" style={{ fontSize: 10, marginTop: 4 }}>
                          из плана · {it.sourceType || "object"}
                        </div>
                      )}
                      {frameBomSourceLabel && (
                        <div className="chip chip--neutral" style={{ fontSize: 10, marginTop: 4 }}>
                          {frameBomSourceLabel}
                        </div>
                      )}
                      {hasStructuredSpecEditor(it.name) ? (
                        <StructuredSpecEditor
                          compact
                          name={it.name}
                          values={it}
                          onChange={(patch) => editItem(it.id, patch)}
                        />
                      ) : (
                        <input
                          className="input-inline"
                          placeholder="сообщение клиенту"
                          style={{ marginTop: 4, fontSize: 11 }}
                          value={it.clientNote || ""}
                          onChange={(e) => editItem(it.id, { clientNote: e.target.value })}
                        />
                      )}
                        </>
                      )}
                    </td>
                    <td style={{ width: 70 }}>
                      {readOnly ? (
                        <span>{it.unit}</span>
                      ) : (
                      <input className="input-inline" value={it.unit} onChange={(e) => editItem(it.id, { unit: e.target.value })} />
                      )}
                    </td>
                    <td className="right" style={{ width: 90 }}>
                      {readOnly ? (
                        <span className="num">{it.qty}</span>
                      ) : (
                      <input
                        className="input-inline num"
                        style={{ textAlign: "right" }}
                        type="number"
                        value={it.qty}
                        onChange={(e) => editItem(it.id, { qty: Number(e.target.value) || 0 })}
                      />
                      )}
                    </td>
                    <td className="right" style={{ width: 100 }}>
                      {readOnly ? (
                        <span className="num">{it.price}</span>
                      ) : (
                      <input
                        className="input-inline num"
                        style={{ textAlign: "right" }}
                        type="number"
                        value={it.price}
                        onChange={(e) => editItem(it.id, { price: Number(e.target.value) || 0 })}
                      />
                      )}
                    </td>
                    <td style={{ width: 56 }}>
                      {readOnly ? (
                        <span className="num">{it.vatRate || 0}%</span>
                      ) : (
                      <select
                        className="input-inline"
                        value={it.vatRate || 0}
                        onChange={(e) => editItem(it.id, { vatRate: Number(e.target.value) })}
                      >
                        {VAT_RATES.map((r) => (
                          <option key={r} value={r}>
                            {r}%
                          </option>
                        ))}
                      </select>
                      )}
                    </td>
                    <td style={{ width: 100 }}>
                      {readOnly ? (
                        <span>{it.supplier || "—"}</span>
                      ) : (
                      <input
                        className="input-inline"
                        value={it.supplier || ""}
                        placeholder="поставщик"
                        onChange={(e) => editItem(it.id, { supplier: e.target.value })}
                      />
                      )}
                    </td>
                    {hasFarmItems && (
                      <td style={{ width: 130 }}>
                        {isFarmGeneralItem(project, it) ? (
                          <select
                            className="input-inline"
                            value={it.roomId || ""}
                            onChange={(e) => editItem(it.id, { roomId: e.target.value })}
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
                      {lineContributesToSum(it) ? money(lineGross(it), project.currency) : "—"}
                    </td>
                    <td style={{ minWidth: 120, maxWidth: 180 }}>
                      {it.link ? (
                        <a href={it.link} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                          ссылка ↗
                        </a>
                      ) : readOnly ? (
                        <span className="muted">—</span>
                      ) : (
                        <input className="input-inline" placeholder="url" onBlur={(e) => editItem(it.id, { link: e.target.value })} />
                      )}
                    </td>
                    <td style={{ minWidth: 120, maxWidth: 150 }}>
                      {readOnly || clientPreview ? (
                        <StatusChip status={it.status || "not_bought"} statuses={PURCHASE_STATUSES} />
                      ) : (
                        <select
                          className="input-inline"
                          value={it.status || "not_bought"}
                          onChange={(e) =>
                            editItem(it.id, { status: e.target.value, purchaseStatus: e.target.value })
                          }
                        >
                          {PURCHASE_STATUSES.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      )}
                      {(it.status === "need_help" ||
                        it.status === "not_fit" ||
                        it.status === "replacement_check") && (
                        <div style={{ marginTop: 4 }}>
                          <StatusChip status={it.status} statuses={PURCHASE_STATUSES} />
                        </div>
                      )}
                    </td>
                    {!clientPreview && (
                    <td style={{ minWidth: 100, maxWidth: 140 }}>
                      <input
                        className="input-inline"
                        placeholder="внутр."
                        title="Не видно клиенту"
                        value={it.internalNote || ""}
                        onChange={(e) => editItem(it.id, { internalNote: e.target.value })}
                      />
                    </td>
                    )}
                    <td style={{ minWidth: 100, maxWidth: 160, fontSize: 12 }}>
                      {it.clientComment ? (
                        <span className="chip chip--amber" style={{ whiteSpace: "normal", textAlign: "left" }}>
                          {it.clientComment}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    {!clientPreview && (
                    <>
                    <td style={{ width: 56 }}>
                      <input
                        className="input-inline num"
                        type="number"
                        min={0}
                        placeholder="—"
                        value={it.deliveryDays || ""}
                        onChange={(e) => editItem(it.id, { deliveryDays: Number(e.target.value) || 0 })}
                      />
                    </td>
                    <td style={{ width: 100 }}>
                      <select
                        className="input-inline"
                        value={it.subcategory || ""}
                        onChange={(e) => editItem(it.id, { subcategory: e.target.value })}
                      >
                        <option value="">—</option>
                        {lineGroups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ width: 100 }}>
                      <select
                        className="input-inline"
                        value={it.itemType || "material"}
                        onChange={(e) => editItem(it.id, { itemType: e.target.value })}
                      >
                        {PROJECT_LINE_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {PROJECT_LINE_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ width: 60, textAlign: "center" }} title="Включена в проект и сумму">
                      <input
                        type="checkbox"
                        checked={it.includedInProject !== false}
                        onChange={(e) =>
                          editItem(it.id, {
                            includedInProject: e.target.checked,
                            enabled: e.target.checked,
                            ...(e.target.checked
                              ? { visibleToClient: true, visible: true, approved: true }
                              : {}),
                          })
                        }
                      />
                    </td>
                    <td style={{ width: 60, textAlign: "center" }} title="Скрыто от клиента">
                      <input
                        type="checkbox"
                        checked={it.includedInProject !== false && it.visibleToClient === false}
                        disabled={it.includedInProject === false}
                        onChange={(e) =>
                          editItem(it.id, {
                            visibleToClient: !e.target.checked,
                            visible: !e.target.checked,
                            approved: !e.target.checked,
                          })
                        }
                      />
                    </td>
                    <td style={{ width: 44 }}>
                      {it.materialId ? (
                        <details className="refresh-from-base">
                          <summary className="btn btn-ghost btn-sm" title="Обновить из базы материалов">
                            ↻ база
                          </summary>
                          <div className="refresh-from-base-menu">
                            {REFRESH_ACTIONS.map(([field, label]) => (
                              <button
                                key={field}
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() =>
                                  refreshFromBase([it.id], field === "all" ? ["all"] : [field])
                                }
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </details>
                      ) : (
                        <span className="muted" style={{ fontSize: 11 }}>—</span>
                      )}
                    </td>
                    <td style={{ width: 36 }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        title="Удалить"
                        onClick={async () => {
                          if (
                            await confirm({
                              title: "Удалить позицию?",
                              message: it.name,
                              confirmLabel: "Удалить",
                            })
                          )
                            actions.itemDelete(project.id, it.id);
                        }}
                      >
                        ✕
                      </button>
                    </td>
                    </>
                    )}
                  </tr>
          );
        };
        const bodyRows = isStellageModuleTitle(module, modules)
          ? groupItemsByComposition(visibleItems, materials, stellageGroups).flatMap(([gId, gItems]) => [
              gId !== "other" ? (
                <tr key={`${module}-g-${gId}`}>
                  <td colSpan={specColSpan} className="spec-group-head">
                    {compositionGroupLabel(gId, stellageGroups)}
                  </td>
                </tr>
              ) : null,
              ...gItems.map(renderItemRow),
            ]).filter(Boolean)
          : visibleItems.map(renderItemRow);
        const longModuleList = bodyRows.length >= 36;
        return (
        <Collapsible
          key={module}
          title={module}
          subtitle={`${visibleItems.length} поз. · ${money(modSum, project.currency)}`}
          defaultOpen={groups.length <= 4}
          actions={
            !clientPreview ? (
            <span className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm btn-ghost" onClick={() => setSaveTplModule(module)}>
              Сохранить как шаблон
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => addItem(module)}>
              ＋ позиция
            </button>
            </span>
            ) : null
          }
        >
          {!clientPreview && (
          <SpecSectionToolbar
            mode="project"
            filterId={moduleFilter}
            onFilterChange={(id) => setModuleFilters((s) => ({ ...s, [module]: id }))}
            selectedCount={modSelected.size}
            visibleCount={visibleItems.length}
            onSelectAll={selectAllVisible}
            onClearSelection={() => setModuleSelected((s) => ({ ...s, [module]: new Set() }))}
            onBulkPatch={(patch) => bulkPatchModule(module, patch)}
            onRefreshClientSections={() =>
              syncClientSections([...(moduleSelected[module] || [])])
            }
            sectionOptions={sectionNames}
            suppliers={suppliers}
            purchaseStatuses={PURCHASE_STATUSES}
            responsibleOptions={RESPONSIBLE_OPTIONS}
          />
          )}
          <div
            ref={(el) => {
              moduleScrollRefs.current[module] = el;
            }}
            className="card spec-module-table-scroll"
            style={{
              overflowX: "auto",
              ...(longModuleList
                ? { maxHeight: "min(72vh, 820px)", overflowY: "auto", WebkitOverflowScrolling: "touch" }
                : {}),
            }}
          >
            <table className="spec">
              <thead className="virtual-table-head">
                <tr>
                  {!clientPreview && <th style={{ width: 36 }} aria-label="Выбор" />}
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
                  <th style={{ width: 130 }}>Статус закупки</th>
                  {!clientPreview && <th title="Внутренний комментарий">Заметка</th>}
                  <th title="Комментарий клиента">Клиент</th>
                  {!clientPreview && (
                    <>
                  <th title="Срок поставки, дней">Дней</th>
                  <th>Группа</th>
                  <th>Тип</th>
                  <th title="В проекте">В проекте</th>
                  <th title="Скрыто от клиента">Скрыто</th>
                  <th title="Обновить снимок из базы">База</th>
                  <th></th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>{bodyRows}</tbody>
            </table>
          </div>
        </Collapsible>
      );
      })}
    </div>
  );
}

/* ---------------- Общий список ---------------- */
function MergedTab({ project }) {
  const rows = useMemo(() => mergedPurchaseList(project), [project.items]);
  const mergedScrollRef = useRef(null);
  const exportMerged = async () => {
    const { downloadXlsx } = await import("../../lib/exportXlsx.js");
    downloadXlsx(
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
  };

  if (!rows.length) return <Empty title="Нет утверждённых позиций" hint="Утверди позиции — они попадут в общий список." />;

  return (
    <div style={{ marginTop: 16 }}>
      <div className="toolbar">
        <span className="muted">{rows.length} уникальных позиций · одинаковые объединены</span>
        <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={exportMerged}>Excel ↓</button>
      </div>
      <div
        ref={mergedScrollRef}
        className="card"
        style={
          rows.length >= 48
            ? { overflowX: "auto", maxHeight: "min(70vh, 720px)", overflowY: "auto" }
            : { overflowX: "auto" }
        }
      >
        <table className="spec">
          <thead className="virtual-table-head">
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
                <td className="right num" style={{ fontWeight: 600 }}>
                  {num(r.qty)}
                </td>
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
