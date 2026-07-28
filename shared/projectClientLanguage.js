export const PROJECT_CLIENT_LANGUAGE_DEFAULT = "ru";
export const PROJECT_CLIENT_LANGUAGES = Object.freeze(["ru", "en"]);

export function normalizeProjectClientLanguage(value) {
  return value === "en" ? "en" : PROJECT_CLIENT_LANGUAGE_DEFAULT;
}

export function projectClientLanguage(project) {
  return normalizeProjectClientLanguage(
    project?.clientLanguage ?? project?.manualParams?.clientLanguage,
  );
}

export function validateProjectClientLanguage(value) {
  if (value === undefined) return undefined;
  if (PROJECT_CLIENT_LANGUAGES.includes(value)) return value;
  const error = new Error("Client language must be ru or en");
  error.code = "PROJECT_CLIENT_LANGUAGE_INVALID";
  throw error;
}

export function resolveClientLanguagePatch(body = {}) {
  const direct = body.clientLanguage;
  const nested = body.manualParams?.clientLanguage;
  if (direct === undefined && nested === undefined) return undefined;
  if (direct !== undefined && nested !== undefined && direct !== nested) {
    const error = new Error("Conflicting client language values");
    error.code = "PROJECT_CLIENT_LANGUAGE_INVALID";
    throw error;
  }
  return validateProjectClientLanguage(direct ?? nested);
}
