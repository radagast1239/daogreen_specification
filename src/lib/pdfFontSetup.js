/** Регистрация Roboto для кириллицы в jsPDF (стандартные шрифты — только Latin-1). */

export const PDF_FONT = "Roboto";

const REGULAR_FILE = "Roboto-Regular.ttf";
const BOLD_FILE = "Roboto-Bold.ttf";

let fontsPromise = null;

function bufferToBinaryString(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return binary;
}

async function loadFontBinaries() {
  const [{ default: regularUrl }, { default: boldUrl }] = await Promise.all([
    import("../assets/fonts/Roboto-Regular.ttf?url"),
    import("../assets/fonts/Roboto-Bold.ttf?url"),
  ]);
  const [regularBuf, boldBuf] = await Promise.all([
    fetch(regularUrl).then((r) => r.arrayBuffer()),
    fetch(boldUrl).then((r) => r.arrayBuffer()),
  ]);
  return {
    regular: bufferToBinaryString(regularBuf),
    bold: bufferToBinaryString(boldBuf),
  };
}

function getFonts() {
  if (!fontsPromise) fontsPromise = loadFontBinaries();
  return fontsPromise;
}

function isRegistered(doc) {
  const list = doc.getFontList?.() || {};
  return Boolean(list[PDF_FONT]);
}

export async function setupPdfFonts(doc) {
  try {
    if (!isRegistered(doc)) {
      const { regular, bold } = await getFonts();
      doc.addFileToVFS(REGULAR_FILE, regular);
      doc.addFont(REGULAR_FILE, PDF_FONT, "normal");
      doc.addFileToVFS(BOLD_FILE, bold);
      doc.addFont(BOLD_FILE, PDF_FONT, "bold");
    }
    doc.setFont(PDF_FONT, "normal");
  } catch {
    // Roboto недоступен — не роняем PDF, откатываемся на встроенный шрифт.
    fontsPromise = null; // разрешить повторную попытку при следующем экспорте
    try {
      doc.setFont("helvetica", "normal");
    } catch {
      /* ignore — jsPDF сам подставит дефолтный шрифт */
    }
  }
  return doc;
}

export function pdfTableFontStyles() {
  return { font: PDF_FONT, fontStyle: "normal" };
}

export function pdfTableHeadFontStyles() {
  return { font: PDF_FONT, fontStyle: "bold" };
}
