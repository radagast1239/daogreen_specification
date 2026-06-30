import React, { useEffect, useRef, useState } from "react";
import { DEFAULT_LABEL_FONT_PT, LABEL_FONT_SIZES } from "../labelProperties.js";

export function PlannerLabelModal({ open, targetName, onConfirm, onCancel }) {
  const [text, setText] = useState("");
  const [fontSizePt, setFontSizePt] = useState(DEFAULT_LABEL_FONT_PT);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setText("");
    setFontSizePt(DEFAULT_LABEL_FONT_PT);
    const t = setTimeout(() => textareaRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [open]);

  if (!open) return null;

  const submit = () => {
    onConfirm({ text: text.trim(), fontSizePt });
  };

  return (
    <div className="planner-visual-modal" role="dialog" aria-modal="true" aria-label="Новая подпись">
      <button type="button" className="planner-visual-modal__backdrop" aria-label="Отмена" onClick={onCancel} />
      <div className="planner-visual-modal__panel planner-label-modal__panel">
        <div className="planner-visual-modal__head">
          <div>
            <div className="planner-visual-modal__title">Подпись</div>
            <div className="planner-visual-modal__sub">
              Точка на плане задана
              {targetName ? ` · ${targetName}` : ""}
            </div>
          </div>
        </div>
        <div className="planner-label-modal__body">
          <div className="planner-field">
            <label>Текст подписи</label>
            <textarea
              ref={textareaRef}
              rows={4}
              value={text}
              placeholder="Например: Канализационная труба 110 мм"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </div>
          <div className="planner-field">
            <label>Размер шрифта, pt</label>
            <select value={fontSizePt} onChange={(e) => setFontSizePt(+e.target.value)}>
              {LABEL_FONT_SIZES.map((pt) => (
                <option key={pt} value={pt}>{pt}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="planner-label-modal__foot">
          <button type="button" className="planner-btn" onClick={onCancel}>Отмена</button>
          <button type="button" className="planner-btn planner-btn--primary" onClick={submit}>Применить</button>
        </div>
      </div>
    </div>
  );
}
