import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateOrderToken } from "@/lib/orders/token";

const { emailHasAccount, generateConfirmLink, attachOrderToken, sendAuthLink } = vi.hoisted(() => ({
  emailHasAccount: vi.fn(),
  generateConfirmLink: vi.fn(),
  attachOrderToken: vi.fn(),
  sendAuthLink: vi.fn(),
}));

vi.mock("@/lib/auth/email-link", () => ({
  emailHasAccount,
  generateConfirmLink,
}));

vi.mock("@/lib/auth/order-link", () => ({
  attachOrderToken,
}));

vi.mock("@/lib/orders/email", () => ({
  sendAuthLink,
}));

vi.mock("@/lib/orders/email-templates", () => ({
  renderAuthLinkEmail: () => ({ subject: "Sign in", text: "link", html: "<p>link</p>" }),
}));

vi.mock("@/lib/orders/storage", () => ({
  serviceDb: () => ({ kind: "service" }),
}));

import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new Request("https://www.credpronto.com/api/auth/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  emailHasAccount.mockReset();
  generateConfirmLink.mockReset();
  attachOrderToken.mockReset();
  sendAuthLink.mockReset();
  emailHasAccount.mockResolvedValue(false);
  generateConfirmLink.mockResolvedValue({
    userId: "user-1",
    confirmUrl: "https://www.credpronto.com/auth/confirm?token_hash=hash",
  });
  attachOrderToken.mockResolvedValue("token-order");
  sendAuthLink.mockResolvedValue({ sent: true, skipped: false });
});

describe("POST /api/auth/magic-link", () => {
  it("stores the signup email on the quote carried by next", async () => {
    const token = generateOrderToken();
    const response = await post({ email: "ada@example.com", next: `/order/${token}` });
    expect(response.status).toBe(200);
    expect(attachOrderToken).toHaveBeenCalledWith(expect.anything(), "user-1", token, "ada@example.com");
    expect(generateConfirmLink).toHaveBeenCalledWith(expect.objectContaining({ orderToken: token, email: "ada@example.com" }));
  });

  it("waits for an existing account to open the link before attaching the quote", async () => {
    emailHasAccount.mockResolvedValue(true);
    const token = generateOrderToken();
    const response = await post({ email: "ada@example.com", orderToken: token });
    expect(response.status).toBe(200);
    expect(attachOrderToken).not.toHaveBeenCalled();
    expect(generateConfirmLink).toHaveBeenCalledWith(expect.objectContaining({ orderToken: token }));
  });
});
