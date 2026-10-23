/** @vitest-environment happy-dom */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleCustomerOrder } from "@/lib/flow/sample-order";
import type { CustomerOrder } from "@/lib/orders/view";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children?: ReactNode; href: string }) =>
    createElement("a", { ...props, href }, children),
}));

vi.mock("next/image", () => ({
  default: ({ alt }: { alt?: string }) => createElement("img", { alt: alt ?? "" }),
}));

import { PaidOrderScreen } from "./download-states";

const roots: Root[] = [];

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function deliveredOrder(patch: Partial<CustomerOrder> = {}): CustomerOrder {
  return {
    ...sampleCustomerOrder(),
    status: "delivered",
    payment: { status: "paid" },
    delivery: { status: "delivered" },
    fulfillment: "released",
    paidAt: "2026-10-21T17:00:00.000Z",
    deliveredAt: "2026-10-21T17:31:00.000Z",
    orderType: "translation",
    service: null,
    documentTitle: "Birth certificate",
    documents: [
      {
        id: "birth",
        filename: "birth-certificate.pdf",
        pageCount: 1,
        detectedLanguage: "es",
        confidence: 0.94,
        uploadPosition: 1,
        appliedPosition: 1,
      },
    ],
    ...patch,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function renderDelivered(order = deliveredOrder()) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(PaidOrderScreen, {
        order,
        token: "token-1",
        downloadHref: "/files/final.pdf",
      }),
    );
  });
  return host;
}

function byTestId<T extends Element>(host: ParentNode, testId: string, ctor: new () => T): T {
  const node = host.querySelector(`[data-testid="${testId}"]`);
  if (!(node instanceof ctor)) throw new Error(`Missing ${testId}`);
  return node;
}

async function click(node: HTMLElement) {
  await act(async () => {
    node.click();
  });
}

async function fillCorrection(host: ParentNode, value: string) {
  const field = byTestId(host, "correction-text", HTMLTextAreaElement);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("delivered order correction request", () => {
  it("renders a correction request on a delivered order", () => {
    const html = renderToStaticMarkup(
      createElement(PaidOrderScreen, {
        order: deliveredOrder(),
        token: "token-1",
        downloadHref: "/files/final.pdf",
      }),
    );
    expect(html).toContain('data-testid="request-correction"');
    expect(html).toContain("Request a correction");
    expect(html).toContain('data-testid="download-certified"');
    expect(html).toContain(">Download<");
    expect(html).toContain('data-testid="start-another-order"');
    expect(html).toContain("Start another order");
    expect(html).toContain('href="/translate"');
    expect(html).not.toContain('data-testid="correction-form"');
    expect(html).not.toContain("Correction requested");
  });

  it("shows an open correction instead of the form", () => {
    const html = renderToStaticMarkup(
      createElement(PaidOrderScreen, {
        order: deliveredOrder({ finalCorrection: { status: "in_progress" } }),
        token: "token-1",
        downloadHref: "/files/final.pdf",
      }),
    );
    expect(html).toContain("Correction requested");
    expect(html).toContain('data-status="in_progress"');
    expect(html).toContain("Status: In progress");
    expect(html).not.toContain('data-testid="request-correction"');
    expect(html).not.toContain('data-testid="correction-form"');
    expect(html).toContain(">Download<");
    expect(html).toContain("Start another order");
  });

  it("submits a correction and shows the request status", async () => {
    let resolveFetch: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchSpy = vi.fn(() => pending);
    vi.stubGlobal("fetch", fetchSpy);
    const host = await renderDelivered();
    const note = "The name on page 1 is spelled wrong.";

    await click(byTestId(host, "request-correction", HTMLButtonElement));
    expect(host.querySelector('[data-testid="correction-form"]')).toBeTruthy();
    expect(host.textContent).toContain("What's wrong?");

    await fillCorrection(host, note);
    await click(byTestId(host, "correction-submit", HTMLButtonElement));
    expect(byTestId(host, "correction-submit", HTMLButtonElement).textContent).toBe("Sending…");
    expect(byTestId(host, "correction-submit", HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      resolveFetch(
        json(
          {
            id: "corr-1",
            orderId: "order-1",
            text: note,
            status: "open",
            finalPath: null,
            finalVersion: null,
            claimedAt: null,
            fixedAt: null,
            createdAt: "2026-10-23T15:00:00.000Z",
          },
          201,
        ),
      );
      await pending;
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith("/api/orders/token-1/correction-request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: note }),
    });
    expect(host.textContent).toContain("Correction requested");
    expect(host.querySelector('[data-testid="correction-status"]')?.getAttribute("data-status")).toBe("open");
    expect(host.textContent).toContain("Status: Open");
    expect(host.querySelector('[data-testid="correction-form"]')).toBeNull();
    expect(host.textContent).toContain("Download");
    expect(host.textContent).toContain("Start another order");
  });

  it("shows an error and retries the request", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(json({ error: "A correction request already exists for this order." }, 409))
      .mockResolvedValueOnce(
        json(
          {
            id: "corr-2",
            status: "open",
            text: "The date is wrong.",
          },
          201,
        ),
      );
    vi.stubGlobal("fetch", fetchSpy);
    const host = await renderDelivered();
    const note = "The date is wrong.";

    await click(byTestId(host, "request-correction", HTMLButtonElement));
    await fillCorrection(host, note);
    await click(byTestId(host, "correction-submit", HTMLButtonElement));

    const alert = byTestId(host, "correction-error", HTMLElement);
    expect(alert.textContent).toBe("A correction request already exists for this order.");
    expect(alert.getAttribute("role")).toBe("alert");
    const retry = byTestId(host, "correction-submit", HTMLButtonElement);
    expect(retry.textContent).toBe("Try again");
    expect(retry.disabled).toBe(false);

    await click(retry);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body))).toEqual({ text: note });
    expect(host.textContent).toContain("Correction requested");
    expect(host.querySelector('[data-testid="correction-status"]')?.getAttribute("data-status")).toBe("open");
    expect(host.querySelector('[data-testid="correction-error"]')).toBeNull();
  });
});
