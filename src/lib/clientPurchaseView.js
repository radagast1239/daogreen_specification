const LAYOUT_KEY = "daogreen-client-purchase-layout";
const COMPACT_KEY = "daogreen-client-compact-tables";

export function getClientPurchaseLayout() {
  return localStorage.getItem(LAYOUT_KEY) === "table" ? "table" : "cards";
}

export function setClientPurchaseLayout(layout) {
  localStorage.setItem(LAYOUT_KEY, layout === "table" ? "table" : "cards");
}

export function getClientCompactMode() {
  return localStorage.getItem(COMPACT_KEY) === "1";
}

export function setClientCompactMode(on) {
  localStorage.setItem(COMPACT_KEY, on ? "1" : "0");
}
