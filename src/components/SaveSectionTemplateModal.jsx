import React, { useState } from "react";

const SUGGESTIONS = [
  "Насосная группа — малый проект",
  "Климат — помещение до 50 м²",
  "Электрика — базовая",
  "Расходники запуска — микрозелень",
];

export default function SaveSectionTemplateModal({ module, itemCount, onClose, onSave }) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      await onSave({ name: name.trim(), note: note.trim() });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Сохранить раздел как шаблон</strong>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Раздел: <b>{module}</b> · {itemCount} поз. (типы, количества, группы, видимость, ответственный, порядок)
        </p>
        <div className="field">
          <label>Название шаблона</label>
          <input value={name} onChange={(e) => setName(e.target.value)} list="tpl-suggestions" />
          <datalist id="tpl-suggestions">
            {SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <div className="field">
          <label>Заметка (необязательно)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="row wrap" style={{ gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="button" className="btn btn-primary" disabled={!name.trim() || loading} onClick={submit}>
            {loading ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  );
}
