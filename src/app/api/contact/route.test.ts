import { afterEach, describe, expect, it, vi } from "vitest";
import { resetContactRateLimit } from "@/lib/contact/rate-limit";

vi.mock("@/lib/orders/email", () => ({
  sendContactMessage: vi.fn(),
}));

import { sendContactMessage } from "@/lib/orders/email";
import { POST } from "./route";

const sendContactMessageMock = vi.mocked(sendContactMessage);

const valid = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  message: "I need help with a document.",
};

function post(body: unknown, ip = "203.0.113.10") {
  return POST(
    new Request("https://www.credpronto.com/api/contact", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
}

afterEach(() => {
  sendContactMessageMock.mockReset();
  resetContactRateLimit();
});

describe("POST /api/contact", () => {
  it("sends a valid message", async () => {
    sendContactMessageMock.mockResolvedValue({ sent: true, skipped: false });
    const response = await post({ ...valid, company: "Northwind", orderNumber: "CP-100" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(sendContactMessageMock).toHaveBeenCalledWith({
      name: "Ada Lovelace",
      email: "ada@example.com",
      company: "Northwind",
      orderNumber: "CP-100",
      message: "I need help with a document.",
    });
  });

  it("returns field errors and does not send", async () => {
    const response = await post({ email: "ada@example.com" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      errors: { name: "Enter your name.", message: "Tell us how we can help." },
    });
    expect(sendContactMessageMock).not.toHaveBeenCalled();
  });

  it("drops a honeypot submission without sending", async () => {
    const response = await post({ ...valid, website: "https://spam.example" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(sendContactMessageMock).not.toHaveBeenCalled();
  });

  it("does not report success when email is not configured", async () => {
    sendContactMessageMock.mockResolvedValue({
      sent: false,
      skipped: true,
      detail: "RESEND_API_KEY or EMAIL_FROM is unset",
    });
    const response = await post(valid);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.detail).toMatch(/RESEND_API_KEY or EMAIL_FROM/);
  });

  it("rate limits an address after five messages", async () => {
    sendContactMessageMock.mockResolvedValue({ sent: true, skipped: false });
    for (let i = 0; i < 5; i += 1) {
      expect((await post(valid, "203.0.113.44")).status).toBe(200);
    }
    const blocked = await post(valid, "203.0.113.44");
    expect(blocked.status).toBe(429);
    expect(sendContactMessageMock).toHaveBeenCalledTimes(5);
  });
});
