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
  it("pairs segment k with the k-th non-blank source line", () => {
    expect(translationLines("A\n\nB", ["a", "b"])).toEqual({
      rows: [
        { source: "A", translation: "a", segmentIndex: 0 },
        { source: "", translation: "", segmentIndex: null },
        { source: "B", translation: "b", segmentIndex: 1 },
      ],
      extra: 0,
      missing: 0,
    });
  });

  it("pairs each non-blank diploma line with its own segment", () => {
    const source = "Ministère de l'Education Nationale\n\nOffice du Baccalauréat du Cameroun";
    expect(translationLines(source, ["Ministry of National Education", "Cameroon Baccalaureate Office"])).toEqual({
      rows: [
        { source: "Ministère de l'Education Nationale", translation: "Ministry of National Education", segmentIndex: 0 },
        { source: "", translation: "", segmentIndex: null },
        { source: "Office du Baccalauréat du Cameroun", translation: "Cameroon Baccalaureate Office", segmentIndex: 1 },
      ],
      extra: 0,
      missing: 0,
    });
  });

  it("shows extra segments after the source and counts them", () => {
    expect(translationLines("A\n\nB", ["a", "b", "c"])).toEqual({
      rows: [
        { source: "A", translation: "a", segmentIndex: 0 },
        { source: "", translation: "", segmentIndex: null },
        { source: "B", translation: "b", segmentIndex: 1 },
        { source: "", translation: "c", segmentIndex: 2 },
      ],
      extra: 1,
      missing: 0,
    });
  });

  it("leaves unmatched source lines blank and counts the missing segments", () => {
    expect(translationLines("A\nB\n\nC", ["a"])).toEqual({
      rows: [
        { source: "A", translation: "a", segmentIndex: 0 },
        { source: "B", translation: "", segmentIndex: 1 },
        { source: "", translation: "", segmentIndex: null },
        { source: "C", translation: "", segmentIndex: 2 },
      ],
      extra: 0,
      missing: 2,
    });
  });

  it("lines up when blank rows explain the gap between source rows and segments", () => {
    const blankAt = new Set([3, 10, 20, 30, 40, 50, 60, 70]);
    const sourceRows = Array.from({ length: 85 }, (_, index) => (blankAt.has(index) ? "" : `Line ${index}`));
    const segments = sourceRows.filter((line) => line.trim().length > 0).map((line) => `T ${line}`);
    expect(sourceRows).toHaveLength(85);
    expect(segments).toHaveLength(77);

    const alignment = translationLines(sourceRows.join("\n"), segments);
    expect(alignment.rows).toHaveLength(85);
    expect(alignment.extra).toBe(0);
    expect(alignment.missing).toBe(0);

    let segment = 0;
    for (const [index, row] of alignment.rows.entries()) {
      if (blankAt.has(index)) {
        expect(row).toEqual({ source: "", translation: "", segmentIndex: null });
        continue;
      }
      expect(row).toEqual({ source: `Line ${index}`, translation: segments[segment], segmentIndex: segment });
      segment += 1;
    }
    expect(segment).toBe(77);
  });

  it("places out-of-order segments on the source line named by source_index", () => {
    expect(translationLines("A\n\nB\nC", ["c-text", "a-text", "b-text"], [3, 0, 2])).toEqual({
      rows: [
        { source: "A", translation: "a-text", segmentIndex: 1 },
        { source: "", translation: "", segmentIndex: null },
        { source: "B", translation: "b-text", segmentIndex: 2 },
        { source: "C", translation: "c-text", segmentIndex: 0 },
      ],
      extra: 0,
      missing: 0,
    });
  });

  it("keeps a source_index with no matching line in the extra count", () => {
    const alignment = translationLines("A\n\nB", ["on-a", "on-blank", "past-end"], [0, 1, 9]);
    expect(alignment).toEqual({
      rows: [
        { source: "A", translation: "on-a", segmentIndex: 0 },
        { source: "", translation: "", segmentIndex: null },
        { source: "B", translation: "", segmentIndex: null },
        { source: "", translation: "on-blank", segmentIndex: 1 },
        { source: "", translation: "past-end", segmentIndex: 2 },
      ],
      extra: 2,
      missing: 1,
    });
  });

  it("leaves a line read-only when no segment's source_index names it", () => {
    expect(translationLines("A\nB", ["b-text"], [1])).toEqual({
      rows: [
        { source: "A", translation: "", segmentIndex: null },
        { source: "B", translation: "b-text", segmentIndex: 0 },
      ],
      extra: 0,
      missing: 1,
    });
  });

  it("uses positional pairing only for segments whose source_index is absent", () => {
    const indexes = [3] as number[];
    expect(translationLines("A\n\nB\nC", ["from-index", "positional-second"], indexes)).toEqual({
      rows: [
        { source: "A", translation: "", segmentIndex: null },
        { source: "", translation: "", segmentIndex: null },
        { source: "B", translation: "positional-second", segmentIndex: 1 },
        { source: "C", translation: "from-index", segmentIndex: 0 },
      ],
      extra: 0,
      missing: 1,
    });
  });
});

