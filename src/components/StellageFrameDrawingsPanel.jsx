import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import FrameDrawingActions from './FrameDrawingActions.jsx';
import { drawingsForProjectStellage } from '../../shared/frameDrawingTargets.js';
import { buildSavedProjectFrameDrawingContext } from '../../shared/frameDrawingContext.js';

export default function StellageFrameDrawingsPanel({ project, returnPath }) {
  const stellages = project?.stellageConfigs || [];
  const [drawings, setDrawings] = useState([]);
  const [presetDrawings, setPresetDrawings] = useState({});
  const [loading, setLoading] = useState(true);

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

  if (!stellages.length) return null;

  return (
    <div className="card" id="stellages-panel" style={{ padding: 14, marginBottom: 12 }}>
      <h3 style={{ marginTop: 0, fontSize: 15 }}>Схемы каркасов</h3>
      <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
        PDF-схемы из конструктора каркасов. Привязаны к стеллажам проекта. BOM каркаса добавляется в закупку отдельной кнопкой в конструкторе.
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
            };
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
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
