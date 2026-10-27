/** @vitest-environment happy-dom */
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publishGcsUnlock } from "@/lib/gcs/pin-client";

const uploadOrderFiles = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: () => undefined }),
}));

vi.mock("next/dynamic", () => ({
  default: () =>
    function DynamicStub(props: { onEvaluate?: () => Promise<void> | void }) {
      return createElement(
        "button",
        {
          type: "button",
          "data-testid": "gcs-evaluate-stub",
          onClick: () => {
            void props.onEvaluate?.();
          },
        },
        "Evaluate",
      );
    },
}));

vi.mock("@/lib/flow/direct-upload", () => ({
  uploadOrderFiles,
}));

import { GcsTranslate } from "./gcs-translate";
import type { GcsHistoryItem } from "@/lib/gcs/history";

const roots: Root[] = [];

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.replaceChildren();
  uploadOrderFiles.mockReset();
  push.mockReset();
  vi.unstubAllGlobals();
  publishGcsUnlock(true);
});

function historyItem(patch: Partial<GcsHistoryItem> = {}): GcsHistoryItem {
  return {
    id: "28492f38-1111-4111-8111-111111111111",
    status: "preview_ready",
    title: "Ana Ruiz",
    filenames: ["diploma.pdf", "transcript.pdf"],
    documentCount: 2,
    pageCount: 2,
    sourceLanguage: "es",
    targetLanguage: "en",
    hasEvaluation: true,
    evaluationKind: "diploma",
    createdAt: "2026-10-24T15:04:00.000Z",
    ...patch,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The history list is exactly `/api/gcs/orders`. Editor pages use `/api/gcs/orders/:id`. */
function gcsOrdersKind(url: string): "list" | "detail" | null {
  const path = String(url).split("?")[0] ?? "";
  if (path.endsWith("/api/gcs/orders")) return "list";
  if (path.includes("/api/gcs/orders/")) return "detail";
  return null;
}

async function renderTranslate(props: { unlocked?: boolean; token?: string } = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(createElement(GcsTranslate, { unlocked: props.unlocked ?? true, token: props.token }));
  });
  return host;
}

describe("GcsTranslate progress", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (gcsOrdersKind(String(url)) === "detail") return json({ pages: [] });
        if (gcsOrdersKind(String(url)) === "list") return json({ orders: [] });
        return json({ error: "not found" }, 404);
      }),
    );
  });

  it("shows a live progress bar while the translation order is polled", async () => {
    let resolveOrder: (response: Response) => void = () => undefined;
    const orderPending = new Promise<Response>((resolve) => {
      resolveOrder = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const href = String(url);
        if (gcsOrdersKind(href) === "detail") return Promise.resolve(json({ pages: [] }));
        if (gcsOrdersKind(href) === "list") return Promise.resolve(json({ orders: [] }));
        if (href.includes("/preview")) return Promise.resolve(json({ error: "not ready" }, 404));
        return orderPending;
      }),
    );

    const host = await renderTranslate({ token: "tok-1" });
    const early = host.querySelector('[data-testid="gcs-progress-bar"]');
    expect(early?.getAttribute("role")).toBe("progressbar");
    expect(early?.getAttribute("aria-valuenow")).toBe("5");
    expect(host.querySelector('[data-testid="gcs-progress-stage"]')?.textContent).toContain("Reading the document");
    expect(host.textContent).toContain("Translating your document");
    expect(host.textContent).not.toContain("SOURCE PAGES");

    await act(async () => {
      resolveOrder(
        json({
          status: "processing",
          sourceLanguage: "es",
          targetLanguage: "en",
          progressPct: 92,
          progressStage: "Translating and laying out",
          progress: {
            step: "translating",
            pagesRead: 12,
            pagesTotal: 12,
            pagesDone: 4,
            pagesTranslateTotal: 9,
          },
        }),
      );
      await orderPending;
    });

    const bar = host.querySelector('[data-testid="gcs-progress-bar"]');
    expect(bar?.getAttribute("role")).toBe("progressbar");
    expect(bar?.getAttribute("aria-valuemin")).toBe("0");
    expect(bar?.getAttribute("aria-valuemax")).toBe("100");
    expect(bar?.getAttribute("aria-valuenow")).toBe("95");
    expect(host.querySelector('[data-testid="gcs-progress-percent"]')?.textContent).toBe("95%");
    expect(host.querySelector('[data-testid="gcs-progress-stage"]')?.textContent).toBe("Translating and laying out");
    expect(bar?.querySelector(".bg-primary")).toBeTruthy();
    expect(bar?.className).toContain("bg-line");
    expect(host.querySelector('[data-testid="gcs-progress-step-translating"]')?.getAttribute("data-state")).toBe(
      "current",
    );
    expect(host.textContent).toContain("The certified translation is being prepared.");
  });

  it("shows the progress bar while the file is uploading", async () => {
    let report: ((ratio: number) => void) | null = null;
    uploadOrderFiles.mockImplementation(
      (input: { onProgress?: (ratio: number) => void }) =>
        new Promise(() => {
          report = input.onProgress ?? null;
        }),
    );
    const host = await renderTranslate();
    const input = host.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("missing file input");
    const file = new File(["birth"], "birth.pdf", { type: "application/pdf" });

    await act(async () => {
      Object.defineProperty(input, "files", { configurable: true, value: [file] });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      report?.(0.4);
    });

    expect(uploadOrderFiles).toHaveBeenCalledOnce();
    const bar = host.querySelector('[data-testid="gcs-progress-bar"]');
    expect(bar?.getAttribute("role")).toBe("progressbar");
    expect(host.querySelector('[data-testid="gcs-progress-stage"]')?.textContent).toBe("Uploading");
    expect(host.querySelector('[data-testid="gcs-progress-percent"]')?.textContent).toBe("2%");
    expect(host.textContent).toContain("Uploading your document");
    expect(host.querySelector("h1")?.textContent).toBe("Uploading your document");
    expect(host.textContent).not.toContain("Drop a document here");
  });
});

