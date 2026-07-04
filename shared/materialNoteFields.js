/** Значение текстового поля заметки материала для записи в БД. */
export function resolveMaterialNoteField(obj, key) {
  if (Object.prototype.hasOwnProperty.call(obj || {}, key)) {
    const value = obj[key];
    return value === undefined || value === null ? "" : String(value);
  }
  return undefined;
}
