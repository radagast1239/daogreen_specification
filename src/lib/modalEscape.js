/** Shared Modal Escape stack — topmost modal only, one document listener. */

const stack = [];
let listening = false;

export function isModalEscapeKey(event) {
  if (!event || event.defaultPrevented) return false;
  return event.key === "Escape" || event.key === "Esc";
}

/**
 * Close topmost registered modal if event is Escape.
 * Returns true when handled.
 */
export function dispatchModalEscape(event) {
  if (!isModalEscapeKey(event) || !stack.length) return false;
  if (typeof event.preventDefault === "function") event.preventDefault();
  const top = stack[stack.length - 1];
  if (typeof top === "function") top();
  return true;
}

function onDocumentKeyDown(event) {
  dispatchModalEscape(event);
}

/**
 * Register a modal close handler. Escape closes only the topmost registered modal.
 * Returns unregister function (safe to call more than once).
 */
export function registerModalEscape(onClose) {
  if (typeof onClose !== "function") return () => {};
  stack.push(onClose);
  if (!listening && typeof document !== "undefined") {
    document.addEventListener("keydown", onDocumentKeyDown);
    listening = true;
  }
  return () => {
    const i = stack.lastIndexOf(onClose);
    if (i >= 0) stack.splice(i, 1);
    if (!stack.length && listening && typeof document !== "undefined") {
      document.removeEventListener("keydown", onDocumentKeyDown);
      listening = false;
    }
  };
}

/** Test helper — current stack depth. */
export function modalEscapeStackDepth() {
  return stack.length;
}

/** Test helper — reset stack/listener state. */
export function resetModalEscapeStack() {
  stack.length = 0;
  listening = false;
}
