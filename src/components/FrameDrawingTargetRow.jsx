import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import FrameDrawingActions from './FrameDrawingActions.jsx';

export default function FrameDrawingTargetRow({
  context,
  fetchParams,
  presetDrawing = null,
  compact = false,
  onNavigate = null,
  navigateDisabled = false,
}) {
  const [drawings, setDrawings] = useState([]);
  const paramsKey = JSON.stringify(fetchParams || {});

  useEffect(() => {
    if (!fetchParams || !Object.values(fetchParams).some(Boolean)) {
      setDrawings([]);
      return;
    }
    api.getFrameDrawings(fetchParams)
      .then(setDrawings)
      .catch(() => setDrawings([]));
  }, [paramsKey]);

  return (
    <FrameDrawingActions
      context={context}
      drawings={drawings}
      presetDrawing={presetDrawing}
      compact={compact}
      onNavigate={onNavigate}
      navigateDisabled={navigateDisabled}
    />
  );
}
