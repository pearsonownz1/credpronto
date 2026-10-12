import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AccountShell } from "@/components/account/account-shell";
import { mockAccountFor } from "@/lib/account/names";
import { MOCK_CUSTOMER_EMAIL, mockOrdersFor } from "@/lib/account/mock-data";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children?: ReactNode; href: string }) =>
    createElement("a", { ...props, href }, children),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: () => undefined }),
}));

import { DashboardView } from "./dashboard-view";

const NOW = Date.parse("2026-10-12T12:00:00.000Z");

function dashboardHtml() {
  return renderToStaticMarkup(
    createElement(
      AccountShell,
      {
        account: mockAccountFor(MOCK_CUSTOMER_EMAIL),
        orders: mockOrdersFor(MOCK_CUSTOMER_EMAIL, NOW),
        ordersError: null,
        now: NOW,
      },
      createElement(DashboardView),
    ),
  );
}

function row(html: string, testId: string) {
  const marker = `data-testid="${testId}"`;
  const start = html.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  const open = html.lastIndexOf("<a ", start);
  const close = html.indexOf("</a>", start);
  return html.slice(open, close + 4);
}

describe("dashboard order rows", () => {
  it("links every row to the current step without a nested control", () => {
    const html = dashboardHtml();
    const preview = row(html, "order-CP-24817");
    expect(preview).toContain('href="/preview/tok-preview-24817"');
    expect(preview).toContain("Review &amp; buy");
    expect(preview).toContain("cursor-pointer");
    expect(preview).toContain("hover:bg-[#eef3fb]");
    expect(preview).toContain("focus-visible:outline-primary");
    expect(preview).not.toContain("<button");
    expect(preview.slice(preview.indexOf(">") + 1)).not.toContain("<a ");

    expect(row(html, "order-CP-24702")).toContain('href="/confirm?token=tok-quoted-24702"');
    expect(row(html, "order-CP-24815")).toContain('href="/order/tok-progress-24815"');
    expect(row(html, "order-CP-24790")).toContain('href="/order/tok-paid-24790"');
    expect(row(html, "order-CP-24611")).toContain('href="/order/tok-ready-24611"');

    const card = row(html, "order-card-CP-24817");
    expect(card).toContain('href="/preview/tok-preview-24817"');
    expect(card).toContain("Review &amp; buy");
    expect(card).not.toContain("<button");
    expect(html.match(/data-testid="order-CP-/g)).toHaveLength(6);
    expect(html.match(/data-testid="order-card-CP-/g)).toHaveLength(6);
  });
});
