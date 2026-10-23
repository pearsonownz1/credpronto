import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/orders/errors";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children?: ReactNode; href: string }) =>
    createElement("a", { ...props, href }, children),
}));

vi.mock("@/lib/admin/preval-queue", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin/preval-queue")>("@/lib/admin/preval-queue");
  return { ...actual, listStaffPreEvaluations: vi.fn() };
});

import { listStaffPreEvaluations, PREVAL_PAGE_SIZE } from "@/lib/admin/preval-queue";
import Page, { instant, PrevalBody } from "./page";

const secret = "d".repeat(43);

describe("pre-evaluation page", () => {
  beforeEach(() => {
    vi.mocked(listStaffPreEvaluations).mockReset();
  });

  it("is a dynamic admin page and pages from the start", async () => {
    expect(instant).toBe(false);
    vi.mocked(listStaffPreEvaluations).mockResolvedValue({
      total: 1,
      rows: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          email: "ada@example.com",
          createdAt: "2026-10-23T18:00:00.000Z",
          summary: "Bachelor's degree · high",
          orderId: null,
        },
      ],
    });
    const html = renderToStaticMarkup(await PrevalBody({ searchParams: Promise.resolve({ offset: "nope" }) }));
    expect(listStaffPreEvaluations).toHaveBeenCalledWith({ limit: PREVAL_PAGE_SIZE, offset: 0 });
    expect(html).toContain("ada@example.com");
    expect(html).not.toContain(secret);
    expect(renderToStaticMarkup(Page({ searchParams: Promise.resolve({}) }))).toContain("Loading pre-evaluations");
  });

  it("passes the offset and hides a database error", async () => {
    vi.mocked(listStaffPreEvaluations).mockResolvedValueOnce({ total: 0, rows: [] });
    await PrevalBody({ searchParams: Promise.resolve({ offset: "50" }) });
    expect(listStaffPreEvaluations).toHaveBeenCalledWith({ limit: PREVAL_PAGE_SIZE, offset: 50 });

    vi.mocked(listStaffPreEvaluations).mockRejectedValueOnce(new Error(`access_token ${secret}`));
    const hidden = renderToStaticMarkup(await PrevalBody({ searchParams: Promise.resolve({}) }));
    expect(hidden).toContain("Could not load pre-evaluations.");
    expect(hidden).not.toContain(secret);

    vi.mocked(listStaffPreEvaluations).mockRejectedValueOnce(new HttpError("Sign in required", 401));
    const denied = renderToStaticMarkup(await PrevalBody({ searchParams: Promise.resolve({}) }));
    expect(denied).toContain("Sign in required");
  });
});
