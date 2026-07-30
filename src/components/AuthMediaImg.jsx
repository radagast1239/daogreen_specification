import React, { useEffect, useState } from "react";
import { getAdminKey } from "../lib/api.js";

/**
 * <img> for admin media proxy URLs that need session cookie and/or X-Admin-Key.
 * Plain <img src="/api/media/image?..."> cannot send the admin key header.
 */
export default function AuthMediaImg({ src, alt = "", className, style, loading, ...rest }) {
  const [blobUrl, setBlobUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    setBlobUrl("");
    if (!src) return undefined;

    const needsAuthFetch = String(src).includes("/api/media/image");
    if (!needsAuthFetch) {
      setBlobUrl(src);
      return undefined;
    }

    (async () => {
      try {
        const headers = {};
        const key = getAdminKey();
        if (key) headers["X-Admin-Key"] = key;
        const res = await fetch(src, { headers, credentials: "include", cache: "no-store" });
        if (!res.ok || cancelled) return;
        const blob = await res.blob();
        if (!blob || blob.size <= 0 || cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setBlobUrl(objectUrl);
      } catch {
        /* leave broken/empty */
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (!blobUrl) return null;
  return <img src={blobUrl} alt={alt} className={className} style={style} loading={loading} {...rest} />;
}
