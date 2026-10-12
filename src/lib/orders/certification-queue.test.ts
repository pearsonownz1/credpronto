import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CertificationQueue } from "@/components/admin/certification-queue";
import { parseAdminOrder } from "@/lib/api/parse";
import type { AdminOrder } from "@/lib/api/types";
import {
  certificationQueue,
  onCertificationQueue,
  waitingIsLate,
  waitingLabel,
  waitingMinutes,
} from "./certification-queue";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children?: ReactNode; href: string }) =>
    createElement("a", { ...props, href }, children),
}));

const NOW = Date.parse("2026-10-12T12:30:00.000Z");

function order(patch: Partial<AdminOrder> & Pick<AdminOrder, "id" | "status" | "createdAt">): AdminOrder {
  return {
    serviceType: "translation",
    sourceLanguage: "es",
    billablePages: 1,
    totalCents: 995,
    currency: "usd",
    reviewReason: null,
    email: "ada@example.com",
    expedited: false,
    paidAt: null,
    fulfillment: null,
    ...patch,
  };
}

describe("certification queue", () => {
  it("keeps paid orders that are not approved and drops released ones", () => {
    expect(onCertificationQueue(order({ id: "paid", status: "paid", createdAt: NOW_ISO, fulfillment: null }))).toBe(true);
    expect(
      onCertificationQueue(
        order({
          id: "held",
          status: "needs_review",
          createdAt: NOW_ISO,
          paidAt: "2026-10-12T12:00:00.000Z",
          fulfillment: null,
        }),
      ),
    ).toBe(true);
    expect(
      onCertificationQueue(
        order({
          id: "fix",
          status: "correction_requested",
          createdAt: NOW_ISO,
          paidAt: "2026-10-12T12:00:00.000Z",
        }),
      ),
    ).toBe(true);
    expect(
      onCertificationQueue(order({ id: "unpaid", status: "needs_review", createdAt: NOW_ISO, paidAt: null })),
    ).toBe(false);
    expect(
      onCertificationQueue(
        order({ id: "done", status: "paid", createdAt: NOW_ISO, fulfillment: "released", paidAt: "2026-10-12T12:00:00.000Z" }),
      ),
    ).toBe(false);
    expect(
      onCertificationQueue(
        order({ id: "approved", status: "approved", createdAt: NOW_ISO, paidAt: "2026-10-12T12:00:00.000Z" }),
      ),
    ).toBe(false);
  });

  it("sorts oldest paid_at first and falls back to created_at when paid_at is missing", () => {
    const sorted = certificationQueue([
      order({
        id: "new-paid",
        status: "paid",
        createdAt: "2026-10-01T00:00:00.000Z",
        paidAt: "2026-10-12T12:20:00.000Z",
        fulfillment: "awaiting_review",
        expedited: true,
      }),
      order({
        id: "old-paid",
        status: "paid",
        createdAt: "2026-10-12T00:00:00.000Z",
        paidAt: "2026-10-12T11:00:00.000Z",
        fulfillment: "awaiting_review",
      }),
      order({
        id: "no-stamp-new",
        status: "paid",
        createdAt: "2026-10-12T10:00:00.000Z",
        paidAt: null,
        fulfillment: "awaiting_review",
      }),
      order({
        id: "no-stamp-old",
        status: "paid",
        createdAt: "2026-10-11T10:00:00.000Z",
        paidAt: "not-a-date",
        fulfillment: "awaiting_review",
        expedited: true,
      }),
      order({ id: "preview", status: "preview_ready", createdAt: "2026-10-01T00:00:00.000Z" }),
      order({
        id: "old-paid",
        status: "paid",
        createdAt: "2026-10-12T00:00:00.000Z",
        paidAt: "2026-10-12T11:00:00.000Z",
        fulfillment: "awaiting_review",
      }),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["old-paid", "new-paid", "no-stamp-old", "no-stamp-new"]);
  });

  it("reads paid_at when the admin payload has not switched to paidAt", () => {
    const parsed = parseAdminOrder({
      id: "CP-1",
      status: "needs_review",
      createdAt: "2026-10-12T10:00:00.000Z",
      paid_at: "2026-10-12T11:00:00.000Z",
    });
    expect(parsed?.paidAt).toBe("2026-10-12T11:00:00.000Z");
    expect(parsed?.fulfillment).toBe("awaiting_review");
    expect(certificationQueue(parsed ? [parsed] : []).map((item) => item.id)).toEqual(["CP-1"]);
  });

  it("labels the wait and turns red at 2 minutes", () => {
    expect(waitingMinutes({ paidAt: "2026-10-12T12:29:00.000Z", createdAt: "2026-10-01T00:00:00.000Z" }, NOW)).toBe(1);
    expect(waitingMinutes({ paidAt: null, createdAt: "2026-10-12T12:10:00.000Z" }, NOW)).toBe(20);
    expect(waitingMinutes({ paidAt: "nope", createdAt: "also-nope" }, NOW)).toBeNull();
    expect(waitingMinutes({ paidAt: "2026-10-12T12:40:00.000Z", createdAt: "2026-10-12T12:00:00.000Z" }, NOW)).toBe(0);
    expect(waitingLabel(1)).toBe("Waiting 1 min");
    expect(waitingLabel(2)).toBe("Waiting 2 min");
    expect(waitingIsLate(1)).toBe(false);
    expect(waitingIsLate(2)).toBe(true);
  });

  it("renders a live waiting badge that is red after 2 minutes", () => {
    const html = renderToStaticMarkup(
      createElement(CertificationQueue, {
        now: NOW,
        orders: [
          order({
            id: "CP-OLD",
            status: "paid",
            createdAt: "2026-10-12T11:00:00.000Z",
            paidAt: "2026-10-12T12:27:00.000Z",
            fulfillment: "awaiting_review",
            email: "old@example.com",
          }),
          order({
            id: "CP-NEW",
            status: "paid",
            createdAt: "2026-10-12T12:00:00.000Z",
            paidAt: "2026-10-12T12:29:00.000Z",
            fulfillment: "awaiting_review",
            email: "new@example.com",
          }),
        ],
      }),
    );
    const oldAt = html.indexOf("CP-OLD");
    const newAt = html.indexOf("CP-NEW");
    expect(oldAt).toBeGreaterThan(-1);
    expect(newAt).toBeGreaterThan(oldAt);
    expect(html).toContain("Waiting 3 min");
    expect(html).toContain("Waiting 1 min");
    expect(html).toContain('data-testid="waiting-badge"');
    expect(html).toContain('data-late="true"');
    expect(html).toContain('data-late="false"');
    expect(html).toContain("bg-[#fdecec]");
    expect(html).toContain("bg-[#fff4e5]");
  });
});

const NOW_ISO = "2026-10-12T12:00:00.000Z";