describe("GcsTranslate documents", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (gcsOrdersKind(String(url)) === "detail") return json({ pages: [] });
        if (gcsOrdersKind(String(url)) === "list") return json({ orders: [] });
        return json({ error: "not found" }, 404);
      }),
    );
  });

  it("shows that one or more documents can be uploaded", async () => {
    const host = await renderTranslate();
    const input = host.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("missing file input");
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe("application/pdf,image/*");
    expect(host.querySelector("h1")?.textContent).toBe("Upload documents");
    expect(host.textContent).toContain("up to 10 files");
    expect(host.textContent).toContain("no payment step");
    expect(host.textContent).toContain("Drop documents here");
    expect(host.textContent).toContain("or click to choose one or more PDFs or images");
    expect(host.querySelector('[data-testid="gcs-history-sidebar"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="gcs-new-translation"]')?.textContent).toContain("New Translation");
  });

  it("passes every selected file to the upload", async () => {
    let report: ((ratio: number) => void) | null = null;
    uploadOrderFiles.mockImplementation(
      (input: { onProgress?: (ratio: number) => void }) =>
        new Promise(() => {
          report = input.onProgress ?? null;
        }),
    );
    const host = await renderTranslate();
    const input = host.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("missing file input");
    const first = new File(["diploma"], "diploma.pdf", { type: "application/pdf" });
    const second = new File(["scan"], "scan.png", { type: "image/png" });

    await act(async () => {
      Object.defineProperty(input, "files", { configurable: true, value: [first, second] });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      report?.(0.4);
    });

    expect(uploadOrderFiles).toHaveBeenCalledWith({
      files: [first, second],
      choice: { orderType: "translation" },
      brand: "gcs",
      clientName: "",
      sourceLanguage: "auto",
      targetLanguage: "en",
      onProgress: expect.any(Function),
    });
    expect(host.querySelector("h1")?.textContent).toBe("Uploading your documents");
  });

  it("stops at 10 files and clears that error from New Translation", async () => {
    const host = await renderTranslate();
    const input = host.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("missing file input");
    const files = Array.from({ length: 11 }, (_, index) => new File(["x"], `page-${index}.pdf`, { type: "application/pdf" }));

    await act(async () => {
      Object.defineProperty(input, "files", { configurable: true, value: files });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(uploadOrderFiles).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Upload at most 10 documents.");
    const reset = host.querySelector('[data-testid="gcs-new-translation"]');
    if (!(reset instanceof HTMLButtonElement)) throw new Error("missing new translation");
    await act(async () => {
      reset.click();
    });
    expect(host.textContent).not.toContain("Upload at most 10 documents.");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("GcsTranslate history sidebar", () => {
  const current = historyItem();
  const running = historyItem({
    id: "395a3f49-2222-4222-8222-222222222222",
    status: "processing",
    title: "scan.png",
    filenames: ["scan.png"],
    documentCount: 1,
    pageCount: 1,
    hasEvaluation: false,
    evaluationKind: null,
    createdAt: "2026-10-23T12:00:00.000Z",
  });

  it("lists previous translations, highlights the open order, and opens another", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const href = String(url);
        if (gcsOrdersKind(href) === "detail") return Promise.resolve(json({ pages: [] }));
        if (gcsOrdersKind(href) === "list") return Promise.resolve(json({ orders: [current, running] }));
        if (href.includes("/preview")) return Promise.resolve(json({ error: "not ready" }, 404));
        return Promise.resolve(json({ status: "processing", orderId: current.id }));
      }),
    );

    const host = await renderTranslate({ token: current.id });
    await act(async () => {
      await vi.waitFor(() => {
        expect(host.querySelectorAll('[data-testid="gcs-history-item"]')).toHaveLength(2);
      });
    });

    expect(host.querySelector('[data-testid="gcs-history-sidebar"]')).toBeTruthy();
    expect(host.textContent).toContain("Previous translations");
    const items = [...host.querySelectorAll('[data-testid="gcs-history-item"]')];
    expect(items[0]?.getAttribute("aria-current")).toBe("page");
    expect(items[0]?.textContent).toContain("Ana Ruiz");
    expect(items[0]?.textContent).toContain("diploma.pdf + 1 more");
    expect(items[0]?.textContent).toContain("Translated");
    expect(items[0]?.textContent).toContain("Diploma");
    expect(items[0]?.textContent).toContain("Oct 24 · 2 pages");
    expect(items[1]?.getAttribute("aria-current")).toBeNull();
    expect(items[1]?.textContent).toContain("Translating…");
    expect(items[1]?.textContent).toContain("Oct 23 · 1 page");
    expect(items[1]?.textContent).not.toContain("Diploma");

    const second = items[1];
    if (!(second instanceof HTMLButtonElement)) throw new Error("missing history item");
    await act(async () => {
      second.click();
    });
    expect(push).toHaveBeenCalledWith(`/gcs-translate/${encodeURIComponent(running.id)}`);

    const fresh = host.querySelector('[data-testid="gcs-new-translation"]');
    if (!(fresh instanceof HTMLButtonElement)) throw new Error("missing new translation");
    await act(async () => {
      fresh.click();
    });
    expect(push).toHaveBeenCalledWith("/gcs-translate");
  });

  it("refreshes the sidebar when the preview and the evaluation finish", async () => {
    let historyCalls = 0;
    const previewBody = {
      original: { url: "https://files.example/original.pdf", pageCount: 2, pages: [] },
      translation: { url: "https://files.example/translation.pdf", pageCount: 2, pages: [] },
      billablePages: 2,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        const href = String(url);
        if (gcsOrdersKind(href) === "detail") return Promise.resolve(json({ pages: [] }));
        if (gcsOrdersKind(href) === "list") {
          historyCalls += 1;
          const orders =
            historyCalls >= 3
              ? [{ ...current, title: "Evaluated Ana", hasEvaluation: true, evaluationKind: "diploma" as const }]
              : historyCalls >= 2
                ? [{ ...current, hasEvaluation: true, evaluationKind: "diploma" as const }]
                : [{ ...current, hasEvaluation: false, evaluationKind: null }];
          return Promise.resolve(json({ orders }));
        }
        if (href.includes("/evaluate") && init?.method === "POST") {
          return Promise.resolve(
            json({
              evaluation: {
                url: "https://files.example/eval.pdf",
                pageCount: 1,
                pages: [{ number: 1, widthPt: 612, heightPt: 792 }],
                kind: "diploma",
              },
            }),
          );
        }
        if (href.includes("/preview")) return Promise.resolve(json(previewBody));
        return Promise.resolve(json({ status: "preview_ready", orderId: current.id, sourceLanguage: "es", targetLanguage: "en" }));
      }),
    );

    const host = await renderTranslate({ token: current.id });
    await act(async () => {
      await vi.waitFor(() => {
        expect(host.textContent).toContain("Diploma");
      });
    });
    expect(historyCalls).toBeGreaterThanOrEqual(2);

    const evaluate = host.querySelector('[data-testid="gcs-evaluate-stub"]');
    if (!(evaluate instanceof HTMLButtonElement)) throw new Error("missing evaluate");
    await act(async () => {
      evaluate.click();
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(host.textContent).toContain("Evaluated Ana");
      });
    });
    expect(historyCalls).toBeGreaterThanOrEqual(3);
  });
});
