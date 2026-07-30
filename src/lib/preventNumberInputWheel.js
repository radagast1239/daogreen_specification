/**
 * Prevent mouse wheel / vertical touchpad from changing focused number inputs.
 * Capture-phase blur cancels the browser's native wheel increment without preventDefault,
 * so page scrolling keeps working.
 *
 * @param {Window | Document | EventTarget} [target=window]
 * @returns {() => void} detach
 */
export function attachNumberInputWheelGuard(target = typeof window !== "undefined" ? window : null) {
  if (!target || typeof target.addEventListener !== "function") {
    return () => {};
  }

  const onWheelCapture = () => {
    const active = typeof document !== "undefined" ? document.activeElement : null;
    if (!active) return;
    if (!(active instanceof HTMLInputElement)) return;
    if (active.type !== "number") return;
    if (document.activeElement === active) active.blur();
  };

  target.addEventListener("wheel", onWheelCapture, true);
  return () => target.removeEventListener("wheel", onWheelCapture, true);
}
