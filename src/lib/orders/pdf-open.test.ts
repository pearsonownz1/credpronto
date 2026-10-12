import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { buildCombinedOriginal } from "./pdf/combine";
import { pdfPageTexts } from "./pdf-text";

describe("text PDF open", () => {
  it("combines a normal text PDF after its text layer is read", async () => {
    const bytes = new Uint8Array(
      readFileSync(join(__dirname, "__fixtures__", "fr_releve-notes_2p.pdf")),
    );
    const texts = await pdfPageTexts(bytes);
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.some((text) => text.trim().length > 40)).toBe(true);

    const combined = await buildCombinedOriginal([{ bytes, mime: "application/pdf" }]);
    expect(combined.pages).toHaveLength(texts.length);
    const loaded = await PDFDocument.load(combined.pdf);
    expect(loaded.getPageCount()).toBe(texts.length);
  });

  it("logs the parser error when a PDF cannot be opened", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      buildCombinedOriginal([{ bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), mime: "application/pdf" }]),
    ).rejects.toThrow("password-protected or could not be opened");
    const logged = spy.mock.calls.flat().map((part) => String(part)).join("\n");
    expect(logged).toMatch(/Could not open PDF:/);
    expect(logged).not.toMatch(/password-protected/);
    spy.mockRestore();
  });
});
