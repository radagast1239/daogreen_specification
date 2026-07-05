import React, { useEffect, useState } from 'react';
import { api, photoSrc } from '../lib/api.js';
import FrameDrawingLinkButton from './FrameDrawingLinkButton.jsx';

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

  const drawingForRack = (rackId) =>
    drawings.find((d) => d.stellageId === rackId);

  return (
    <div className="card" style={{ padding: 14, marginBottom: 12 }}>
      <h3 style={{ marginTop: 0, fontSize: 15 }}>Чертежи каркасов</h3>
      <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
        PDF-чертежи из конструктора каркасов. Не влияют на спецификацию материалов.
      </p>
      {loading ? (
        <p className="muted" style={{ fontSize: 13 }}>Загрузка…</p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {stellages.map((st) => {
            const drawing = drawingForRack(st.id);
            const presetDrawing = st.presetId ? presetDrawings[st.presetId] : null;
            const ctx = {
              projectId: project.id,
              moduleId: st.moduleId,
              rackId: st.id,
              presetId: st.presetId || '',
              sourceType: 'project_rack',
              rackLabel: st.name,
              projectName: project.name,
              returnTo: returnPath || `/project/${project.id}`,
              drawingId: drawing?.id || '',
            };
            return (
              <li key={st.id} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
                <div className="row between wrap" style={{ gap: 8 }}>
                  <div>
                    <strong>{st.name}</strong>
                    <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{st.moduleName}</span>
                  </div>
                  <span className="row wrap" style={{ gap: 6 }}>
                    {drawing ? (
                      <>
                        <span className="chip chip--ok" style={{ fontSize: 11 }}>PDF прикреплён</span>
                        <a className="btn btn-sm" href={photoSrc(drawing.pdfUrl)} target="_blank" rel="noreferrer">Открыть</a>
                        <FrameDrawingLinkButton context={ctx} label="Заменить" />
                      </>
                    ) : presetDrawing ? (
                      <>
                        <span className="chip" style={{ fontSize: 11 }}>Есть чертёж пресета</span>
                        <a className="btn btn-sm" href={photoSrc(presetDrawing.pdfUrl)} target="_blank" rel="noreferrer">Открыть чертёж пресета</a>
                        <FrameDrawingLinkButton context={ctx} label="Создать чертёж каркаса" />
                      </>
                    ) : (
                      <FrameDrawingLinkButton context={ctx} label="Создать чертёж каркаса" />
                    )}
                  </span>
                </div>
                {drawing && (
                  <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                    {drawing.title} · v{drawing.version} · {new Date(drawing.updatedAt || drawing.createdAt).toLocaleDateString('ru-RU')}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
