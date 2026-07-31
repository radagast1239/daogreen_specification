import { useCallback, useRef } from "react";
import {
  getClipboardImageFile,
  isEditablePasteTarget,
  renameClipboardImageFile,
  screenshotDisplayName,
} from "./clipboardPhoto.js";

/**
 * Focused paste-zone handler for clipboard images.
 * Does not register document-level listeners.
 */
export function useClipboardImagePaste({ onImage, disabled = false } = {}) {
  const busyRef = useRef(false);
  const onImageRef = useRef(onImage);
  onImageRef.current = onImage;

  const onPaste = useCallback(
    (event) => {
      if (disabled || busyRef.current) return;
      if (isEditablePasteTarget(event)) return;
      const raw = getClipboardImageFile(event);
      if (!raw) return;
      event.preventDefault();
      const ext = (raw.name || "").split(".").pop() || "png";
      const file = renameClipboardImageFile(raw, screenshotDisplayName(new Date(), ext));
      busyRef.current = true;
      Promise.resolve(onImageRef.current?.(file))
        .catch(() => {})
        .finally(() => {
          busyRef.current = false;
        });
    },
    [disabled]
  );

  return {
    onPaste,
    pasteZoneProps: {
      tabIndex: 0,
      onPaste,
      role: "group",
      "data-paste-zone": "image",
    },
  };
}
