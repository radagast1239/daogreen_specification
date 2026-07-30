/**
 * SSRF / redirect / DNS hardening for imageProxy (unit + mocked fetch).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";

const testId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tempDir = path.join(os.tmpdir(), `daogreen-image-proxy-${testId}`);
const tempUploads = path.join(tempDir, "uploads");

const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
const FAKE = Buffer.from("not-an-image");

let parseProxyImageUrl;
let loadProxyImage;
let fetchRemoteImageSafe;
let isBlockedIpAddress;
let isPrivateHost;
let assertPublicDnsAddresses;

beforeAll(async () => {
  fs.mkdirSync(tempUploads, { recursive: true });
  process.env.UPLOAD_ROOT = tempUploads;
  process.env.NODE_ENV = "test";
  vi.resetModules();
  const mod = await import("../backend/src/services/imageProxy.js");
  parseProxyImageUrl = mod.parseProxyImageUrl;
  loadProxyImage = mod.loadProxyImage;
  fetchRemoteImageSafe = mod.fetchRemoteImageSafe;
  isBlockedIpAddress = mod.isBlockedIpAddress;
  isPrivateHost = mod.isPrivateHost;
  assertPublicDnsAddresses = mod.assertPublicDnsAddresses;
});

afterAll(() => {
  delete process.env.UPLOAD_ROOT;
  vi.resetModules();
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("blocked addresses / hosts", () => {
  it("blocks loopback, private, link-local, metadata, CGNAT, mapped IPv6", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "192.168.1.1",
      "172.16.5.5",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fc00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:10.1.2.3",
      "::ffff:169.254.169.254",
    ]) {
      expect(isBlockedIpAddress(ip), ip).toBe(true);
    }
    expect(isBlockedIpAddress("8.8.8.8")).toBe(false);
    expect(isPrivateHost("localhost")).toBe(true);
    expect(isPrivateHost("metadata.google.internal")).toBe(true);
    expect(isPrivateHost("127.0.0.1")).toBe(true);
    expect(isPrivateHost("[::1]")).toBe(true);
  });
});

describe("parseProxyImageUrl remote policy", () => {
  it("bans remote by default (including public https)", () => {
    expect(parseProxyImageUrl("https://cdn.example/a.png").error).toBeTruthy();
    expect(parseProxyImageUrl("http://cdn.example/a.png").error).toBeTruthy();
    expect(parseProxyImageUrl("http://127.0.0.1/x").error).toBeTruthy();
    expect(parseProxyImageUrl("https://169.254.169.254/latest").error).toBeTruthy();
    expect(parseProxyImageUrl("https://[::1]/x").error).toBeTruthy();
  });

  it("allowRemote still rejects http, userinfo, private hosts, non-443", () => {
    const o = { allowRemote: true };
    expect(parseProxyImageUrl("http://example.com/a.png", o).error).toBeTruthy();
    expect(parseProxyImageUrl("https://user:pass@example.com/a.png", o).error).toBeTruthy();
    expect(parseProxyImageUrl("https://127.0.0.1/a.png", o).error).toBeTruthy();
    expect(parseProxyImageUrl("https://example.com:8443/a.png", o).error).toBeTruthy();
    expect(parseProxyImageUrl("https://example.com/a.png", o).kind).toBe("remote");
  });

  it("allows public local uploads for client; blocks private prefixes", () => {
    fs.mkdirSync(path.join(tempUploads, "public"), { recursive: true });
    fs.writeFileSync(path.join(tempUploads, "public", "ok.jpg"), JPEG);
    expect(parseProxyImageUrl("/uploads/public/ok.jpg").kind).toBe("local");
    expect(parseProxyImageUrl("/uploads/projects/p1/x.jpg").error).toBeTruthy();
    expect(parseProxyImageUrl("/uploads/legacy-root.jpg").error).toBeTruthy();
  });
});

describe("DNS assert", () => {
  it("rejects hostname resolving to private", async () => {
    await expect(
      assertPublicDnsAddresses("evil.internal", async () => [{ address: "10.0.0.9", family: 4 }]),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects if any A/AAAA is private", async () => {
    await expect(
      assertPublicDnsAddresses("mixed.example", async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "192.168.0.2", family: 4 },
      ]),
    ).rejects.toMatchObject({ status: 400 });
  });
});

function mockResponse({ status = 200, headers = {}, body = JPEG } = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (k) => headers[String(k).toLowerCase()] ?? null,
    },
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    body: {
      getReader: () => {
        let done = false;
        return {
          read: async () => {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: buf };
          },
        };
      },
    },
  };
}

describe("safe remote fetch (allowRemote path)", () => {
  it("blocks redirect to localhost / private / metadata", async () => {
    const targets = [
      "http://127.0.0.1/secret",
      "http://localhost/secret",
      "https://[::1]/secret",
      "https://192.168.1.5/x",
      "https://169.254.169.254/latest/meta-data/",
      "https://10.0.0.1/x",
    ];
    for (const loc of targets) {
      await expect(
        fetchRemoteImageSafe("https://public.example/start", {
          lookup: async () => [{ address: "93.184.216.34", family: 4 }],
          fetch: async () =>
            mockResponse({
              status: 302,
              headers: { location: loc },
            }),
        }),
      ).rejects.toMatchObject({ status: 400 });
    }
  });

  it("re-validates each redirect hop; private final blocked", async () => {
    let hop = 0;
    await expect(
      fetchRemoteImageSafe("https://public.example/a", {
        lookup: async (host) => {
          if (String(host).includes("evil")) return [{ address: "10.1.1.1", family: 4 }];
          return [{ address: "93.184.216.34", family: 4 }];
        },
        fetch: async () => {
          hop += 1;
          if (hop === 1) {
            return mockResponse({
              status: 302,
              headers: { location: "https://mid.example/b" },
            });
          }
          return mockResponse({
            status: 302,
            headers: { location: "https://evil.example/private" },
          });
        },
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("blocks redirect loops and excessive redirects", async () => {
    await expect(
      fetchRemoteImageSafe("https://public.example/a", {
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        fetch: async () =>
          mockResponse({
            status: 302,
            headers: { location: "https://public.example/a" },
          }),
      }),
    ).rejects.toMatchObject({ status: 400 });

    let n = 0;
    await expect(
      fetchRemoteImageSafe("https://public.example/0", {
        maxRedirects: 2,
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        fetch: async () => {
          n += 1;
          return mockResponse({
            status: 302,
            headers: { location: `https://public.example/${n}` },
          });
        },
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("blocks oversized body, non-image, fake magic, SVG", async () => {
    const big = Buffer.alloc(6 * 1024 * 1024, 1);
    await expect(
      fetchRemoteImageSafe("https://public.example/big", {
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        fetch: async () =>
          mockResponse({ status: 200, headers: { "content-type": "image/jpeg" }, body: big }),
      }),
    ).rejects.toMatchObject({ status: 413 });

    await expect(
      fetchRemoteImageSafe("https://public.example/html", {
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        fetch: async () =>
          mockResponse({
            status: 200,
            headers: { "content-type": "text/html" },
            body: Buffer.from("<html>"),
          }),
      }),
    ).rejects.toMatchObject({ status: 415 });

    await expect(
      fetchRemoteImageSafe("https://public.example/fake", {
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        fetch: async () =>
          mockResponse({ status: 200, headers: { "content-type": "image/jpeg" }, body: FAKE }),
      }),
    ).rejects.toMatchObject({ status: 415 });

    await expect(
      fetchRemoteImageSafe("https://public.example/svg", {
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        fetch: async () =>
          mockResponse({
            status: 200,
            headers: { "content-type": "image/svg+xml" },
            body: SVG,
          }),
      }),
    ).rejects.toMatchObject({ status: 415 });
  });

  it("accepts valid public JPEG with pinned DNS", async () => {
    const result = await fetchRemoteImageSafe("https://public.example/ok.jpg", {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      fetch: async (url, init) => {
        expect(init.redirect).toBe("manual");
        expect(String(url)).toContain("93.184.216.34");
        return mockResponse({
          status: 200,
          headers: { "content-type": "image/jpeg" },
          body: JPEG,
        });
      },
    });
    expect(result.contentType).toBe("image/jpeg");
    expect(result.buffer[0]).toBe(0xff);
  });

  it("loadProxyImage does not follow remote without allowRemote", async () => {
    await expect(loadProxyImage("https://public.example/x.png")).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe("local mock HTTP server (no cloud metadata)", () => {
  it("does not contact loopback even if redirect claims success", async () => {
    let hit = false;
    const srv = http.createServer((_req, res) => {
      hit = true;
      res.writeHead(200, { "Content-Type": "image/jpeg" });
      res.end(JPEG);
    });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    const { port } = srv.address();

    await expect(
      fetchRemoteImageSafe("https://public.example/start", {
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        fetch: async () =>
          mockResponse({
            status: 302,
            headers: { location: `http://127.0.0.1:${port}/img` },
          }),
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect(hit).toBe(false);
    await new Promise((r) => srv.close(r));
  });
});
