/** @vitest-environment happy-dom */
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { GcsEditorPage } from "@/lib/gcs/editor-pages";
import type { RenderBlock } from "@/lib/orders/pdf/layout";
import { TranslationEditor } from "./translation-editor";

const roots: Root[] = [];

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.replaceChildren();
});

function page(blocks: RenderBlock[]): GcsEditorPage {
  return {
    documentId: "doc-1",
    pageNumber: 1,
    combinedPageNumber: 1,
    widthPt: 612,
    heightPt: 792,
    kind: "certificate",
    blocks,
    paragraphs: [],
  };
}

function button(host: ParentNode, name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === name);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`missing button ${name}`);
  return found;
}

async function renderEditor(initial: GcsEditorPage[]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  let pages = initial;
  const paint = () => {
    root.render(
      createElement(TranslationEditor, {
        pages,
        saving: false,
        error: null,
        onChange: (next) => {
          pages = next;
        },
        onSave: () => undefined,
        onClose: () => undefined,
      }),
    );
  };
  await act(async () => {
    paint();
  });
  return {
    host,
    pages: () => pages,
    async click(name: string) {
      await act(async () => {
        button(host, name).click();
      });
      await act(async () => {
        paint();
      });
    },
  };
}

const registry = [
  { label: "Alphanumeric code", value: "022A-084542" },
  { label: "National register", value: "2020/217459" },
  { label: "Center code", value: "08071020" },
];

describe("TranslationEditor tables", () => {
  it("adds a 2x3 table, a fields block, and a paragraph", async () => {
    const editor = await renderEditor([page([{ type: "heading", text: "Diploma" }])]);
    await editor.click("Add Table");
    await editor.click("Add Fields");
    await editor.click("Add Paragraph");
    const blocks = editor.pages()[0]?.blocks ?? [];
    expect(blocks[1]).toMatchObject({
      type: "table",
      header: true,
      rows: [
        ["", "", ""],
        ["", "", ""],
      ],
    });
    expect(blocks[2]).toMatchObject({ type: "fields", rows: [{ label: "", value: "" }] });
    expect(blocks[3]).toMatchObject({ type: "paragraph", text: "" });
    expect(editor.host.querySelectorAll('input[aria-label^="Row "]')).toHaveLength(6);
  });

  it("adds and removes table columns", async () => {
    const editor = await renderEditor([
      page([{ type: "table", header: false, rows: [["A", "B"], ["1", "2"]] }]),
    ]);
    await editor.click("Add column");
    expect(editor.pages()[0]?.blocks[0]).toMatchObject({
      type: "table",
      rows: [
        ["A", "B", ""],
        ["1", "2", ""],
      ],
    });
    await editor.click("Remove column");
    expect(editor.pages()[0]?.blocks[0]).toMatchObject({
      type: "table",
      rows: [
        ["A", "B"],
        ["1", "2"],
      ],
    });

    const narrow = await renderEditor([page([{ type: "table", header: false, rows: [["Only"]] }])]);
    expect(button(narrow.host, "Remove column").disabled).toBe(true);
    await narrow.click("Remove column");
    expect(narrow.pages()[0]?.blocks[0]).toMatchObject({ type: "table", rows: [["Only"]] });
  });

  it("converts flattened fields into a horizontal table or a two-column table", async () => {
    const horizontal = await renderEditor([page([{ type: "fields", rows: registry }])]);
    await horizontal.click("Convert to horizontal table");
    expect(horizontal.pages()[0]?.blocks[0]).toEqual({
      type: "table",
      header: true,
      rows: [
        ["Alphanumeric code", "National register", "Center code"],
        ["022A-084542", "2020/217459", "08071020"],
      ],
    });

    const stacked = await renderEditor([page([{ type: "fields", rows: registry }])]);
    await stacked.click("Convert to 2-col table");
    expect(stacked.pages()[0]?.blocks[0]).toEqual({
      type: "table",
      header: false,
      rows: [
        ["Alphanumeric code", "022A-084542"],
        ["National register", "2020/217459"],
        ["Center code", "08071020"],
      ],
    });
  });

  it("edits a label, a value, and signature lines", async () => {
    const editor = await renderEditor([
      page([
        { type: "kv", label: "", value: "022A-084542" },
        { type: "signature", electronic: false, lines: ["Judit Giménez Roig", "The holder"] },
      ]),
    ]);
    const label = editor.host.querySelector('[aria-label="KV label"]');
    const lines = editor.host.querySelector('[aria-label="Signature lines"]');
    if (!(label instanceof HTMLInputElement) || !(lines instanceof HTMLTextAreaElement)) {
      throw new Error("missing kv or signature editor");
    }
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setValue?.call(label, "Alphanumeric code");
      label.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setValue?.call(lines, "Judit Giménez Roig\nThe holder");
      lines.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(editor.pages()[0]?.blocks[0]).toMatchObject({ type: "kv", label: "Alphanumeric code", value: "022A-084542" });
    expect(editor.pages()[0]?.blocks[1]).toMatchObject({
      type: "signature",
      lines: ["Judit Giménez Roig", "The holder"],
    });
  });
});
