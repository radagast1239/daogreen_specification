/** Max length for admin releaseComment (manual publish note). */
export const RELEASE_COMMENT_MAX_LEN = 500;

/**
 * Normalize optional release comment for storage.
 * - trim edges
 * - preserve internal whitespace
 * - empty → null
 * - >500 → throws with code RELEASE_COMMENT_TOO_LONG
 * Stores plain text only (React escapes on render; no HTML execution).
 */
export function normalizeReleaseComment(raw) {
  if (raw == null) return null;
  const trimmed = String(raw).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!trimmed) return null;
  if (trimmed.length > RELEASE_COMMENT_MAX_LEN) {
    const err = new Error(`Комментарий к версии не длиннее ${RELEASE_COMMENT_MAX_LEN} символов`);
    err.code = "RELEASE_COMMENT_TOO_LONG";
    throw err;
  }
  return trimmed;
}
