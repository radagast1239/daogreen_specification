import { describe, it, expect } from "vitest";
import { photoSrc } from "../src/lib/api.js";
import {
  resolveLinePhoto,
  linePhotoSrc,
  itemPhotoSrc,
  materialPhoto,
  clientPhotoSrc,
  clientMergedPhotoSrc,
} from "../src/lib/photoHelpers.js";

describe("photoHelpers", () => {
  it("resolveLinePhoto берёт фото из строки или из материала базы", () => {
    expect(resolveLinePhoto({ imageUrl: "/uploads/a.jpg" })).toBe("/uploads/a.jpg");
    expect(resolveLinePhoto({ photoUrl: "/uploads/b.jpg" })).toBe("/uploads/b.jpg");
    expect(
      resolveLinePhoto({ materialId: "m1" }, [{ id: "m1", imageUrl: "/uploads/mat.jpg" }])
    ).toBe("/uploads/mat.jpg");
    expect(resolveLinePhoto({})).toBe("");
    expect(resolveLinePhoto({ materialId: "nope" }, [])).toBe("");
  });

  it("materialPhoto отдаёт imageUrl/photoUrl материала", () => {
    expect(materialPhoto({ imageUrl: "/uploads/x.png" })).toBe("/uploads/x.png");
    expect(materialPhoto(null)).toBe("");
    expect(materialPhoto({})).toBe("");
  });

  it("linePhotoSrc уже применяет photoSrc — это готовый src, оборачивать повторно нельзя", () => {
    // Контракт: значение linePhotoSrc можно класть прямо в <img src>.
    // Двойная обёртка photoSrc(linePhotoSrc(...)) под base /spec/ давала /spec/spec/uploads/… (регресс).
    expect(linePhotoSrc({ imageUrl: "/uploads/a.jpg" })).toBe(photoSrc("/uploads/a.jpg"));
    expect(linePhotoSrc({})).toBe("");
  });

  it("itemPhotoSrc возвращает готовый src или пусто", () => {
    expect(itemPhotoSrc({ imageUrl: "/uploads/a.jpg" })).toBe(photoSrc("/uploads/a.jpg"));
    expect(itemPhotoSrc({})).toBe("");
    expect(itemPhotoSrc(null)).toBe("");
  });

  it("clientPhotoSrc routes private uploads through client media proxy", () => {
    expect(clientPhotoSrc({ imageUrl: "/uploads/m073.jpg" }, "tok")).toBe(
      `/api/client/p/tok/media?url=${encodeURIComponent("/uploads/m073.jpg")}`,
    );
    expect(clientPhotoSrc({ photoUrl: "/uploads/a.png" }, "tok%2Fx")).toBe(
      `/api/client/p/${encodeURIComponent("tok%2Fx")}/media?url=${encodeURIComponent("/uploads/a.png")}`,
    );
  });

  it("clientPhotoSrc keeps public and api paths on photoSrc", () => {
    expect(clientPhotoSrc({ imageUrl: "/uploads/public/legacy/x.jpg" }, "tok")).toBe(
      photoSrc("/uploads/public/legacy/x.jpg"),
    );
    expect(clientPhotoSrc({ accessUrl: "/api/client/p/tok/images/i1" }, "tok")).toBe(
      photoSrc("/api/client/p/tok/images/i1"),
    );
  });

  it("clientPhotoSrc without token falls back to photoSrc", () => {
    expect(clientPhotoSrc({ imageUrl: "/uploads/m073.jpg" }, "")).toBe(photoSrc("/uploads/m073.jpg"));
    expect(clientPhotoSrc({}, "tok")).toBe("");
  });

  it("clientMergedPhotoSrc prefers sourceItems[0]", () => {
    expect(
      clientMergedPhotoSrc(
        { imageUrl: "/uploads/row.jpg", sourceItems: [{ imageUrl: "/uploads/first.jpg" }] },
        "tok",
      ),
    ).toBe(`/api/client/p/tok/media?url=${encodeURIComponent("/uploads/first.jpg")}`);
    expect(clientMergedPhotoSrc({ imageUrl: "/uploads/row.jpg" }, "tok")).toBe(
      `/api/client/p/tok/media?url=${encodeURIComponent("/uploads/row.jpg")}`,
    );
  });
});

describe("photoSrc after upload hardening", () => {
  it("keeps absolute http(s) unchanged", () => {
    expect(photoSrc("https://cdn.example/a.jpg")).toBe("https://cdn.example/a.jpg");
    expect(photoSrc("http://cdn.example/a.jpg")).toBe("http://cdn.example/a.jpg");
  });

  it("passes through /api accessUrl paths", () => {
    expect(photoSrc("/api/client/p/tok/images/img1")).toBe("/api/client/p/tok/images/img1");
    expect(photoSrc("/api/materials/m1/photo")).toBe("/api/materials/m1/photo");
  });

  it("serves /uploads/public/** directly", () => {
    expect(photoSrc("/uploads/public/legacy/materials/abc.jpg")).toBe(
      "/uploads/public/legacy/materials/abc.jpg",
    );
  });

  it("routes other /uploads/** through admin media proxy", () => {
    expect(photoSrc("/uploads/projects/p1/scheme.jpg")).toBe(
      `/api/media/image?url=${encodeURIComponent("/uploads/projects/p1/scheme.jpg")}`,
    );
    expect(photoSrc("/uploads/mat.jpg")).toBe(
      `/api/media/image?url=${encodeURIComponent("/uploads/mat.jpg")}`,
    );
  });

  it("returns empty for falsy", () => {
    expect(photoSrc("")).toBe("");
    expect(photoSrc(null)).toBe("");
  });
});
