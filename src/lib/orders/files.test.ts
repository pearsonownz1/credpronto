import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { dedupeUploads } from "./files";

async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const proxy = await getDocumentProxy(bytes);
  return proxy.numPages;
}

/** Analysis bills every stored file. Duplicates would add the same page count again. */
function billablePages(files: ReadonlyArray<unknown>, pagesPerFile: number): number {
  return files.length * pagesPerFile;
}

describe("dedupeUploads", () => {
  it("keeps the first file when the same bytes are uploaded again", () => {
    const bytes = new Uint8Array([9, 8, 7]);
    const copy = Uint8Array.from(bytes);
    const other = new Uint8Array([9, 8, 6]);
    const unique = dedupeUploads([
      { filename: "first.pdf", bytes },
      { filename: "second.pdf", bytes: copy },
      { filename: "third.pdf", bytes },
      { filename: "notes.pdf", bytes: other },
    ]);
    expect(unique.map((file) => file.filename)).toEqual(["first.pdf", "notes.pdf"]);
    expect(unique[0]?.bytes).toBe(bytes);
  });

  it("bills each PDF's pages once when the same file is uploaded two or three times", async () => {
    const bytes = new Uint8Array(readFileSync(join(__dirname, "__fixtures__", "fr_releve-notes_2p.pdf")));
    const pages = await pdfPageCount(
      new Uint8Array(readFileSync(join(__dirname, "__fixtures__", "fr_releve-notes_2p.pdf"))),
    );
    expect(pages).toBe(2);
    const upload = (filename: string) => ({ filename, bytes: Uint8Array.from(bytes) });
    const twice = [upload("releve.pdf"), upload("releve-copy.pdf")];
    const thrice = [upload("releve.pdf"), upload("releve-2.pdf"), upload("releve-3.pdf")];

    expect(billablePages(twice, pages)).toBe(4);
    expect(billablePages(dedupeUploads(twice), pages)).toBe(2);
    expect(billablePages(thrice, pages)).toBe(6);
    expect(billablePages(dedupeUploads(thrice), pages)).toBe(2);
    expect(dedupeUploads(twice)[0]?.filename).toBe("releve.pdf");
    expect(dedupeUploads(thrice)).toHaveLength(1);
  });
});
