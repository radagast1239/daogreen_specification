import { api } from "./api.js";
import {
  takeAccessTokenFromLocation,
  clearAccessHashFromUrl,
} from "./adminAccessHash.js";

/**
 * Exchange #access= token for HttpOnly session cookie, then scrub the fragment.
 * Never persists the token in storage or long-lived app state.
 */
export async function bootstrapAdminAccess() {
  const token = takeAccessTokenFromLocation();
  if (!token) return { exchanged: false };

  try {
    await api.exchangeMagicLink(token);
    clearAccessHashFromUrl();
    return { exchanged: true };
  } catch {
    clearAccessHashFromUrl();
    return { exchanged: false, error: true };
  }
}
