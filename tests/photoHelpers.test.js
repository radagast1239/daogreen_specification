import { describe, it, expect } from "vitest";
import { photoSrc } from "../src/lib/api.js";
import {
  resolveLinePhoto,
  linePhotoSrc,
  itemPhotoSrc,
  materialPhoto,
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
});
