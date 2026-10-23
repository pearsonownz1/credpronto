/** @vitest-environment happy-dom */
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockStaffDetail } from "@/lib/account/mock-data";
import type { StaffDetail, StaffPage } from "@/lib/api/types";
import { translationLines } from "./translation-lines";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children?: ReactNode; href: string }) =>
    createElement("a", { ...props, href }, children),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/orders/CP-24790",
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

vi.mock("next/dynamic", () => ({
  default: () =>
    function PreviewStub() {
      return null;
    },
}));

vi.mock("@/lib/api/mutations", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/mutations")>("@/lib/api/mutations");
  return {
    ...actual,
    patchOrderTranslation: vi.fn(async () => ({ ok: true, status: 200, data: {} })),
  };
});

import { patchOrderTranslation } from "@/lib/api/mutations";
import { OrderStudio } from "./order-studio";
import { TranslationView } from "./translation-view";

const roots: Root[] = [];

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.mocked(patchOrderTranslation).mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ error: "missing" }), { status: 404 })),
  );
});

function page(patch: Partial<StaffPage> & Pick<StaffPage, "id" | "sourceText" | "paragraphs">): StaffPage {
  return {
    documentId: "doc-1",
    pageNumber: 1,
    ...patch,
  };
}

describe("translation line alignment", () => {
  it("pairs each source line with the segment at the same index", () => {
    expect(translationLines("Alpha\nBeta\nGamma", ["One", "Two", "Three"])).toEqual([
      { source: "Alpha", translation: "One", segmentIndex: 0 },
      { source: "Beta", translation: "Two", segmentIndex: 1 },
      { source: "Gamma", translation: "Three", segmentIndex: 2 },
    ]);
  });

  it("keeps a blank source line blank on both sides and does not shift later segments", () => {
    expect(translationLines("Alpha\n\nGamma", ["One", "Hidden", "Three", "Extra"])).toEqual([
      { source: "Alpha", translation: "One", segmentIndex: 0 },
      { source: "", translation: "", segmentIndex: null },
      { source: "Gamma", translation: "Three", segmentIndex: 2 },
    ]);
  });

  it("leaves a blank translation cell when a segment is missing", () => {
    expect(translationLines("Alpha\nBeta\nGamma", ["Only"])).toEqual([
      { source: "Alpha", translation: "Only", segmentIndex: 0 },
      { source: "Beta", translation: "", segmentIndex: 1 },
      { source: "Gamma", translation: "", segmentIndex: 2 },
    ]);
  });

  it("drops a trailing newline without dropping a real blank line", () => {
    expect(translationLines("Alpha\n", ["One"])).toEqual([{ source: "Alpha", translation: "One", segmentIndex: 0 }]);
    expect(translationLines("Alpha\n\n", ["One", "Hidden"])).toEqual([
      { source: "Alpha", translation: "One", segmentIndex: 0 },
      { source: "", translation: "", segmentIndex: null },
    ]);
  });
});

