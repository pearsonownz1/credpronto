/** @vitest-environment happy-dom */
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { GcsEditorPage } from "@/lib/gcs/editor-pages";
import { TranslationEditor } from "./translation-editor";

const pages: GcsEditorPage[] = [
  {
    documentId: "doc-1",
    pageNumber: 1,
    combinedPageNumber: 2,
    widthPt: 612,
    heightPt: 792,
    kind: "certificate",
    paragraphs: [],
    blocks: [
      { type: "kv", label: "National Register of Degrees", value: "2020/217459" },
      { type: "kv", label: "Center Code", value: "08071020" },
      { type: "box", label: "", value: "022A-084542" },
      { type: "signature", electronic: false, lines: ["Judit Giménez Roig", "Holder"] },
    ],
  },
];

function Harness({ initial }: { initial: GcsEditorPage[] }) {
  const [current, setCurrent] = useState(initial);
  return createElement(TranslationEditor, {
    pages: current,
    saving: false,
    error: null,
    onChange: setCurrent,
    onSave: () => undefined,
    onClose: () => undefined,
  });
}

describe("translation editor tables", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  async function render(initial = pages) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(createElement(Harness, { initial }));
    });
    return host;
  }

  it("shows kv, box, and signature blocks and can rebuild them as a table", async () => {
    const view = await render();
    expect((view.querySelector('[aria-label="KV label"]') as HTMLInputElement).value).toBe("National Register of Degrees");
    expect((view.querySelector('[aria-label="Box value"]') as HTMLInputElement).value).toBe("022A-084542");
    expect((view.querySelector('[data-testid="signature-lines"]') as HTMLTextAreaElement).value).toContain("Judit Giménez Roig");

    await act(async () => {
      (view.querySelector('[data-testid="convert-to-table"]') as HTMLButtonElement).click();
    });
    expect((view.querySelector('[aria-label="Row 1 column 1"]') as HTMLInputElement).value).toBe("National Register of Degrees");
    expect((view.querySelector('[aria-label="Row 2 column 3"]') as HTMLInputElement).value).toBe("022A-084542");
    expect(view.querySelectorAll('[aria-label^="Row 1 column"]')).toHaveLength(3);

    await act(async () => {
      (view.querySelector('[data-testid="add-column"]') as HTMLButtonElement).click();
    });
    expect(view.querySelectorAll('[aria-label^="Row 1 column"]')).toHaveLength(4);

    await act(async () => {
      (view.querySelector('[data-testid="remove-column"]') as HTMLButtonElement).click();
    });
    expect(view.querySelectorAll('[aria-label^="Row 1 column"]')).toHaveLength(3);

    await act(async () => {
      (view.querySelector('[data-testid="add-table"]') as HTMLButtonElement).click();
    });
    expect(view.querySelectorAll('[data-testid="header-row"]')).toHaveLength(2);
    expect(view.textContent).toContain("Add Table");
  });
});
