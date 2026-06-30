import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { jsPDF } from "jspdf";
import { setupPdfFonts, PDF_FONT } from "../src/lib/pdfFontSetup.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function bufferToBinaryString(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return binary;
}

beforeAll(() => {
  const regular = readFileSync(path.join(root, "src/assets/fonts/Roboto-Regular.ttf"));
  const bold = readFileSync(path.join(root, "src/assets/fonts/Roboto-Bold.ttf"));
  globalThis.fetch = async (url) => {
    const name = String(url).includes("Bold") ? "Roboto-Bold.ttf" : "Roboto-Regular.ttf";
    const buf = name.includes("Bold") ? bold : regular;
    return {
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    };
  };
});

describe("pdfFontSetup", () => {
  it("registers Roboto and renders Cyrillic in PDF output", async () => {
    const doc = new jsPDF();
    await setupPdfFonts(doc);
    expect(doc.getFontList()[PDF_FONT]).toBeTruthy();
    doc.text("Закупочный лист — полная версия", 14, 20);
    const out = doc.output("arraybuffer");
    const text = new TextDecoder("latin1").decode(new Uint8Array(out));
    expect(text).toContain("Roboto");
    expect(text).not.toMatch(/0 : C \? > G/);
  });
});
