import { describe, it, expect } from "vitest";
import {
  CLIENT_LOAD_ERROR,
  classifyClientProjectLoadError,
  clientLinkActiveState,
  clientProjectLoadMessage,
} from "../shared/clientProjectLoadState.js";

describe("clientProjectLoadState", () => {
  it("classifies NOT_PUBLISHED from API code", () => {
    expect(classifyClientProjectLoadError({ status: 403, code: "NOT_PUBLISHED" })).toBe(
      CLIENT_LOAD_ERROR.NOT_PUBLISHED,
    );
  });

  it("shows user-friendly unpublished message", () => {
    const msg = clientProjectLoadMessage(CLIENT_LOAD_ERROR.NOT_PUBLISHED);
    expect(msg.title).toContain("не опубликован");
    expect(msg.hint).toContain("менеджер");
  });

  it("detects inactive client link without published release", () => {
    const state = clientLinkActiveState({
      clientToken: "abc",
      publishedRelease: null,
    });
    expect(state.hasClientToken).toBe(true);
    expect(state.clientLinkActive).toBe(false);
    expect(state.needsPublishBeforeClientLink).toBe(true);
  });

  it("active when token and published release exist", () => {
    const state = clientLinkActiveState({
      clientToken: "abc",
      publishedRelease: { versionId: "v1", versionNumber: 1 },
    });
    expect(state.clientLinkActive).toBe(true);
    expect(state.needsPublishBeforeClientLink).toBe(false);
  });
});
