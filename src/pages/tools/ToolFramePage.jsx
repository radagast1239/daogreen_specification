import React, { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { berryCalculatorUrl, economicCalculatorUrl } from "../../lib/calcUrls.js";

export default function ToolFramePage({ tool }) {
  const [params] = useSearchParams();

  const src = useMemo(() => {
    const base = tool === "berry" ? berryCalculatorUrl() : economicCalculatorUrl();
    const qs = params.toString();
    if (!qs) return base;
    return base + (base.includes("?") ? "&" : "?") + qs;
  }, [tool, params]);

  const title = tool === "berry" ? "Калькулятор клубники" : "Калькулятор посадки и экономики";

  return (
    <div className="tool-frame-wrap">
      <div className="tool-frame-head">
        <h1>{title}</h1>
        <p className="muted">
          Открыт внутри Daogreen — данные сохраняются в адресе страницы. Можно скопировать ссылку из браузера.
        </p>
      </div>
      <iframe
        className="tool-frame"
        title={title}
        src={src}
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
