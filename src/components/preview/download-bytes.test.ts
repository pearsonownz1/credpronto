import { describe, expect, it } from "vitest";
import { timedDownloadLabel } from "./download-bytes";

describe("timedDownloadLabel", () => {
  it("uses the decoded size when the browser exposes it", () => {
    expect(timedDownloadLabel({ decodedBodySize: 3056, transferSize: 3356 })).toBe("3056b");
  });

  it("does not report a hidden cross-origin body as empty", () => {
    expect(timedDownloadLabel({ decodedBodySize: 0, transferSize: 0 })).toBe("unmeasured");
  });
});
