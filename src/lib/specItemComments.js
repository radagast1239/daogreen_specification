/** Хелперы комментариев к позиции спецификации (clientNote / internalNote). */

export function itemHasClientNote(item) {
  return String(item?.clientNote || "").trim().length > 0;
}

export function itemHasInternalNote(item) {
  return String(item?.internalNote || "").trim().length > 0;
}

export function itemHasAdminComments(item) {
  return itemHasClientNote(item) || itemHasInternalNote(item);
}
