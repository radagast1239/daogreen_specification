/** Подбор zoom ортографической камеры R3F (frustum в px: ±width/2, ±height/2) */
export function computeFrameOrthoZoom(mode, size, viewportWidth, viewportHeight, padding = 1.06) {
  const [len, postH, depth] = size;
  const vw = Math.max(1, viewportWidth);
  const vh = Math.max(1, viewportHeight);

  let fitW;
  let fitH;
  if (mode === 'front') {
    fitW = len;
    fitH = postH;
  } else if (mode === 'side') {
    fitW = depth;
    fitH = postH;
  } else if (mode === 'top') {
    fitW = len;
    fitH = depth;
  } else {
    fitW = len + depth;
    fitH = postH + (len + depth) * 0.5;
  }

  return Math.min(
    vw / (Math.max(1, fitW) * padding),
    vh / (Math.max(1, fitH) * padding),
  );
}

export function frameCameraPosition(mode, center, size) {
  const [cx, cy, cz] = center;
  const maxDim = Math.max(size[0], size[1], size[2]);
  const dist = maxDim * 2.5;

  if (mode === 'front') return [cx, cy, cz + dist];
  if (mode === 'side') return [cx + dist, cy, cz];
  if (mode === 'top') return [cx, cy + dist, cz];
  return [cx + maxDim * 1.2, cy + maxDim * 1.2, cz + maxDim * 1.5];
}
