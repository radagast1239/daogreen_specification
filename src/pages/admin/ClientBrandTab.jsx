import React, { useEffect, useState } from "react";
import { api, photoSrc } from "../../lib/api.js";
import {
  buildClientBrand,
  CLIENT_TAB_OPTIONS,
  clientBrandToSettings,
  DEFAULT_PDF_COLUMN_IDS,
  DEFAULT_TRUST_LINES,
  DEFAULT_VISIBLE_TAB_IDS,
  PDF_COLUMN_OPTIONS,
} from "../../lib/clientBrandConfig.js";

function ColorField({ label, value, onChange }) {
  return (
    <label className="field" style={{ flex: "1 1 140px" }}>
      {label}
      <div className="row" style={{ gap: 8 }}>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 48, padding: 2 }} />
        <input value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </label>
  );
}

export default function ClientBrandTab({ settings, onSaved }) {
  const [brand, setBrand] = useState(() => buildClientBrand(settings));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setBrand(buildClientBrand(settings));
  }, [settings]);

  const patch = (key, value) => setBrand((b) => ({ ...b, [key]: value }));

  const toggleTab = (id) => {
    const set = new Set(brand.clientVisibleTabs);
    if (set.has(id)) {
      if (set.size <= 1) return;
      set.delete(id);
    } else {
      set.add(id);
    }
    patch("clientVisibleTabs", [...set]);
  };

  const togglePdfCol = (id) => {
    if (id === "name") return;
    const set = new Set(brand.pdfColumns);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    if (!set.has("name")) set.add("name");
    patch("pdfColumns", PDF_COLUMN_OPTIONS.map((c) => c.id).filter((cid) => set.has(cid)));
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.saveSettings(clientBrandToSettings(brand));
      onSaved?.();
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await api.uploadPhoto(file);
      patch("logoUrl", url);
    } catch (err) {
      alert(err.message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <div className="content">
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Бренд клиентской страницы, PDF и видимые вкладки. Контакты показываются внизу страницы закупки.
      </p>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Компания и контакты</h3>
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="field">
            <label>Название компании</label>
            <input value={brand.companyName} onChange={(e) => patch("companyName", e.target.value)} />
          </div>
          <div className="field">
            <label>Телефон</label>
            <input value={brand.contactPhone} onChange={(e) => patch("contactPhone", e.target.value)} />
          </div>
          <div className="field">
            <label>Email</label>
            <input value={brand.contactEmail} onChange={(e) => patch("contactEmail", e.target.value)} />
          </div>
          <div className="field">
            <label>Telegram</label>
            <input value={brand.contactTelegram} onChange={(e) => patch("contactTelegram", e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Логотип и цвета</h3>
        <div className="row wrap" style={{ gap: 16, alignItems: "flex-start", marginBottom: 16 }}>
          <div
            style={{
              width: 120,
              height: 80,
              border: "1px dashed var(--line)",
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#fff",
            }}
          >
            {brand.logoUrl ? (
              <img src={photoSrc(brand.logoUrl)} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
            ) : (
              <span className="muted" style={{ fontSize: 11 }}>нет лого</span>
            )}
          </div>
          <div>
            <label className="btn btn-sm" style={{ cursor: "pointer" }}>
              {uploading ? "Загрузка…" : "Загрузить логотип"}
              <input type="file" accept="image/*" hidden onChange={uploadLogo} disabled={uploading} />
            </label>
            {brand.logoUrl && (
              <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => patch("logoUrl", "")}>
                Убрать
              </button>
            )}
            <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
              PNG или JPG, используется в шапке PDF.
            </p>
          </div>
        </div>
        <div className="row wrap" style={{ gap: 12 }}>
          <ColorField label="Основной цвет" value={brand.brandColor} onChange={(v) => patch("brandColor", v)} />
          <ColorField label="Акцент" value={brand.brandAccentColor} onChange={(v) => patch("brandAccentColor", v)} />
          <ColorField label="Фон страницы" value={brand.brandBgColor} onChange={(v) => patch("brandBgColor", v)} />
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Тексты клиентской страницы</h3>
        <div className="field">
          <label>Строка над названием проекта</label>
          <input
            value={brand.clientHeroEyebrow}
            placeholder="{company} · вертикальные фермы"
            onChange={(e) => patch("clientHeroEyebrow", e.target.value)}
          />
          <span className="muted" style={{ fontSize: 11 }}>Подставка {"{company}"} → название компании</span>
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>Блок доверия (галочки)</label>
          {brand.clientTrustLines.map((line, i) => (
            <div key={i} className="row" style={{ gap: 8, marginTop: 8 }}>
              <input
                style={{ flex: 1 }}
                value={line}
                onChange={(e) => {
                  const next = [...brand.clientTrustLines];
                  next[i] = e.target.value;
                  patch("clientTrustLines", next);
                }}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={brand.clientTrustLines.length <= 1}
                onClick={() => patch("clientTrustLines", brand.clientTrustLines.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-sm"
            style={{ marginTop: 8 }}
            onClick={() => patch("clientTrustLines", [...brand.clientTrustLines, ""])}
          >
            ＋ строка
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Вкладки клиента</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Снимите галочку, чтобы скрыть вкладку (минимум одна должна остаться). «Охлаждение» видна только если в проекте есть расчёт.
        </p>
        <div className="row wrap" style={{ gap: 8 }}>
          {CLIENT_TAB_OPTIONS.map((t) => (
            <label key={t.id} className="chip row" style={{ gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={brand.clientVisibleTabs.includes(t.id)} onChange={() => toggleTab(t.id)} />
              {t.label}
            </label>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>PDF закупки</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Колонки таблицы в файле, который клиент скачивает с вкладки «Обзор».</p>
        <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
          {PDF_COLUMN_OPTIONS.map((c) => (
            <label key={c.id} className="chip row" style={{ gap: 6, cursor: c.required ? "default" : "pointer", opacity: c.required ? 0.7 : 1 }}>
              <input
                type="checkbox"
                checked={brand.pdfColumns.includes(c.id)}
                disabled={c.required}
                onChange={() => togglePdfCol(c.id)}
              />
              {c.label}
            </label>
          ))}
        </div>
        <div className="field">
          <label>Подвал PDF</label>
          <input
            value={brand.pdfFooter}
            placeholder="Daogreen · spec@example.com · актуально на дату выгрузки"
            onChange={(e) => patch("pdfFooter", e.target.value)}
          />
        </div>
        <label className="row" style={{ gap: 8, marginTop: 10, fontSize: 13 }}>
          <input type="checkbox" checked={brand.pdfShowQr} onChange={(e) => patch("pdfShowQr", e.target.checked)} />
          QR-код ссылки на проект в PDF
        </label>
      </div>

      <div className="toolbar">
        <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>
          {saving ? "Сохранение…" : "Сохранить"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            if (!window.confirm("Сбросить к значениям по умолчанию?")) return;
            setBrand({
              ...buildClientBrand({}),
              companyName: brand.companyName,
              contactPhone: brand.contactPhone,
              contactEmail: brand.contactEmail,
              contactTelegram: brand.contactTelegram,
              clientTrustLines: [...DEFAULT_TRUST_LINES],
              clientVisibleTabs: [...DEFAULT_VISIBLE_TAB_IDS],
              pdfColumns: [...DEFAULT_PDF_COLUMN_IDS],
            });
          }}
        >
          Сбросить оформление
        </button>
      </div>
    </div>
  );
}
