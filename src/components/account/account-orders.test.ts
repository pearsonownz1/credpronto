import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CustomerOrder } from "@/lib/api/types";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children?: ReactNode; href: string }) =>
    createElement("a", { ...props, href }, children),
}));

vi.mock("next/image", () => ({
  default: (props: { alt?: string }) => createElement("img", { alt: props.alt ?? "" }),
}));

vi.mock("@/lib/account/actions", () => ({
  signOut: () => undefined,
}));

import { AccountOrders } from "./account-orders";

function order(patch: Partial<CustomerOrder> = {}): CustomerOrder {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    status: "paid",
    serviceType: "translation",
    totalCents: 995,
    currency: "usd",
    billablePages: 1,
    unitPriceCents: 995,
    createdAt: "2026-10-11T12:00:00.000Z",
    previewAvailable: false,
    paymentStatus: "paid",
    downloadAvailable: false,
    documentName: "acta.pdf",
    ...patch,
  };
}

describe("account orders list", () => {
  it("shows the short order id and the price paid", () => {
    const html = renderToStaticMarkup(createElement(AccountOrders, { orders: [order()] }));
    const id = "11111111-1111-4111-8111-111111111111";
    expect(html).toContain("Your orders");
    expect(html).toContain(`data-testid="account-order-${id}"`);
    expect(html).toContain('data-testid="account-number-11111111-1111-4111-8111-111111111111"');
    expect(html).toContain(">11111111</span>");
    expect(html).not.toContain(`>${id}<`);
    expect(html).toContain('data-testid="account-price-11111111-1111-4111-8111-111111111111"');
    expect(html).toContain(">$9.95</span>");
    expect(html).toContain("acta.pdf");
  });
});
