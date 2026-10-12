import { describe, expect, it } from "vitest";
import { BRAND_NAME } from "./brand";
import { emailFromHeader } from "./email";

describe("email from header", () => {
  it("uses the CredPronto display name and keeps the mailbox", () => {
    expect(emailFromHeader("Ada Lovelace <hello@credpronto.com>")).toBe(`${BRAND_NAME} <hello@credpronto.com>`);
    expect(emailFromHeader("hello@credpronto.com")).toBe(`${BRAND_NAME} <hello@credpronto.com>`);
  });
});
