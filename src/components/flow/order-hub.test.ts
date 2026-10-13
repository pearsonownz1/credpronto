import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { sampleCustomerOrder } from "@/lib/flow/sample-order";

vi.mock("next/navigation", () => ({
  useParams: () => ({ token: "tok" }),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children?: ReactNode; href: string }) =>
    createElement("a", { ...props, href }, children),
}));

vi.mock("./use-order", () => ({
  useStoredToken: (token?: string | null) => token || "tok",
  useStoredEmail: () => "ada@example.com",
  useCustomerOrder: () => ({
    order: sampleCustomerOrder(),
    error: null,
    loading: false,
    reload: () => undefined,
  }),
}));

import { OrderHub } from "./order-hub";

describe("quote page announcement", () => {
  it("does not include the Stripe return banner on a quote", () => {
    const html = renderToStaticMarkup(createElement(OrderHub));
    expect(html).toContain('data-testid="order-announcement"');
    expect(html).toContain("Quote ready: 2 pages, $19.90");
    expect(html).not.toContain("Confirming payment");
    expect(html).not.toContain("Stripe sent you back");
  });
});
