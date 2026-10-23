import { beforeEach, describe, expect, it, vi } from "vitest";

const { createUser, generateLink, signInWithPassword, emailHasAccount, finishAuthenticatedUser, finishInstantSignup } =
  vi.hoisted(() => ({
    createUser: vi.fn(),
    generateLink: vi.fn(),
    signInWithPassword: vi.fn(),
    emailHasAccount: vi.fn(),
    finishAuthenticatedUser: vi.fn(),
    finishInstantSignup: vi.fn(),
  }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { signInWithPassword } })),
  createServiceClient: vi.fn(() => ({ auth: { admin: { createUser, generateLink } } })),
}));

vi.mock("@/lib/auth/email-link", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/email-link")>("@/lib/auth/email-link");
  return { ...actual, emailHasAccount };
});

vi.mock("@/lib/auth/finish", () => ({
  finishAuthenticatedUser,
  finishInstantSignup,
}));

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { POST } from "./route";

const confirmedUser = {
  id: "user-1",
  email: "ada@example.com",
  email_confirmed_at: "2026-10-21T00:00:00Z",
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
  generateLink.mockReset();
  signInWithPassword.mockReset();
  emailHasAccount.mockReset();
  finishAuthenticatedUser.mockReset();
  finishInstantSignup.mockReset();
  vi.mocked(createClient).mockClear();
  vi.mocked(createServiceClient).mockClear();
  emailHasAccount.mockResolvedValue(false);
  finishAuthenticatedUser.mockResolvedValue(["order-1"]);
  finishInstantSignup.mockResolvedValue(["token-order"]);
  createUser.mockResolvedValue({ data: { user: confirmedUser }, error: null });
  signInWithPassword.mockResolvedValue({
    data: { user: confirmedUser, session: { access_token: "session-token" } },
    error: null,
  });
});

describe("POST /api/auth/password sign-up", () => {
  it("creates a confirmed user, signs them in on the cookie client, and returns a session", async () => {
    const response = await post({
      email: "ada@example.com",
      password: "password1",
      name: "Ada Lovelace",
      mode: "sign-up",
      orderToken: "order-token",
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      userId: "user-1",
      session: true,
      claimedOrderIds: ["token-order"],
      emailVerified: false,
      next: "/translate",
    });
    expect(JSON.stringify(payload)).not.toContain("Check your email");
    expect(createUser).toHaveBeenCalledWith({
      email: "ada@example.com",
      password: "password1",
      email_confirm: true,
      app_metadata: { email_verified: false },
      user_metadata: { full_name: "Ada Lovelace" },
    });
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "ada@example.com",
      password: "password1",
    });
    expect(createClient).toHaveBeenCalledOnce();
    expect(generateLink).not.toHaveBeenCalled();
    expect(finishInstantSignup).toHaveBeenCalledWith("user-1", "order-token", "ada@example.com");
    expect(finishAuthenticatedUser).not.toHaveBeenCalled();
  });

  it("returns a same-origin next path and attaches the guest order it names", async () => {
    const token = "b".repeat(43);
    const response = await post({
      email: "ada@example.com",
      password: "password1",
      mode: "sign-up",
      next: `/confirm?token=${token}`,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ session: true, next: `/confirm?token=${token}` });
    expect(finishInstantSignup).toHaveBeenCalledWith("user-1", token, "ada@example.com");
    expect(finishAuthenticatedUser).not.toHaveBeenCalled();
  });

  it("drops an off-origin next path and does not take an order token from it", async () => {
    const token = "c".repeat(43);
    const response = await post({
      email: "ada@example.com",
      password: "password1",
      mode: "sign-up",
      next: `https://evil.example/order/${token}`,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ next: "/translate" });
    expect(finishInstantSignup).toHaveBeenCalledWith("user-1", null, "ada@example.com");
    expect(finishAuthenticatedUser).not.toHaveBeenCalled();
  });

  it("keeps an explicit order token ahead of the one in next", async () => {
    const bodyToken = "d".repeat(43);
    const nextToken = "e".repeat(43);
    await post({
      email: "ada@example.com",
      password: "password1",
      mode: "sign-up",
      orderToken: bodyToken,
      next: `/preview/${nextToken}`,
    });
    expect(finishInstantSignup).toHaveBeenCalledWith("user-1", bodyToken, "ada@example.com");
    expect(finishAuthenticatedUser).not.toHaveBeenCalled();
  });

  it("omits user metadata when no name is sent", async () => {
    await post({ email: "ada@example.com", password: "password1", mode: "sign-up" });
    expect(createUser).toHaveBeenCalledWith({
      email: "ada@example.com",
      password: "password1",
      email_confirm: true,
      app_metadata: { email_verified: false },
    });
  });

  it("keeps the duplicate-email response and does not create another user", async () => {
    emailHasAccount.mockResolvedValue(true);
    const response = await post({ email: "ada@example.com", password: "password1", mode: "sign-up" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Log in", code: "account_exists" });
    expect(createUser).not.toHaveBeenCalled();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("maps an admin duplicate to the same login response", async () => {
    createUser.mockResolvedValue({
      data: { user: null },
      error: { message: "A user with this email address has already been registered", code: "email_exists" },
    });
    const response = await post({ email: "ada@example.com", password: "password1", mode: "sign-up" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Log in", code: "account_exists" });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("rejects a short password before calling the admin API", async () => {
    const response = await post({ email: "ada@example.com", password: "short", mode: "sign-up" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "password must be at least 8 characters" });
    expect(createUser).not.toHaveBeenCalled();
  });

  it("returns the admin weak-password message", async () => {
    createUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Password is known to be weak and easy to guess, please choose a different one.", code: "weak_password" },
    });
    const response = await post({ email: "ada@example.com", password: "password1", mode: "sign-up" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Password is known to be weak and easy to guess, please choose a different one.",
    });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("reports auth as unconfigured when the service client cannot be created", async () => {
    vi.mocked(createServiceClient).mockImplementationOnce(() => {
      throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
    });
    const response = await post({ email: "ada@example.com", password: "password1", mode: "sign-up" });
    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload).toEqual({ error: "Auth is not configured" });
    expect(JSON.stringify(payload)).not.toMatch(/SERVICE_ROLE|eyJ/);
  });
});

describe("POST /api/auth/password sign-in", () => {
  it("still tells an unconfirmed account to confirm, without creating a user", async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Email not confirmed" },
    });
    const response = await post({ email: "ada@example.com", password: "password1" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Check your email to confirm your account.",
      code: "email_unconfirmed",
    });
    expect(createUser).not.toHaveBeenCalled();
  });
});