describe("translation view", () => {
  const aligned = page({
    id: "p1",
    sourceText: "Alpha\n\nGamma",
    paragraphs: ["One", "Two"],
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
    expect(html).toContain("Two");
    expect(html).not.toContain("translation-mismatch");
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
    expect(onCommit).toHaveBeenCalledWith("p1", 1, "Tres");
    expect(third.getAttribute("data-segment-index")).toBe("1");
  });

  it("warns about extra segments and saves an edit to that segment index", async () => {
    const onCommit = vi.fn();
    const html = renderToStaticMarkup(
      createElement(TranslationView, {
        pages: [page({ id: "p1", sourceText: "A\n\nB", paragraphs: ["a", "b", "spare"] })],
        drafts: { p1: ["a", "b", "spare"] },
        canEdit: true,
        onCommit,
      }),
    );
    expect(html).toContain("Translation has 1 extra segment not matched to the source");
    expect(html).toContain("spare");
    expect(html).toContain('data-segment-index="2"');

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        createElement(TranslationView, {
          pages: [page({ id: "p1", sourceText: "A\n\nB", paragraphs: ["a", "b", "spare"] })],
          drafts: { p1: ["a", "b", "spare"] },
          canEdit: true,
          onCommit,
        }),
      );
    });
    const extra = host.querySelector('[data-segment-index="2"]');
    if (!(extra instanceof HTMLElement)) throw new Error("missing extra row");
    await act(async () => {
      extra.click();
    });
    const input = host.querySelector("input");
    if (!(input instanceof HTMLInputElement)) throw new Error("missing input");
    expect(input.value).toBe("spare");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "kept");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onCommit).toHaveBeenCalledWith("p1", 2, "kept");
  });

  it("warns about missing segments and does not edit a row past the stored list", async () => {
    const onCommit = vi.fn();
    const html = renderToStaticMarkup(
      createElement(TranslationView, {
        pages: [page({ id: "p1", sourceText: "A\nB\nC", paragraphs: ["a"] })],
        drafts: { p1: ["a"] },
        canEdit: true,
        onCommit,
      }),
    );
    expect(html).toContain("Translation is missing 2 segments for the source");
    expect(html).toContain('data-segment-index="2"');
    expect(html).not.toContain('aria-label="Translation page 1 segment 3"');

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        createElement(TranslationView, {
          pages: [page({ id: "p1", sourceText: "A\nB\nC", paragraphs: ["a"] })],
          drafts: { p1: ["a"] },
          canEdit: true,
          onCommit,
        }),
      );
    });
    const pastGap = host.querySelector('[data-segment-index="2"]');
    const firstGap = host.querySelector('[data-segment-index="1"]');
    if (!(pastGap instanceof HTMLElement) || !(firstGap instanceof HTMLElement)) throw new Error("missing unmatched rows");
    expect(pastGap.getAttribute("role")).toBeNull();
    expect(firstGap.getAttribute("role")).toBeNull();
    await act(async () => {
      pastGap.click();
      firstGap.click();
    });
    expect(host.querySelector("input")).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
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

  it("saves an out-of-order segment at its stored index, not the visual row", async () => {
    const onCommit = vi.fn();
    const reordered = page({
      id: "p1",
      sourceText: "A\n\nB\nC",
      paragraphs: ["c-text", "a-text", "b-text"],
      sourceIndexes: [3, 0, 2],
    });
    const html = renderToStaticMarkup(
      createElement(TranslationView, {
        pages: [reordered],
        drafts: { p1: reordered.paragraphs },
        canEdit: true,
        onCommit,
      }),
    );
    expect(html).not.toContain("translation-mismatch");
    expect(html).toContain('data-segment-index="1"');
    expect(html.indexOf("a-text")).toBeLessThan(html.indexOf("b-text"));
    expect(html.indexOf("b-text")).toBeLessThan(html.indexOf("c-text"));

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        createElement(TranslationView, {
          pages: [reordered],
          drafts: { p1: reordered.paragraphs },
          canEdit: true,
          onCommit,
        }),
      );
    });

    const sourceLine = host.querySelector('[data-testid="translation-row-p1-0"]');
    const matched = host.querySelector('[data-testid="translation-row-p1-3"]');
    if (!(sourceLine instanceof HTMLElement) || !(matched instanceof HTMLElement)) throw new Error("missing rows");
    expect(sourceLine.textContent).toContain("A");
    expect(sourceLine.textContent).toContain("a-text");
    expect(sourceLine.getAttribute("data-segment-index")).toBe("1");
    expect(matched.textContent).toContain("C");
    expect(matched.textContent).toContain("c-text");
    expect(matched.getAttribute("data-segment-index")).toBe("0");

    await act(async () => {
      matched.click();
    });
    const input = host.querySelector("input");
    if (!(input instanceof HTMLInputElement)) throw new Error("missing input");
    expect(input.value).toBe("c-text");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "Cee");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("p1", 0, "Cee");
  });

  it("shows a dangling source_index as an extra segment and leaves an unnamed line read-only", async () => {
    const onCommit = vi.fn();
    const dangling = page({
      id: "p1",
      sourceText: "A\nB",
      paragraphs: ["b-text", "nowhere"],
      sourceIndexes: [1, 4],
    });
    const html = renderToStaticMarkup(
      createElement(TranslationView, {
        pages: [dangling],
        drafts: { p1: dangling.paragraphs },
        canEdit: true,
        onCommit,
      }),
    );
    expect(html).toContain("Translation has 1 extra segment not matched to the source");
    expect(html).toContain("nowhere");

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        createElement(TranslationView, {
          pages: [dangling],
          drafts: { p1: dangling.paragraphs },
          canEdit: true,
          onCommit,
        }),
      );
    });

    const missing = host.querySelector('[data-testid="translation-row-p1-0"]');
    const extra = host.querySelector('[data-segment-index="1"]');
    if (!(missing instanceof HTMLElement) || !(extra instanceof HTMLElement)) throw new Error("missing rows");
    expect(missing.textContent).toContain("A");
    expect(missing.getAttribute("data-segment-index")).toBe("");
    expect(missing.getAttribute("role")).toBeNull();
    await act(async () => {
      missing.click();
    });
    expect(host.querySelector("input")).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();

    await act(async () => {
      extra.click();
    });
    const input = host.querySelector("input");
    if (!(input instanceof HTMLInputElement)) throw new Error("missing input");
    expect(input.value).toBe("nowhere");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "kept");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onCommit).toHaveBeenCalledWith("p1", 1, "kept");
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

    const withEvaluation = renderToStaticMarkup(
      createElement(OrderStudio, {
        detail: {
          ...detail,
          services: ["translation", "diploma"],
          evaluationReports: [{ service: "diploma", uploaded: false }],
        },
        notes: [],
        notesError: null,
      }),
    );
    expect(withEvaluation).toContain("Generate missing evaluations");
    expect(withEvaluation).toContain('data-testid="regenerate-evaluations"');
    expect(withEvaluation).toContain('data-testid="translation-row-CP-24790-p1-0"');

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
