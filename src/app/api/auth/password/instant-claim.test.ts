import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateOrderToken } from "@/lib/orders/token";

const { createUser, signInWithPassword, emailHasAccount, claimOrdersByCustomerEmail, getOrderByHash, updateOrder, insertEvent } =
  vi.hoisted(() => ({
    createUser: vi.fn(),
    signInWithPassword: vi.fn(),
    emailHasAccount: vi.fn(),
    claimOrdersByCustomerEmail: vi.fn(),
    getOrderByHash: vi.fn(),
    updateOrder: vi.fn(),
    insertEvent: vi.fn(),
  }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { signInWithPassword } })),
  createServiceClient: vi.fn(() => ({ auth: { admin: { createUser } } })),
}));

vi.mock("@/lib/auth/email-link", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/email-link")>("@/lib/auth/email-link");
  return { ...actual, emailHasAccount };
});

vi.mock("@/lib/orders/storage", () => ({
  serviceDb: () => ({ kind: "service" }),
}));

vi.mock("@/lib/orders/db", () => ({
  claimOrdersByCustomerEmail,
  getOrderByHash,
  updateOrder,
  insertEvent,
}));

import { POST } from "./route";

const instantUser = {
  id: "user-1",
  email: "ada@example.com",
  email_confirmed_at: "2026-10-21T00:00:00Z",
  app_metadata: { email_verified: false },
};

function post(body: unknown) {
  return POST(
    new Request("https://www.credpronto.com/api/auth/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  createUser.mockReset();
  signInWithPassword.mockReset();
  emailHasAccount.mockReset();
  claimOrdersByCustomerEmail.mockReset();
  getOrderByHash.mockReset();
  updateOrder.mockReset();
  insertEvent.mockReset();
  emailHasAccount.mockResolvedValue(false);
  claimOrdersByCustomerEmail.mockResolvedValue(["other-guest-order"]);
  getOrderByHash.mockResolvedValue({ id: "token-order", userId: null, customerEmail: "ada@example.com" });
  updateOrder.mockResolvedValue(true);
  insertEvent.mockResolvedValue({});
  createUser.mockResolvedValue({ data: { user: instantUser }, error: null });
  signInWithPassword.mockResolvedValue({
    data: { user: instantUser, session: { access_token: "session-token" } },
    error: null,
  });
});

describe("instant sign-up order claiming", () => {
  it("does not claim another guest order that uses the same email", async () => {
    const token = generateOrderToken();
    const response = await post({
      email: "ada@example.com",
      password: "password1",
      mode: "sign-up",
      orderToken: token,
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.emailVerified).toBe(false);
    expect(payload.claimedOrderIds).toEqual(["token-order"]);
    expect(payload.claimedOrderIds).not.toContain("other-guest-order");
    expect(claimOrdersByCustomerEmail).not.toHaveBeenCalled();
    expect(updateOrder).toHaveBeenCalledWith(expect.anything(), "token-order", { user_id: "user-1" });
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "ada@example.com",
        email_confirm: true,
        app_metadata: { email_verified: false },
      }),
    );
  });

  it("links the token carried on next and still skips the other guest order", async () => {
    const token = generateOrderToken();
    const response = await post({
      email: "ada@example.com",
      password: "password1",
      mode: "sign-up",
      next: `/order/${token}`,
    });

    expect(response.status).toBe(200);
    expect((await response.json()).claimedOrderIds).toEqual(["token-order"]);
    expect(claimOrdersByCustomerEmail).not.toHaveBeenCalled();
    expect(getOrderByHash).toHaveBeenCalled();
  });
});
