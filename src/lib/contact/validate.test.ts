import { describe, expect, it } from "vitest";
import { allowContact, resetContactRateLimit } from "./rate-limit";
import { validateContact } from "./validate";

const valid = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  message: "I need help with a birth certificate.",
};

describe("contact validation", () => {
  it("accepts a complete message and keeps optional fields", () => {
    expect(
      validateContact({
        ...valid,
        company: " Northwind ",
        orderNumber: " CP-100 ",
        website: "  ",
      }),
    ).toEqual({
      ok: true,
      honeypot: false,
      value: {
        name: "Ada Lovelace",
        email: "ada@example.com",
        company: "Northwind",
        orderNumber: "CP-100",
        message: "I need help with a birth certificate.",
      },
    });
  });

  it("requires name, email, and message, and checks the email shape", () => {
    expect(validateContact({ company: "Northwind" })).toEqual({
      ok: false,
      errors: {
        name: "Enter your name.",
        email: "Enter your email.",
        message: "Tell us how we can help.",
      },
    });
    expect(validateContact({ ...valid, email: "not-an-email" })).toMatchObject({
      ok: false,
      errors: { email: "Enter a valid email address." },
    });
  });

  it("treats a filled honeypot as a drop, before field errors", () => {
    expect(validateContact({ website: "https://spam.example", email: "nope" })).toEqual({
      ok: true,
      honeypot: true,
    });
  });
});

describe("contact rate limit", () => {
  it("allows five messages per address inside the window", () => {
    resetContactRateLimit();
    const now = 1_000_000;
    for (let i = 0; i < 5; i += 1) expect(allowContact("203.0.113.8", now + i)).toBe(true);
    expect(allowContact("203.0.113.8", now + 6)).toBe(false);
    expect(allowContact("203.0.113.9", now + 6)).toBe(true);
    expect(allowContact("203.0.113.8", now + 10 * 60 * 1000)).toBe(true);
  });
});
