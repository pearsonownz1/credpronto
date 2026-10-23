import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { signupHrefFromPrefill } from "@/lib/pre-evaluation/handoff";

const search = vi.hoisted(() => ({ current: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  useSearchParams: () => search.current,
}));

vi.mock("@/lib/account/actions", () => ({
  mockPasswordAuth: async () => null,
  mockMagicLink: async () => null,
}));

import { CreateAccountCard } from "./create-account-card";

describe("signup from a pre-evaluation", () => {
  it("prefills the email that unlocked the preview and keeps the id", () => {
    const href = signupHrefFromPrefill({
      email: "ada@example.com",
      signupPath: "/sign-up?email=ada%40example.com&next=%2Ftranslate%3Fservice%3Ddiploma%26preEvaluation%3Dprev-1",
      orderPath: "/translate?service=diploma&preEvaluation=prev-1",
    });
    search.current = new URL(href, "https://credpronto.local").searchParams;
    const html = renderToStaticMarkup(createElement(CreateAccountCard));
    expect(html).toContain('value="ada@example.com"');
    expect(html).toContain("preEvaluation=prev-1");
    expect(html).toContain("Create your account");
  });
});
