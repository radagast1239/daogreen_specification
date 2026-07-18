/**
 * Intentional live overlays on published client releases.
 * Everything else must come from the immutable snapshot.
 */

/** Purchase progress fields overlaid by stable project item id. */
export const CLIENT_LIVE_PURCHASE_OVERLAY_FIELDS = Object.freeze([
  "status",
  "actualPrice",
  "clientComment",
]);

/**
 * Non-item live response channels (outside snapshot project object).
 * branding — intentional global site settings, not commercial release content.
 */
export const CLIENT_LIVE_RESPONSE_CHANNELS = Object.freeze({
  branding: "intentional_global_settings",
  purchaseOverlay: "status_actualPrice_clientComment",
  projectId: "routing",
  revision: "optimistic_locking",
  clientToken: "auth",
  activity: "live_feed",
});
