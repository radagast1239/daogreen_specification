import React, { useState } from "react";

export default function PhotoGallery({ src, alt, className = "thumb-img thumb-img--lg" }) {
  const [open, setOpen] = useState(false);
  if (!src) return null;
  return (
    <>
      <button type="button" className="photo-gallery-trigger" onClick={() => setOpen(true)} aria-label="Открыть фото">
        <img src={src} alt={alt || ""} className={className} />
      </button>
      {open && (
        <div className="overlay photo-gallery-overlay" onClick={() => setOpen(false)}>
          <img src={src} alt={alt || ""} className="photo-gallery-full" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}
