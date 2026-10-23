import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/orders/errors";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children?: ReactNode; href: string }) =>
    createElement("a", { ...props, href }, children),
}));

vi.mock("@/lib/admin/correction-queue", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin/correction-queue")>("@/lib/admin/correction-queue");
  return { ...actual, listStaffCorrections: vi.fn() };
});

import { CORRECTION_PAGE_SIZE, listStaffCorrections } from "@/lib/admin/correction-queue";
import Page, { CorrectionsBody, instant } from "./page";

describe("corrections page", () => {
  beforeEach(() => {
    vi.mocked(listStaffCorrections).mockReset();
  });

  it("is a dynamic admin page and defaults to open requests", async () => {
    expect(instant).toBe(false);
    vi.mocked(listStaffCorrections).mockResolvedValue({ rows: [], total: 0 });
    const element = await CorrectionsBody({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(element);
    expect(listStaffCorrections).toHaveBeenCalledWith("open", { limit: CORRECTION_PAGE_SIZE, offset: 0 });
    expect(html).toContain("No correction requests in this view.");
    expect(html).toContain("0–0 of 0");
    expect(renderToStaticMarkup(Page({ searchParams: Promise.resolve({}) }))).toContain("Loading corrections");
  });

  it("uses the fixed filter and hides a database error", async () => {
    vi.mocked(listStaffCorrections).mockResolvedValueOnce({ rows: [], total: 0 });
    await CorrectionsBody({ searchParams: Promise.resolve({ status: "fixed", offset: "50" }) });
    expect(listStaffCorrections).toHaveBeenCalledWith("fixed", { limit: CORRECTION_PAGE_SIZE, offset: 50 });

    vi.mocked(listStaffCorrections).mockResolvedValueOnce({ rows: [], total: 0 });
    await CorrectionsBody({ searchParams: Promise.resolve({ offset: "-1" }) });
    expect(listStaffCorrections).toHaveBeenCalledWith("open", { limit: CORRECTION_PAGE_SIZE, offset: 0 });

    vi.mocked(listStaffCorrections).mockRejectedValueOnce(new Error("relation pre_evaluations secret"));
    const hidden = renderToStaticMarkup(await CorrectionsBody({ searchParams: Promise.resolve({ status: "all" }) }));
    expect(hidden).toContain("Could not load correction requests.");
    expect(hidden).not.toContain("secret");

    vi.mocked(listStaffCorrections).mockRejectedValueOnce(new HttpError("Staff access required", 403));
    const denied = renderToStaticMarkup(await CorrectionsBody({ searchParams: Promise.resolve({}) }));
    expect(denied).toContain("Staff access required");
  });
});
