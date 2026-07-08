import React from 'react';
import FrameDrawingTargetRow from './FrameDrawingTargetRow.jsx';
import {
  BUILDER_SAVE_AND_CREATE_FRAME_HINT,
  buildBuilderFrameDrawingContext,
} from '../../shared/frameDrawingContext.js';

export default function BuilderStellageFrameDrawingRow({
  stellage,
  projectId = '',
  projectName = '',
  onSaveProjectAndOpen,
  saving = false,
  compact = false,
}) {
  if (projectId) {
    const context = buildBuilderFrameDrawingContext({
      projectId,
      projectName,
      stellage,
    });
    const handleNavigate = onSaveProjectAndOpen
      ? (frameCtx) => onSaveProjectAndOpen(stellage, frameCtx)
      : null;
    return (
      <FrameDrawingTargetRow
        context={context}
        fetchParams={{
          project_id: projectId,
          stellage_id: stellage.id,
          module_rack_key: context.moduleRackKey,
        }}
        compact={compact}
        onNavigate={handleNavigate}
        navigateDisabled={saving}
      />
    );
  }

  return (
    <div className={compact ? '' : 'frame-drawing-actions'}>
      <div className="row between wrap" style={{ gap: 8 }}>
        <span className="muted" style={{ fontSize: 12 }}>Схема не создана</span>
        <span className="row wrap" style={{ gap: 6 }}>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            disabled={saving}
            onClick={() => onSaveProjectAndOpen?.(stellage)}
          >
            {saving ? 'Сохраняем черновик…' : 'Сохранить черновик и создать схему'}
          </button>
        </span>
      </div>
      <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>
        {BUILDER_SAVE_AND_CREATE_FRAME_HINT}
      </p>
    </div>
  );
}
