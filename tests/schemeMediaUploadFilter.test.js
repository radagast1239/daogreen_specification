import { describe, expect, it } from "vitest";
import {
  assertSchemeMediaBuffer,
  detectSchemeMediaKind,
  isAllowedUpload,
  multerFileFilter,
} from "../backend/src/services/uploadFilter.js";

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PDF = Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
const FAKE_PDF = Buffer.from("NOTAPDF content pretending");
const SVG = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>");

describe("scheme media upload filter", () => {
  it("detects magic bytes for jpeg/png/pdf", () => {
    expect(detectSchemeMediaKind(JPEG)).toBe("image/jpeg");
    expect(detectSchemeMediaKind(PNG)).toBe("image/png");
    expect(detectSchemeMediaKind(PDF)).toBe("application/pdf");
    expect(detectSchemeMediaKind(FAKE_PDF)).toBeNull();
    expect(detectSchemeMediaKind(SVG)).toBeNull();
  });

  it("assertSchemeMediaBuffer accepts valid PDF and images", () => {
    expect(assertSchemeMediaBuffer(PDF, { originalname: "plan.pdf", mimetype: "application/pdf" })).toEqual({
      mimeType: "application/pdf",
      ext: ".pdf",
    });
    expect(assertSchemeMediaBuffer(PNG, { originalname: "a.png", mimetype: "image/png" }).mimeType).toBe("image/png");
    expect(assertSchemeMediaBuffer(JPEG, { originalname: "a.jpg", mimetype: "image/jpeg" }).mimeType).toBe("image/jpeg");
  });

  it("rejects fake PDF, SVG, and mime mismatch", () => {
    expect(() => assertSchemeMediaBuffer(FAKE_PDF, { originalname: "x.pdf", mimetype: "application/pdf" })).toThrow(/допустимым/i);
    expect(() => assertSchemeMediaBuffer(SVG, { originalname: "x.svg", mimetype: "image/svg+xml" })).toThrow();
    expect(() => assertSchemeMediaBuffer(PDF, { originalname: "x.pdf", mimetype: "image/png" })).toThrow(/MIME/);
  });

  it("rejects oversize buffer", () => {
    const big = Buffer.concat([PDF, Buffer.alloc(26 * 1024 * 1024)]);
    expect(() => assertSchemeMediaBuffer(big, { originalname: "big.pdf", mimetype: "application/pdf" })).toThrow(/больш/i);
  });

  it("schemeMedia multer filter allows pdf/jpeg and rejects svg", () => {
    const filter = multerFileFilter({ schemeMedia: true });
    const accept = (file) =>
      new Promise((resolve, reject) => {
        filter({}, file, (err, ok) => (err ? reject(err) : resolve(ok)));
      });
    return Promise.all([
      expect(accept({ originalname: "a.pdf", mimetype: "application/pdf" })).resolves.toBe(true),
      expect(accept({ originalname: "a.jpg", mimetype: "image/jpeg" })).resolves.toBe(true),
      expect(accept({ originalname: "a.svg", mimetype: "image/svg+xml" })).rejects.toThrow(/SVG|JPEG|PDF/i),
    ]);
  });

  it("materials photo filter still rejects PDF", () => {
    expect(isAllowedUpload({ originalname: "x.pdf", mimetype: "application/pdf" })).toBe(false);
    expect(isAllowedUpload({ originalname: "x.pdf", mimetype: "application/pdf" }, { allowDocs: true })).toBe(true);
    expect(isAllowedUpload({ originalname: "x.pdf", mimetype: "application/pdf" }, { schemeMedia: true })).toBe(true);
  });

  it("path traversal originalname does not expand allow list", () => {
    expect(isAllowedUpload({ originalname: "../../evil.exe", mimetype: "application/pdf" }, { schemeMedia: true })).toBe(false);
    expect(isAllowedUpload({ originalname: "..\\..\\x.pdf", mimetype: "application/pdf" }, { schemeMedia: true })).toBe(true);
  });
});
