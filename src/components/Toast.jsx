import React, { createContext, useCallback, useContext, useState } from "react";

const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);

  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback(
    (message, { type = "info", ms = 3200 } = {}) => {
      const id = crypto.randomUUID();
      setToasts((t) => [...t, { id, message, type }]);
      setTimeout(() => dismiss(id), ms);
    },
    [dismiss]
  );

  const success = useCallback((msg) => toast(msg, { type: "ok" }), [toast]);
  const error = useCallback((msg) => toast(msg, { type: "danger", ms: 4500 }), [toast]);
  const info = useCallback((msg) => toast(msg, { type: "info" }), [toast]);

  const confirm = useCallback(
    ({ title = "Подтвердите", message = "", confirmLabel = "Да", cancelLabel = "Отмена" } = {}) =>
      new Promise((resolve) => {
        setConfirmState({ title, message, confirmLabel, cancelLabel, resolve });
      }),
    []
  );

  const closeConfirm = (result) => {
    confirmState?.resolve(result);
    setConfirmState(null);
  };

  return (
    <ToastCtx.Provider value={{ toast, success, error, info, confirm }}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.type}`} onClick={() => dismiss(t.id)}>
            {t.message}
          </div>
        ))}
      </div>
      {confirmState && (
        <div className="overlay" onClick={() => closeConfirm(false)}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>{confirmState.title}</strong>
            </div>
            <div className="modal-body">
              {confirmState.message && <p style={{ margin: 0, fontSize: 14 }}>{confirmState.message}</p>}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn" onClick={() => closeConfirm(false)}>
                {confirmState.cancelLabel}
              </button>
              <button type="button" className="btn btn-primary" onClick={() => closeConfirm(true)}>
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast outside ToastProvider");
  return ctx;
}
