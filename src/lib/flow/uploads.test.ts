import { describe, expect, it } from "vitest";
import { dedupeUploads } from "./uploads";

describe("dedupeUploads", () => {
  it("keeps the first file for each name and size", () => {
    const cv = { name: "GuyPearsonCV_under2MB.pdf", size: 1_800_000 };
    const other = { name: "notes.pdf", size: 1_800_000 };
    const renamed = { name: "GuyPearsonCV_under2MB.pdf", size: 20 };
    expect(dedupeUploads([cv, { ...cv }, cv, other, renamed])).toEqual([cv, other, renamed]);
  });

  it("leaves a single file alone", () => {
    const cv = { name: "GuyPearsonCV_under2MB.pdf", size: 3 };
    expect(dedupeUploads([cv])).toEqual([cv]);
  });
});
