import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { mockAccountFor } from "@/lib/account/names";
import { MOCK_CUSTOMER_EMAIL, mockOrdersFor } from "@/lib/account/mock-data";

const NOW = Date.parse("2026-10-12T12:00:00.000Z");

const shell = vi.hoisted(() => ({
  orders: undefined as unknown,
  query: "",
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children?: ReactNode; href: string }) =>
    createElement("a", { ...props, href }, children),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: () => undefined }),
}));

vi.mock("@/components/account/account-shell", () => ({
  useAccountShell: () => ({
    account: mockAccountFor(MOCK_CUSTOMER_EMAIL),
    orders: (shell.orders as ReturnType<typeof mockOrdersFor> | undefined) ?? mockOrdersFor(MOCK_CUSTOMER_EMAIL, NOW),
    ordersError: null,
    now: NOW,
    query: shell.query,
    setQuery: () => undefined,
  }),
}));

import { DashboardView } from "./dashboard-view";

function dashboardHtml() {
  return renderToStaticMarkup(createElement(DashboardView));
}

function row(html: string, testId: string) {
  const marker = `data-testid="${testId}"`;
  const start = html.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  const open = html.lastIndexOf("<div", start);
  const close = html.indexOf("</div>", start);
  return html.slice(open, close + 6);
}

function anchors(fragment: string) {
  return [...fragment.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map((match) => match[0]);
}

function tabCount(html: string, label: string): string | undefined {
  return html.match(new RegExp(`>${label}<span[^>]*>(\\d+)</span>`))?.[1];
}

describe("dashboard order rows", () => {
  it("links every row to the current step without a nested control", () => {
    const html = dashboardHtml();
    expect(html).toContain("<a ");
    expect(html).toContain('href="/preview/tok-preview-24817"');
    const preview = row(html, "order-CP-24817");
    expect(preview).toContain('href="/preview/tok-preview-24817"');
    expect(preview).toContain("after:absolute");
    expect(preview).toContain("after:inset-0");
    expect(preview).toMatch(/<a [^>]*whitespace-nowrap[^>]*href="\/preview\/tok-preview-24817"[^>]*>Buy now<\/a>/);
    expect(preview).toContain("cursor-pointer");
    expect(preview).toContain("hover:bg-[#eef3fb]");
    expect(preview).toContain("focus-within:outline-primary");
    expect(preview).not.toContain("<button");
    expect(preview).not.toContain("<span data-emphasis");
    for (const anchor of anchors(preview)) {
      expect(anchor.slice(anchor.indexOf(">") + 1, -4)).not.toContain("<a");
    }

    const confirm = row(html, "order-CP-24702");
    expect(confirm).toContain('href="/confirm?token=tok-quoted-24702"');
    expect(confirm).toMatch(/<a [^>]*whitespace-nowrap[^>]*href="\/confirm\?token=tok-quoted-24702"[^>]*>Confirm details<\/a>/);
    expect(row(html, "order-CP-24815")).toContain('href="/order/tok-progress-24815"');
    expect(row(html, "order-CP-24790")).toContain('href="/order/tok-paid-24790"');
    const ready = row(html, "order-CP-24611");
    expect(ready).toContain('href="/order/tok-ready-24611"');
    expect(ready).toMatch(/<a [^>]*whitespace-nowrap[^>]*href="\/order\/tok-ready-24611"[^>]*>Download<\/a>/);
    expect(row(html, "order-CP-24790")).toContain("whitespace-nowrap");
    const paid = row(html, "order-CP-24790");
    expect(paid).toContain(">CP-24790</a>");
    expect(paid).toContain("$9.95");
    expect(row(html, "order-card-CP-24790")).toContain("$9.95");

    const card = row(html, "order-card-CP-24817");
    expect(card).toContain('href="/preview/tok-preview-24817"');
    expect(card).toMatch(/<a [^>]*whitespace-nowrap[^>]*href="\/preview\/tok-preview-24817"[^>]*>Buy now<\/a>/);
    expect(card).not.toContain("<button");
    expect(html.match(/data-testid="order-CP-/g)).toHaveLength(6);
    expect(html.match(/data-testid="order-card-CP-/g)).toHaveLength(6);
    expect(row(html, "order-CP-24817")).toContain("Spanish → English");
    expect(row(html, "order-card-CP-24817")).toContain("Spanish → English");
  });

  it("shows a document language pair and a dash when the order has no language", () => {
    const [sample] = mockOrdersFor(MOCK_CUSTOMER_EMAIL, NOW);
    shell.orders = [
      {
        ...sample,
        id: "order-es",
        sourceLanguage: null,
        targetLanguage: null,
        documents: [{ detectedLanguage: "es", targetLanguage: "en" }],
      },
      {
        ...sample,
        id: "order-none",
        sourceLanguage: null,
        targetLanguage: "en",
        documents: null,
        billablePages: 1,
        totalCents: 995,
      },
    ];
    try {
      const html = dashboardHtml();
      expect(row(html, "order-order-es")).toContain("Spanish → English");
      expect(row(html, "order-card-order-es")).toContain("Spanish → English");
      const empty = row(html, "order-order-none");
      expect(empty).toContain(">—</span>");
      expect(empty).not.toContain("Spanish");
      expect(empty).not.toContain("English");
    } finally {
      shell.orders = undefined;
    }
  });

  it("renders real anchors for a production order that has an id and no raw token", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const [sample] = mockOrdersFor(MOCK_CUSTOMER_EMAIL, NOW);
    shell.orders = [{ ...sample, id, orderToken: null, status: "preview_ready", totalCents: 995 }];
    try {
      const html = dashboardHtml();
      const desktop = row(html, `order-${id}`);
      expect(desktop).toContain(`href="/preview/${id}"`);
      expect(desktop).toContain(">11111111</a>");
      expect(desktop).toContain("$9.95");
      expect(desktop).not.toContain(`>${id}<`);
      expect(desktop).toMatch(new RegExp(`<a [^>]*whitespace-nowrap[^>]*href="/preview/${id}"[^>]*>Buy now</a>`));
      expect(anchors(desktop).every((anchor) => anchor.includes(`href="/preview/${id}"`))).toBe(true);
      const card = row(html, `order-card-${id}`);
      expect(card).toContain(">11111111</a>");
      expect(card).toContain("$9.95");
      expect(card).not.toContain(`>${id}<`);
      expect(html).toContain(`<a`);
      expect(html.match(new RegExp(`href="/preview/${id}"`, "g"))?.length).toBe(5);
    } finally {
      shell.orders = undefined;
    }
  });

  it("counts Translating with the same search filter as the rows", () => {
    const orders = mockOrdersFor(MOCK_CUSTOMER_EMAIL, NOW);
    const passport = {
      ...orders[1],
      id: "CP-24816",
      documentsLabel: "Passport",
      orderToken: "tok-passport",
    };
    shell.orders = [...orders, passport];
    shell.query = "passport";
    try {
      const html = dashboardHtml();
      expect(tabCount(html, "Translating")).toBe("1");
      expect(html).toContain('data-testid="order-CP-24816"');
      expect(html).not.toContain('data-testid="order-CP-24815"');
    } finally {
      shell.orders = undefined;
      shell.query = "";
    }
  });
});
