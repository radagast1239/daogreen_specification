// Экспорт в CSV (открывается в Excel) и печать в PDF через окно браузера.

export function downloadCSV(filename, rows) {
  // rows: array of objects with consistent keys
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [headers.join(";")];
  for (const r of rows) lines.push(headers.map((h) => esc(r[h])).join(";"));
  // BOM для корректной кириллицы в Excel
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, filename.endsWith(".csv") ? filename : filename + ".csv");
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// PDF — простейший вариант MVP: печать текущей страницы (Ctrl+P → Сохранить как PDF).
// В v2 можно подключить, например, jsPDF для серверного/клиентского рендера.
export function printPDF() {
  window.print();
}
