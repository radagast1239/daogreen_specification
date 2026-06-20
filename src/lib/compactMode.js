const KEY = "daogreen-compact-tables";

export function getCompactMode() {
  return localStorage.getItem(KEY) === "1";
}

export function setCompactMode(on) {
  localStorage.setItem(KEY, on ? "1" : "0");
  document.documentElement.classList.toggle("compact-tables", on);
}

export function initCompactMode() {
  document.documentElement.classList.toggle("compact-tables", getCompactMode());
}
