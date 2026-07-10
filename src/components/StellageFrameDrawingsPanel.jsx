import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import FrameDrawingActions from './FrameDrawingActions.jsx';
import { drawingsForProjectStellage } from '../../shared/frameDrawingTargets.js';
import { buildSavedProjectFrameDrawingContext } from '../../shared/frameDrawingContext.js';
import { canRefreshFrameBom } from '../../shared/frameDrawingActionsModel.js';
import { useStore } from '../store/StoreContext.jsx';
import { useToast } from './Toast.jsx';
import { executeFrameBomRefreshFromDrawing } from '../frameConstructor/frameBomAddToProject.js';

export default function StellageFrameDrawingsPanel({ project, returnPath }) {
  const stellages = project?.stellageConfigs || [];
  const [drawings, setDrawings] = useState([]);
  const [presetDrawings, setPresetDrawings] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshBusyRack, setRefreshBusyRack] = useState('');
  const { actions, state } = useStore();
  const { confirm, success, error } = useToast();
  const materials = state.materials || [];

  useEffect(() => {
    actions.ensureMaterials?.().catch(() => {});
  }, [actions]);

  useEffect(() => {
    if (!project?.id) {
      setDrawings([]);
      setPresetDrawings({});
      setLoading(false);
      return;
    }
    api.getFrameDrawings({ project_id: project.id })
      .then(setDrawings)
      .catch(() => setDrawings([]))
      .finally(() => setLoading(false));
  }, [project?.id]);

  useEffect(() => {
    const presetIds = [...new Set((project?.stellageConfigs || []).map((s) => s.presetId).filter(Boolean))];
    if (!presetIds.length) {
      setPresetDrawings({});
      return;
    }
    Promise.all(
      presetIds.map((pid) =>
        api.getFrameDrawings({ preset_id: pid })
          .then((rows) => ({ pid, rows }))
          .catch(() => ({ pid, rows: [] })),
      ),
    ).then((results) => {
      const map = {};
      results.forEach(({ pid, rows }) => {
        if (rows?.length) map[pid] = rows[0];
      });
      setPresetDrawings(map);
    });
  }, [project?.id, project?.stellageConfigs]);

  const handleRefreshBom = async ({ context, drawing }) => {
    if (!project?.id) return;
    const rackKey = context.moduleRackKey || context.rackId || context.stellageId || '';
    setRefreshBusyRack(rackKey);
    try {
      let drawingRow = drawing || null;
      if (drawingRow?.id && !drawingRow?.frameConfig) {
        try {
          drawingRow = await api.getFrameDrawing(drawing.id);
        } catch {
          /* legacy dedupe may still work without frameConfig */
        }
      }

      const catalog = materials?.length ? materials : await actions.ensureMaterials();
      const outcome = await executeFrameBomRefreshFromDrawing({
        project,
        drawing: drawingRow,
        drawingContext: context,
        materials: catalog,
        confirm,
        deleteItem: actions.itemDelete.bind(actions),
        updateProject: actions.projectUpdate.bind(actions),
        loadProject: actions.loadProject.bind(actions),
      });
      if (outcome.cancelled || outcome.skipped) return;
      const removed = outcome.summary?.removedCount ?? 0;
      success(
        removed > 0
          ? `BOM обновлён, старые дубли убраны: ${removed}.`
          : (outcome.summary?.title || 'BOM обновлён.'),
      );
    } catch (err) {
      error(err?.message || 'Не удалось обновить BOM.');
    } finally {
      setRefreshBusyRack('');
    }
  };

  if (!stellages.length) return null;

  return (
    <div className="card" id="stellages-panel" style={{ padding: 12, marginBottom: 10 }}>
      <h3 style={{ marginTop: 0, fontSize: 14, marginBottom: 6 }}>Схемы каркасов</h3>
      <p className="muted" style={{ fontSize: 11, margin: '0 0 8px' }}>
        «Обновить BOM» — в меню «Ещё», без открытия конструктора.
      </p>
      {loading ? (
        <p className="muted" style={{ fontSize: 13 }}>Загрузка…</p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {stellages.map((st) => {
            const rackDrawings = drawingsForProjectStellage(drawings, st.id);
            const presetDrawing = st.presetId ? presetDrawings[st.presetId] : null;
            const baseCtx = buildSavedProjectFrameDrawingContext(project, st);
            const ctx = {
              ...baseCtx,
              returnTo: returnPath || baseCtx.returnTo,
              rackLabel: st.name || baseCtx.rackLabel || '',
            };
            const moduleRackKey = ctx.moduleRackKey || st.id;
            const latestDrawing = rackDrawings[0] || null;
            const refreshState = canRefreshFrameBom({
              drawing: latestDrawing,
              drawings: rackDrawings,
              projectItems: project?.items || [],
              context: latestDrawing
                ? { ...ctx, drawingId: latestDrawing.id }
                : ctx,
              hasRefreshHandler: true,
            });
            return (
              <li key={st.id} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
                <div style={{ marginBottom: 6 }}>
                  <strong>{st.name}</strong>
                  <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{st.moduleName}</span>
                  {st.count > 1 && (
                    <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>×{st.count}</span>
                  )}
                </div>
                <FrameDrawingActions
                  context={ctx}
                  drawings={rackDrawings}
                  presetDrawing={presetDrawing}
                  projectItems={project?.items || []}
                  onRefreshBom={handleRefreshBom}
                  canRefreshBom={refreshState.enabled}
                  refreshBomBusy={refreshBusyRack === moduleRackKey}
                  refreshBomDisabled={!refreshState.enabled}
                />
                {!refreshState.enabled && refreshState.reason && latestDrawing && (
                  <p className="muted" style={{ fontSize: 10, margin: '4px 0 0' }}>
                    {refreshState.reason}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
