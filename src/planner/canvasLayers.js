/**
 * Отображение слоёв на холсте (этап 3): видимость, приглушение, подписи, размеры.
 */
import { layerOpacity } from "./geometry.js";
import { labelsVisible } from "./labelProperties.js";

export const CONTEXT_LAYERS = new Set(["room", "partitions"]);

export function isLayerOnSheet(sheet, layerId, vis = {}) {
  if (vis[layerId] === false) return false;
  if (sheet?.hiddenLayers?.includes(layerId)) return false;
  if (
    sheet?.visibleLayers?.length
    && !sheet.visibleLayers.includes(layerId)
    && !CONTEXT_LAYERS.has(layerId)
    && layerId !== "labels"
  ) {
    return false;
  }
  return true;
}

export function dimsVisible(layerId, activeLayer, display = {}, sheet = null) {
  const sh = sheet || display?.sheet;
  if (!display.showDims) return false;
  if (activeLayer === "install" || sh?.id === "install") return true;
  const sheetActive = sh?.activeLayer || activeLayer;
  if (layerId === sheetActive || layerId === activeLayer) return true;
  if (CONTEXT_LAYERS.has(layerId) && (activeLayer === layerId || sheetActive === layerId)) return true;
  return false;
}

export function layerDisplayState(layerId, activeLayer, vis, display = {}, sheet = null) {
  const onSheet = isLayerOnSheet(sheet, layerId, vis);
  const opacity = onSheet ? layerOpacity(layerId, activeLayer, true, display, sheet) : 0;
  const sheetActive = sheet?.activeLayer || activeLayer;
  const isActive = layerId === sheetActive || layerId === activeLayer;
  return {
    opacity,
    visible: opacity > 0,
    isActive,
    isContext: CONTEXT_LAYERS.has(layerId),
    isMuted: opacity > 0 && opacity < 0.92 && !isActive && !CONTEXT_LAYERS.has(layerId),
    showLabels: labelsVisible(layerId, activeLayer, display, sheet),
    showDims: dimsVisible(layerId, activeLayer, display, sheet),
    showZoneDetail: isActive || activeLayer === "install" || activeLayer === "zones",
  };
}
