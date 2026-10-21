import { describe, expect, it } from "vitest";
import { emailIsVerified } from "./session";

describe("verified email", () => {
  it("accepts a confirmed email and a Google identity", () => {
    expect(emailIsVerified({ email: "ada@example.com", email_confirmed_at: "2026-10-12T00:00:00Z" })).toBe(true);
    expect(
      emailIsVerified({
        email: "ada@example.com",
        identities: [{ identity_data: { email_verified: true } }],
      }),
    ).toBe(true);
  });

  it("rejects an unconfirmed password signup", () => {
    expect(emailIsVerified({ email: "ada@example.com", email_confirmed_at: null })).toBe(false);
    expect(emailIsVerified({ email: null, email_confirmed_at: "2026-10-12T00:00:00Z" })).toBe(false);
  });

  it("treats an instant sign-up as unverified even when Supabase confirmed the email", () => {
    expect(
      emailIsVerified({
        email: "ada@example.com",
        email_confirmed_at: "2026-10-21T00:00:00Z",
        app_metadata: { email_verified: false },
        identities: [{ identity_data: { email_verified: true } }],
      }),
    ).toBe(false);
    expect(
      emailIsVerified({
        email: "ada@example.com",
        email_confirmed_at: "2026-10-21T00:00:00Z",
        app_metadata: { email_verified: true },
      }),
    ).toBe(true);
  });
});