describe("translation view", () => {
  const aligned = page({
    id: "p1",
    sourceText: "Alpha\n\nGamma",
    paragraphs: ["One", "Hidden", "Three", "Extra"],
  });

  function markup(canEdit = true) {
    return renderToStaticMarkup(
      createElement(TranslationView, {
        pages: [aligned],
        drafts: { p1: aligned.paragraphs },
        canEdit,
        onCommit: () => undefined,
      }),
    );
  }

  it("renders source and translation in one shared row without segment boxes", () => {
    const html = markup();
    expect(html).toContain("grid-cols-2");
    expect(html).toContain("Alpha");
    expect(html).toContain("Gamma");
    expect(html).toContain("One");
    expect(html).toContain("Three");
    expect(html).not.toContain("Hidden");
    expect(html).not.toContain("Extra");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("Add segment");
    expect(html).toContain("hover:bg-[var(--cp-blue-l)]");
    expect(html).toContain("focus:bg-[var(--cp-blue-l)]");
    expect(html).toContain("focus-visible:bg-[var(--cp-blue-l)]");
    expect(html).toContain('data-blank="true"');
    expect(html).toContain("text-[15px]");
    expect(html).toContain("border-line");
    const blank = html.slice(html.indexOf('data-blank="true"'), html.indexOf('data-testid="translation-row-p1-2"'));
    expect(blank).not.toContain("Hidden");
    expect(blank).not.toContain("<input");
  });

  it("opens one blue-outlined input for the clicked line and saves on blur or Enter", async () => {
    const onCommit = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        createElement(TranslationView, {
          pages: [aligned],
          drafts: { p1: aligned.paragraphs },
          canEdit: true,
          onCommit,
        }),
      );
    });

    const editor = host;
    const first = editor.querySelector('[data-testid="translation-row-p1-0"]');
    const third = editor.querySelector('[data-testid="translation-row-p1-2"]');
    if (!(first instanceof HTMLElement) || !(third instanceof HTMLElement)) throw new Error("missing rows");
    expect(first.className).toContain("hover:bg-[var(--cp-blue-l)]");
    expect(first.className).toContain("focus:bg-[var(--cp-blue-l)]");

    first.focus();
    expect(document.activeElement).toBe(first);
    await act(async () => {
      first.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    let input = editor.querySelector("input");
    if (!(input instanceof HTMLInputElement)) throw new Error("missing input");
    expect(editor.querySelectorAll("input")).toHaveLength(1);
    expect(editor.querySelector("textarea")).toBeNull();
    expect(input.className).toContain("border-primary");
    expect(input.value).toBe("One");
    expect(third.querySelector("input")).toBeNull();

    await act(async () => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(editor.querySelector("input")).toBeNull();
    expect(editor.textContent).toContain("One");

    await act(async () => {
      first.click();
    });
    input = editor.querySelector("input");
    if (!(input instanceof HTMLInputElement)) throw new Error("missing input");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "Uno");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("p1", 0, "Uno");
    expect(editor.querySelector("input")).toBeNull();

    onCommit.mockClear();
    await act(async () => {
      third.click();
    });
    input = editor.querySelector("input");
    if (!(input instanceof HTMLInputElement)) throw new Error("missing input");
    expect(editor.querySelectorAll("input")).toHaveLength(1);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "Tres");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(onCommit).toHaveBeenCalledWith("p1", 2, "Tres");
  });

  it("does not edit a read-only order", async () => {
    const onCommit = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        createElement(TranslationView, {
          pages: [aligned],
          drafts: { p1: aligned.paragraphs },
          canEdit: false,
          onCommit,
        }),
      );
    });
    const row = host.querySelector('[data-testid="translation-row-p1-0"]');
    if (!(row instanceof HTMLElement)) throw new Error("missing row");
    expect(row.getAttribute("role")).toBeNull();
    expect(row.tabIndex).toBe(-1);
    await act(async () => {
      row.click();
    });
    expect(host.querySelector("input")).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("order studio translation save", () => {
  async function renderStudio(detail: StaffDetail) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(createElement(OrderStudio, { detail, notes: [], notesError: null }));
    });
    return host;
  }

  it("keeps approve and save controls and edits one line through the existing save", async () => {
    const detail = mockStaffDetail("CP-24790");
    if (!detail) throw new Error("missing fixture");
    const html = renderToStaticMarkup(createElement(OrderStudio, { detail, notes: [], notesError: null }));
    const editor = html.slice(html.indexOf('data-testid="page-editor"'), html.indexOf('data-testid="notes-thread"'));
    expect(editor).not.toContain("<textarea");
    expect(editor).toContain("Birth certificate of María Ruiz.");
    expect(editor).toContain("Acta de nacimiento de María Ruiz.");
    expect(html).toContain('data-testid="save-translation"');
    expect(html).toContain('data-testid="approve-order"');
    expect(html).toContain('data-testid="refund-open"');

    const host = await renderStudio(detail);
    const row = host.querySelector('[data-testid="translation-row-CP-24790-p1-0"]');
    if (!(row instanceof HTMLElement)) throw new Error("missing row");
    await act(async () => {
      row.click();
    });
    const input = host.querySelector('[data-testid="page-editor"] input');
    if (!(input instanceof HTMLInputElement)) throw new Error("missing input");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "Birth certificate of Maria Ruiz.");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(patchOrderTranslation).toHaveBeenCalledTimes(1);
    expect(patchOrderTranslation).toHaveBeenCalledWith("CP-24790", [
      {
        documentId: "CP-24790-doc",
        pageNumber: 1,
        paragraphs: ["Birth certificate of Maria Ruiz."],
      },
    ]);
    expect(host.textContent).toContain("Translation saved.");
    expect(host.querySelector('[data-testid="approve-order"]')).toBeTruthy();
  });

  it("cancels a line edit on Escape without saving", async () => {
    const detail = mockStaffDetail("CP-24790");
    if (!detail) throw new Error("missing fixture");
    const host = await renderStudio(detail);
    const row = host.querySelector('[data-testid="translation-row-CP-24790-p1-0"]');
    if (!(row instanceof HTMLElement)) throw new Error("missing row");
    await act(async () => {
      row.click();
    });
    const input = host.querySelector('[data-testid="translation-input"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("missing input");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "Changed");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(patchOrderTranslation).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Birth certificate of María Ruiz.");
    expect(host.textContent).not.toContain("Changed");
  });
});
