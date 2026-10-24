/** @vitest-environment happy-dom */
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publishGcsUnlock } from "@/lib/gcs/pin-client";

const uploadOrderFiles = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}));

vi.mock("next/dynamic", () => ({
  default: () =>
    function DynamicStub() {
      return null;
    },
}));

vi.mock("@/lib/flow/direct-upload", () => ({
  uploadOrderFiles,
}));

import { GcsTranslate } from "./gcs-translate";

const roots: Root[] = [];

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.replaceChildren();
  uploadOrderFiles.mockReset();
  vi.unstubAllGlobals();
  publishGcsUnlock(true);
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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
  it("shows a live progress bar while the translation order is polled", async () => {
    let resolveOrder: (response: Response) => void = () => undefined;
    const orderPending = new Promise<Response>((resolve) => {
      resolveOrder = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).includes("/preview")) return Promise.resolve(json({ error: "not ready" }, 404));
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
    expect(host.textContent).not.toContain("Drop a document here");
  });
});
