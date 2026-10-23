import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn(async () => ({ data: { id: "email-1" }, error: null })));

function sentMail(): { text: string; html: string } {
  const calls = send.mock.calls as unknown as { text: string; html: string }[][];
  const body = calls[0]?.[0];
  if (!body) throw new Error("email was not sent");
  return body;
}

vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

import { sendAuthLink, sendPreviewReady } from "./email";
import { renderAuthLinkEmail } from "./email-templates";

describe("customer emails that open the account", () => {
  beforeEach(() => {
    send.mockClear();
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "hello@credpronto.com");
    vi.stubEnv("APP_URL", "https://credpronto.com");
  });

  it("sends the preview-ready link to /dashboard", async () => {
    await sendPreviewReady("ada@example.com", {
      token: "order-token-secret",
      orderId: "order-9",
      sourceLanguage: "es",
      targetLanguage: "en",
      documentCount: 1,
      pageCount: 1,
      totalCents: 995,
      includesTranslation: true,
    });

    expect(send).toHaveBeenCalledTimes(1);
    const body = sentMail();
    expect(body.text).toContain("https://credpronto.com/dashboard");
    expect(body.html).toContain("https://credpronto.com/dashboard");
    expect(body.text).not.toContain("order-token-secret");
    expect(body.html).not.toContain("order-token-secret");
  });

  it("sends the confirm link we rendered", async () => {
    const rendered = renderAuthLinkEmail({
      confirmUrl: "https://credpronto.com/auth/confirm?token_hash=sample-hash&type=magiclink",
      purpose: "magiclink",
    });
    await sendAuthLink("ada@example.com", rendered);
    const body = sentMail();
    expect(body.text).toContain("/auth/confirm");
    expect(body.text).toContain("token_hash=sample-hash");
  });
});
