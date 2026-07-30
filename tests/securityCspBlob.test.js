import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

describe("applySecurityMiddleware CSP", () => {
  it("allows blob: images in production for AuthMediaImg thumbs", () => {
    const src = readFileSync("backend/src/middleware/security.js", "utf8");
    expect(src).toMatch(/"img-src":\s*\["'self'",\s*"data:",\s*"blob:"\]/);
  });

  it("fetches admin media with cache no-store for AuthMediaImg", () => {
    const src = readFileSync("src/components/AuthMediaImg.jsx", "utf8");
    expect(src).toMatch(/cache:\s*["']no-store["']/);
    expect(src).not.toMatch(/cache:\s*["']force-cache["']/);
  });
});
