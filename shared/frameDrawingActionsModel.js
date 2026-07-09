import { buildFrameDrawingLink } from "./frameDrawingContext.js";

export const FRAME_BOM_REFRESH_BUTTON_LABEL = "Обновить BOM";
export const FRAME_DRAWING_EDIT_SCHEME_LABEL = "Редактировать схему";
export const FRAME_DRAWING_OPEN_SCHEME_LABEL = "Открыть схему";

/**
 * @param {string} label
 * @param {object} context
 */
export function resolveFrameDrawingActionBehavior(label, context = {}) {
  if (label === FRAME_BOM_REFRESH_BUTTON_LABEL) {
    return {
      action: "refresh_bom",
      navigates: false,
      opensConstructor: false,
      constructorTab: null,
      href: null,
    };
  }

  if (label === FRAME_DRAWING_OPEN_SCHEME_LABEL) {
    return {
      action: "open_scheme",
      navigates: true,
      opensConstructor: true,
      constructorTab: null,
      href: buildFrameDrawingLink(context),
    };
  }

  if (label === FRAME_DRAWING_EDIT_SCHEME_LABEL) {
    return {
      action: "edit_scheme",
      navigates: true,
      opensConstructor: true,
      constructorTab: null,
      href: buildFrameDrawingLink(context),
    };
  }

  return {
    action: "navigate",
    navigates: true,
    opensConstructor: true,
    constructorTab: context.constructorTab || null,
    href: buildFrameDrawingLink(context),
  };
}
