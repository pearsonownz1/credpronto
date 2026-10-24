import { describe, expect, it } from "vitest";
import { matchEitherTitle } from "./evaluation";
import type { EdgeCredentialRecord } from "./edge";

const row = (id: string, title: string): EdgeCredentialRecord => ({
  id, title, countrySlug: "china", country: "China", content: "", levelNumber: null, levelTitle: null, url: null, usEquivalency: null,
});

describe("matchEitherTitle", () => {
  const rows = [row("bm", "Bachelor of Medicine (Yixue Xueshi)"), row("phd", "Doctor of Philosophy")];

  it("falls back to the English title when the native-script title does not match", () => {
    expect(matchEitherTitle(rows, { country: "China", credential: "医学学士学位", englishCredential: "Bachelor of Medicine" })?.id).toBe("bm");
  });

  it("prefers the printed title and ignores a missing English title", () => {
    expect(matchEitherTitle(rows, { country: "China", credential: "Doctor of Philosophy", englishCredential: "Bachelor of Medicine" })?.id).toBe("phd");
    expect(matchEitherTitle(rows, { country: "China", credential: "医学学士学位" })).toBeNull();
  });
});
