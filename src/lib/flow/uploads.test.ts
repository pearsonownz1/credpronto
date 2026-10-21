import { describe, expect, it } from "vitest";
import { addUploadFiles, dedupeUploads, removeUploadFile } from "./uploads";

describe("dedupeUploads", () => {
  it("keeps the first file for each name and size", () => {
    const cv = { name: "GuyPearsonCV_under2MB.pdf", size: 1_800_000 };
    const other = { name: "notes.pdf", size: 1_800_000 };
    const renamed = { name: "GuyPearsonCV_under2MB.pdf", size: 20 };
    expect(dedupeUploads([cv, { ...cv }, cv, other, renamed])).toEqual([cv, other, renamed]);
  });

  it("adds later files onto the same list and drops only the removed row", () => {
    const first = { name: "acta.pdf", size: 10 };
    const second = { name: "photo.heic", size: 20 };
    const third = { name: "notes.png", size: 30 };
    const added = addUploadFiles([first], [second, first, third]);
    expect(added).toEqual([first, second, third]);
    expect(removeUploadFile(added, 1)).toEqual([first, third]);
    expect(removeUploadFile(added, 5)).toEqual(added);
  });

  it("leaves a single file alone", () => {
    const cv = { name: "GuyPearsonCV_under2MB.pdf", size: 3 };
    expect(dedupeUploads([cv])).toEqual([cv]);
  });
});
