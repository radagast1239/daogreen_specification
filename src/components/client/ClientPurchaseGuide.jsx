import React, { useState } from "react";
import { t } from "../../../shared/clientI18n.js";

const STORAGE_KEY = "daogreen-client-guide-hidden";

function guideHiddenFor(projectId) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const ids = JSON.parse(raw);
    return Array.isArray(ids) && ids.includes(projectId);
  } catch {
    return false;
  }
}

function hideGuideFor(projectId) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    const next = Array.isArray(ids) ? [...new Set([...ids, projectId])] : [projectId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export default function ClientPurchaseGuide({ projectId, itemCount, uniqueCount, language = "ru" }) {
  const [hidden, setHidden] = useState(() => (projectId ? guideHiddenFor(projectId) : false));
  const [expanded, setExpanded] = useState(true);

  if (hidden) return null;

  const dismiss = () => {
    if (projectId) hideGuideFor(projectId);
    setHidden(true);
  };

  return (
    <div className="client-guide no-print">
      <div className="client-guide__head">
        <div className="client-guide__title">{t(language, "client.guide.title")}</div>
        <div className="client-guide__actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExpanded((v) => !v)}>
            {t(language, expanded ? "client.common.collapse" : "client.common.expand")}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={dismiss}>
            {t(language, "client.guide.dismiss")}
          </button>
        </div>
      </div>
      {expanded && (
        <>
          <p className="client-guide__lead">{t(language, "client.guide.lead")}</p>
          <div className="client-guide__grid">
            {[1, 2, 3, 4, 5, 6, 7].map((step) => (
              <section className="client-guide__block" key={step}>
                <div className="client-guide__block-title">{t(language, `client.guide.step${step}.title`)}</div>
                <p>{t(language, `client.guide.step${step}.text`)}</p>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
