import { describe, expect, it } from "vitest";
import { uploadStartHref } from "./start-href";

describe("uploadStartHref", () => {
  it("sends a signed-out visitor through create account, then back to upload", () => {
    expect(uploadStartHref(false)).toBe("/sign-up?next=%2Ftranslate");
  });

  it("sends a signed-in visitor straight to upload", () => {
    expect(uploadStartHref(true)).toBe("/translate");
    expect(uploadStartHref(true, "/translate?service=diploma")).toBe("/translate?service=diploma");
  });
});
