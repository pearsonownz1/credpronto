import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CorrectionQueue } from "./correction-queue";
import { PrevalList } from "./preval-list";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children?: ReactNode; href: string }) =>
    createElement("a", { ...props, href }, children),
}));

const orderId = "11111111-1111-4111-8111-111111111111";
const secret = "secret-pre-evaluation-token";

describe("correction queue", () => {
  it("links each order and marks the open filter", () => {
    const html = renderToStaticMarkup(
      createElement(CorrectionQueue, {
        filter: "open",
        rows: [
          {
            id: "corr-1",
            orderId,
            email: "ada@example.com",
            note: "The name is wrong",
            status: "open",
            requestedAt: "2026-10-23T18:00:00.000Z",
            fixedAt: null,
          },
        ],
      }),
    );
    expect(html).toContain(`href="/admin/orders/${orderId}"`);
    expect(html).toContain("ada@example.com");
    expect(html).toContain("The name is wrong");
    expect(html).toContain("Open");
    expect(html).toContain('data-testid="correction-filter-open"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/admin/corrections?status=fixed"');
    expect(html).toContain('href="/admin/corrections?status=all"');
    expect(html).toContain("—");
  });
});

describe("pre-evaluation list", () => {
  it("shows a paid order link and pages forward", () => {
    const html = renderToStaticMarkup(
      createElement(PrevalList, {
        rows: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            email: "ada@example.com",
            createdAt: "2026-10-23T18:00:00.000Z",
            summary: "Bachelor's degree · high",
            orderId,
          },
          {
            id: "55555555-5555-4555-8555-555555555555",
            email: null,
            createdAt: "2026-10-22T18:00:00.000Z",
            summary: "Processing",
            orderId: null,
          },
        ],
        page: { limit: 50, offset: 0, total: 60 },
      }),
    );
    expect(html).toContain("Bachelor&#x27;s degree · high");
    expect(html).toContain(`href="/admin/orders/${orderId}"`);
    expect(html).toContain("Not paid");
    expect(html).toContain("1–2 of 60");
    expect(html).toContain('href="/admin/preval?offset=50"');
    expect(html).not.toContain(secret);
    expect(html).not.toContain('data-testid="preval-previous"');
  });
});
