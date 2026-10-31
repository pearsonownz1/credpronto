import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { mockAccountFor } from "@/lib/account/names";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children?: ReactNode; href: string }) =>
    createElement("a", { ...props, href }, children),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/mcp",
  useRouter: () => ({ push: () => undefined }),
}));

vi.mock("@/lib/account/actions", () => ({
  signOut: vi.fn(),
}));

vi.mock("@stripe/stripe-js", () => ({ loadStripe: () => null }));
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  PaymentElement: () => null,
  useElements: () => null,
  useStripe: () => null,
}));

import { AccountShell } from "./account-shell";
import { BillingPanel } from "./billing-panel";
import { McpQuickstart } from "./mcp-quickstart";

describe("MCP quickstart", () => {
  it("shows the endpoint, tools, client tabs, and create key button", () => {
    const html = renderToStaticMarkup(createElement(McpQuickstart));
    expect(html).toContain("MCP quickstart");
    expect(html).toContain("https://credpronto.com/api/mcp");
    expect(html).toContain("Streamable HTTP");
    expect(html).toContain("Authorization: Bearer");
    expect(html).toContain("list_services");
    expect(html).toContain("create_order");
    expect(html).toContain("verify_certificate");
    expect(html).toContain("Create API key");
    expect(html).toContain("Claude");
    expect(html).toContain("Cursor");
    expect(html).toContain("OpenAI Agents SDK");
    expect(html).toContain('data-testid="mcp-config"');
    expect(html.toLowerCase()).not.toContain("sharepoint");
    expect(html).not.toContain("demo data");
  });

  it("adds MCP and Billing under Account", () => {
    const html = renderToStaticMarkup(
      createElement(
        AccountShell,
        {
          account: mockAccountFor("guy@gcs.org"),
          orders: [],
          ordersError: null,
          now: Date.parse("2026-10-31T00:00:00.000Z"),
          children: null,
        },
      ),
    );
    expect(html).toContain('data-testid="nav-mcp"');
    expect(html).toContain('href="/dashboard/mcp"');
    expect(html).toContain(">MCP<");
    expect(html).toContain('data-testid="nav-billing"');
    expect(html).toContain('href="/dashboard/billing"');
    const account = html.indexOf(">Account<");
    const integrations = html.indexOf('href="/dashboard/integrations"');
    const mcp = html.indexOf('href="/dashboard/mcp"');
    expect(mcp).toBeGreaterThan(integrations);
    expect(integrations).toBeGreaterThan(account);
  });

  it("shows the billing page for a saved card", () => {
    const html = renderToStaticMarkup(createElement(BillingPanel));
    expect(html).toContain("Billing");
    expect(html).toContain("saved card");
    expect(html).toContain("net terms");
  });
});
