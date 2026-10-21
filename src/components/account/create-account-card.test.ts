import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CreateAccountCard, passwordFromForm, passwordLine } from "./create-account-card";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams("email=ada@example.com&next=/translate"),
}));

vi.mock("@/lib/account/actions", () => ({
  mockPasswordAuth: async () => null,
  mockMagicLink: async () => null,
}));

describe("create account card", () => {
  const html = renderToStaticMarkup(createElement(CreateAccountCard));

  it("is a single card with one continue button and a text magic link", () => {
    expect(html).toContain("max-w-[440px]");
    expect(html).toContain("border-[#E5E7EB]");
    expect(html).toContain("bg-white");
    expect(html).toContain("p-8");
    expect(html).toContain("rounded-[4px]");
    expect(html).toContain("Create your account");
    expect(html).toContain("Track your order and download your files anytime.");
    expect(html).toContain("Full name");
    expect(html).toContain("Email");
    expect(html).toContain("Password");
    expect(html).toContain("8+ characters");
    expect(html).toContain("text-ink-muted");
    expect(html).not.toContain("Looks good");
    expect(html).not.toContain("Use 8 or more characters.");
    expect(html).not.toContain("Check your email to confirm your account. Then sign in.");
    expect(html).toContain('value="ada@example.com"');
    expect(html).not.toContain("readOnly");
    expect(html).toContain("Create account &amp; continue");
    expect(html).toContain("h-12");
    expect(html).toContain("#1F5EFF");
    expect(html).toContain("Email me a sign-in link instead");
    expect(html).toContain('href="/sign-in?next=%2Ftranslate"');
    expect(html).toContain("Already have an account? Sign in");
    expect(html).toContain('aria-label="Show password"');
    expect(html).not.toContain("Continue with Google");
    expect(html).not.toMatch(/>\s*Continue\s*</);
  });
});

describe("passwordLine", () => {
  it("keeps the muted hint under 8 until a short submit", () => {
    expect(passwordLine(0, false)).toBe("muted");
    expect(passwordLine(7, false)).toBe("muted");
    expect(passwordLine(7, true)).toBe("short");
    expect(passwordLine(8, true)).toBe("good");
    expect(passwordLine(10, false)).toBe("good");
  });

  it("shows the server error instead of the length hint", () => {
    const message = "Email not confirmed";
    expect(passwordLine(0, false, message)).toBe("server");
    expect(passwordLine(12, false, message)).toBe("server");
    expect(passwordLine(4, true, "password must be at least 8 characters")).toBe("server");
  });
});

describe("passwordFromForm", () => {
  it("reads the submitted password without trimming", () => {
    const data = new FormData();
    data.set("password", "1234567 ");
    const password = passwordFromForm(data);
    expect(password).toBe("1234567 ");
    expect(password.length < 8).toBe(false);
    expect(password.trim().length < 8).toBe(true);
  });
});
