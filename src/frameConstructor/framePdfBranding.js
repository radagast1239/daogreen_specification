import { buildClientBrand } from '../lib/clientBrandConfig.js';
import { absolutePhotoUrl } from '../lib/photoHelpers.js';
import { loadPdfImage } from '../lib/pdfImageHelpers.js';

export const FRAME_PDF_BRAND_HEADER_H = 22;
export const FRAME_PDF_TAGLINE = 'Конструктор каркасов · спецификация и сборочный чертёж';
const FRAME_PDF_FALLBACK_CONTACT = 'Вертикальные фермы · модульные каркасы · daogreen.ru';

/** @param {object|null|undefined} raw */
export function normalizeFramePdfBranding(raw) {
  return buildClientBrand(raw || {});
}

export function hexToRgb(hex) {
  const h = (hex || '#116355').replace('#', '');
  if (h.length !== 6) return [17, 99, 85];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Вписать логотип в прямоугольник без искажения пропорций */
export function fitLogoRect(naturalW, naturalH, maxW, maxH) {
  const w = Number(naturalW) || 0;
  const h = Number(naturalH) || 0;
  if (!w || !h) return { w: maxW, h: maxH };
  const scale = Math.min(maxW / w, maxH / h);
  return { w: w * scale, h: h * scale };
}

/** @param {object} branding */
export function buildFramePdfHeaderContactLine(branding) {
  const parts = [
    branding.contactPhone,
    branding.contactEmail,
    branding.contactTelegram,
  ].filter(Boolean);
  if (parts.length) return parts.join('  ·  ');
  return FRAME_PDF_FALLBACK_CONTACT;
}

function pdfImageFormat(dataUrl) {
  if (typeof dataUrl !== 'string') return 'PNG';
  if (dataUrl.includes('image/jpeg') || dataUrl.includes('image/jpg')) return 'JPEG';
  if (dataUrl.includes('image/webp')) return 'WEBP';
  return 'PNG';
}

/** @param {object} branding */
export async function loadFramePdfLogoDataUrl(branding) {
  const url = absolutePhotoUrl(branding?.logoUrl);
  if (!url) return null;
  const img = await loadPdfImage(url);
  return img?.dataUrl || null;
}

function footerLine(branding) {
  const custom = branding.pdfFooter?.trim();
  if (custom) return custom;
  const parts = [
    branding.companyName || 'Daogreen',
    branding.contactPhone,
    branding.contactEmail,
    branding.contactTelegram,
  ].filter(Boolean);
  return parts.join(' · ');
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {object} branding
 * @param {string|null} logoDataUrl
 * @param {string} pageTitle
 * @param {number} pageW
 */
export function drawFramePdfBrandHeader(doc, branding, logoDataUrl, pageTitle, pageW = 420) {
  const [r, g, b] = hexToRgb(branding.brandColor);
  const x0 = 11;
  const y0 = 11;
  const w = pageW - 22;
  const h = FRAME_PDF_BRAND_HEADER_H - 2;

  doc.setFillColor(r, g, b);
  doc.rect(x0, y0, w, h, 'F');

  const logoPad = 2;
  const logoMaxW = 18;
  const logoMaxH = h - logoPad * 2;
  let textX = x0 + 5;

  if (logoDataUrl) {
    try {
      const props = doc.getImageProperties(logoDataUrl);
      const fit = fitLogoRect(props.width, props.height, logoMaxW, logoMaxH);
      const logoX = x0 + 4;
      const logoY = y0 + (h - fit.h) / 2;
      doc.addImage(
        logoDataUrl,
        pdfImageFormat(logoDataUrl),
        logoX,
        logoY,
        fit.w,
        fit.h,
        undefined,
        'FAST',
      );
      textX = logoX + fit.w + 5;
    } catch {
      /* ignore broken logo */
    }
  }

  const contactLine = buildFramePdfHeaderContactLine(branding);
  const titleReserve = pageTitle ? 72 : 0;
  const textMaxW = Math.max(40, w - (textX - x0) - titleReserve - 6);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text(branding.companyName || 'Daogreen', textX, y0 + 6.5, { maxWidth: textMaxW });

  doc.setFont(undefined, 'normal');
  doc.setFontSize(7.2);
  doc.text(FRAME_PDF_TAGLINE, textX, y0 + 11.5, { maxWidth: textMaxW });

  doc.setFontSize(6.4);
  doc.setTextColor(215, 235, 228);
  doc.text(contactLine, textX, y0 + 16.2, { maxWidth: textMaxW });

  if (pageTitle) {
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text(pageTitle, pageW - 13, y0 + 8, { align: 'right', maxWidth: 68 });
    doc.setFont(undefined, 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(215, 235, 228);
    doc.text('Daogreen CAD', pageW - 13, y0 + 14, { align: 'right' });
  }

  doc.setTextColor(0, 0, 0);
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {object} branding
 * @param {number} pageNo
 * @param {number} totalPages
 * @param {number} pageW
 * @param {number} pageH
 */
export function drawFramePdfBrandFooter(doc, branding, pageNo, totalPages, pageW = 420, pageH = 297) {
  const [r, g, b] = hexToRgb(branding.brandColor);
  const y = pageH - 11;

  doc.setDrawColor(r, g, b);
  doc.setLineWidth(0.25);
  doc.line(11, y - 3, pageW - 11, y - 3);

  doc.setFontSize(6.5);
  doc.setTextColor(90, 90, 90);
  doc.text(footerLine(branding), 13, y, { maxWidth: pageW - 52 });
  doc.text(`Стр. ${pageNo} / ${totalPages}`, pageW - 13, y, { align: 'right' });
  doc.setTextColor(0, 0, 0);
}
