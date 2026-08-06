export { computeWallDimChains } from "./wallDimChains.js";
export * from "./display.js";
export * from "./model.js";
export * from "./generateWallDimensions.js";
export * from "./runtime.js";
export * from "./anchorOperations.js";
export * from "./renderGeometry.js";
export * from "./dimensionLayout.js";
export * from "./dimensionCanonicalKeys.js";
export * from "./dimensionFaceResolver.js";
export * from "./selectedDimensionSemantics.js";
export * from "./activeDimensionArbitration.js";
export {
  buildSelectedWallCornerAngles,
  collectIncidentRays,
  chooseIntendedSector,
  presentCornerAngle,
  presentSelectedCornerAngles,
  cornerArcRadiusMm,
  selectedCornerArcRadiusMm,
  movementCornerArcRadiusMm,
  angleFontPx,
  anglesVisibleAtZoom,
  displayCornerAngleDeg,
  formatCornerAngleDisplay,
  normalizeDeg,
  nodeAdjacentSectors,
  sectorSumDeg,
} from "./cornerAngleDimensions.js";
export {
  SELECTED_ANGLE_FONT_PX,
  MOVEMENT_ANGLE_FONT_PX,
  ANGLE_FONT_MIN_PX,
  SELECTED_ARC_MIN_PX,
  SELECTED_ARC_MAX_PX,
  MOVEMENT_ARC_MIN_PX,
  MOVEMENT_ARC_MAX_PX,
  ANGLE_GRIP_CLEAR_PX,
  ANGLE_OVERVIEW_ZOOM,
  ANGLE_LOD_HIDE_ZOOM,
  ANGLE_LOD_SHOW_ZOOM,
  ANGLE_ZOOM_REF,
  ANGLE_CHIP_OPACITY,
  ANGLE_CHIP_OPACITY_MIN,
  ANGLE_CHIP_OPACITY_MAX,
  ANGLE_CHIP_PAD_X_PX,
  ANGLE_CHIP_PAD_Y_PX,
  ANGLE_CHIP_RADIUS_PX,
  ANGLE_FONT_WEIGHT,
  ANGLE_FONT_WEIGHT_MIN,
  ANGLE_FONT_WEIGHT_MAX,
  ANGLE_FONT_MIN_SELECTED_PX,
  ANGLE_FONT_MIN_MOVEMENT_PX,
  ANGLE_FONT_MAX_MOVEMENT_PX,
  ANGLE_STROKE_PX,
  ANGLE_STROKE_SELECTED_PX,
  ANGLE_STROKE_MOVEMENT_PX,
  ANGLE_SVG_PAINT_STACK,
  SELECTED_FONT_REF_PX,
  MOVEMENT_FONT_REF_PX,
  ANGLE_FONT_MAX_SELECTED_PX,
  angleStrokePx,
  zoomResponsivePx,
  arcRadiusScreenPx,
  angleLabelMinRadiusMm,
  angleGripOccupancy,
  angleChipLayoutPx,
  angleChipRectWorld,
  resolveAngleLabelPlacement,
  estimateAngleTextSizePx,
} from "./angleLabelPresentation.js";
export {
  MAGNET_ENTER_DEG,
  MAGNET_RELEASE_DEG,
  RELATIVE_MAGNET_OFFSETS_DEG,
  angularDiffDeg,
  buildRelativeMagnetCandidates,
  resolveAngleMagnet,
  resolveMagnetReference,
  resolveEndpointMagnetContext,
  resolveDraftMagnetContext,
  buildMovementAngleSectors,
  buildDraftMovementAngles,
  pointAtMagnetLength,
  emptyAngleMagnetPreview,
  buildAngleMagnetPreview,
} from "./angleMagnetSnap.js";
export {
  generateExternalOverallFromContours,
  generateExternalSegmentsFromContours,
  generateExteriorChainDimensions,
  suppressRedundantExteriorSegments,
  exteriorChainStackOrderOk,
  EXTERNAL_SEGMENT_MARGIN_MM,
  EXTERNAL_OVERALL_MARGIN_MM,
  EXTERNAL_OVERALL_ALONE_MARGIN_MM,
  MIN_EXTERIOR_SEG_MM,
} from "./exteriorChainDimensions.js";
export {
  generateRoomEdgeClearFromContours,
  MIN_ROOM_EDGE_MM,
  roomEdgeLengthFingerprint,
} from "./roomEdgeClearDimensions.js";
export {
  finalizeAutoDimensions,
  isRenderableAutoDimension,
  buildPhysicalSpanKey,
  dimensionMeasuredSpanMm,
  dimensionCoversWallId,
  classifyDimensionSide,
  DIM_LANE,
} from "./finalizeAutoDimensions.js";
export {
  generateContourDimensions,
  generateInternalClearFromContours,
  isRectangularRoomContour,
  auditAnchorsOnContour,
} from "./contourDimensions.js";
export {
  CONTOUR_ROLE,
  DIMENSION_SEMANTIC,
  FORBIDDEN_AUTOMATIC_SEMANTICS,
  classifyContourRoles,
  classifyDimensionSemantic,
  contourRoleOf,
  isForbiddenRoomBoundingBox,
  isRectangularContour,
  isSyntheticBboxFaceId,
} from "./contourSemantics.js";
