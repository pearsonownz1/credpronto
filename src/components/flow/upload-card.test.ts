import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
    },
  }),
}));

import { UploadCard } from "./upload-card";

function html(sessionEmail?: string | null) {
  return renderToStaticMarkup(createElement(UploadCard, { sessionEmail }));
}

describe("quote email field", () => {
  it("asks an anonymous visitor for an email", () => {
    const markup = html(null);
    expect(markup).toContain("Email for your preview link");
    expect(markup).toContain('data-testid="email"');
    expect(markup).not.toContain("Preview link goes to");
  });

  it("hides the email field when a session email is already known", () => {
    const markup = html("ada@example.com");
    expect(markup).toContain("Preview link goes to ada@example.com");
    expect(markup).not.toContain("Email for your preview link");
    expect(markup).not.toContain('data-testid="email"');
  });
});
