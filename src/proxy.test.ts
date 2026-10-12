import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockAccountFor } from "@/lib/account/names";
import { MOCK_COOKIE } from "@/lib/account/session";
import { proxy } from "@/proxy";

function mockCookie(email: string): string {
  return `${MOCK_COOKIE}=${Buffer.from(JSON.stringify(mockAccountFor(email)), "utf8").toString("base64url")}`;
}

describe("dashboard server auth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends a signed-out dashboard request to sign-in", async () => {
    vi.stubEnv("CREDPRONTO_MOCK", "");
    vi.stubEnv("NEXT_PUBLIC_CREDPRONTO_MOCK", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");

    const response = await proxy(new NextRequest("http://127.0.0.1:3000/dashboard/integrations?tab=keys"));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("next")).toBe("/dashboard/integrations?tab=keys");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("sends /dashboard to sign-in with that return path", async () => {
    vi.stubEnv("CREDPRONTO_MOCK", "");
    vi.stubEnv("NEXT_PUBLIC_CREDPRONTO_MOCK", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    const response = await proxy(new NextRequest("http://127.0.0.1:3000/dashboard"));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("next")).toBe("/dashboard");
  });

  it("marks a signed-in dashboard response private", async () => {
    vi.stubEnv("CREDPRONTO_MOCK", "1");

    const response = await proxy(
      new NextRequest("http://127.0.0.1:3000/dashboard", {
        headers: { cookie: mockCookie("maria.ruiz@email.com") },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("treats a mock cookie as signed out when it is not an account", async () => {
    vi.stubEnv("CREDPRONTO_MOCK", "1");

    const response = await proxy(
      new NextRequest("http://127.0.0.1:3000/dashboard/settings", {
        headers: { cookie: `${MOCK_COOKIE}=not-an-account` },
      }),
    );

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("next")).toBe("/dashboard/settings");
  });

  it("sends a signed-out order id to sign-in", async () => {
    vi.stubEnv("CREDPRONTO_MOCK", "");
    vi.stubEnv("NEXT_PUBLIC_CREDPRONTO_MOCK", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    const id = "11111111-1111-4111-8111-111111111111";
    const response = await proxy(new NextRequest(`http://127.0.0.1:3000/preview/${id}`));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("next")).toBe(`/preview/${id}`);
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("lets a signed-in order id through to the page", async () => {
    vi.stubEnv("CREDPRONTO_MOCK", "1");

    const id = "11111111-1111-4111-8111-111111111111";
    const response = await proxy(
      new NextRequest(`http://127.0.0.1:3000/order/${id}`, {
        headers: { cookie: mockCookie("maria.ruiz@email.com") },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("leaves public pages open", async () => {
    vi.stubEnv("CREDPRONTO_MOCK", "");
    vi.stubEnv("NEXT_PUBLIC_CREDPRONTO_MOCK", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    const response = await proxy(new NextRequest("http://127.0.0.1:3000/translate"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBeNull();
  });
});
