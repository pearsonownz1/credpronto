import { describe, expect, it } from "vitest";
import { countUploadPages } from "./upload-pages";

describe("countUploadPages", () => {
  it("counts a photo as one page", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "scan.jpg", { type: "image/jpeg" });
    expect(await countUploadPages(file)).toBe(1);
  });

  it("does not invent a page count for a file the upload will not accept", async () => {
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    expect(await countUploadPages(file)).toBeNull();
  });
});
