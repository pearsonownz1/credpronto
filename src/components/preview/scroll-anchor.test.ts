import { describe, expect, it } from "vitest";
import { anchorsMatch, visibleAnchor } from "./scroll-anchor";

describe("visibleAnchor", () => {
  it("uses the current page offset", () => {
    expect(
      visibleAnchor({
        currentPage: 2,
        pageVisibilityMetrics: [
          { pageNumber: 1, original: { pageX: 0, pageY: 40 } },
          { pageNumber: 2, original: { pageX: 4, pageY: 120 } },
        ],
      }),
    ).toEqual({ pageNumber: 2, x: 4, y: 120 });
  });

  it("falls back to the top of page 1 when nothing is visible yet", () => {
    expect(visibleAnchor({ currentPage: 0, pageVisibilityMetrics: [] })).toEqual({
      pageNumber: 1,
      x: 0,
      y: 0,
    });
  });
});

describe("anchorsMatch", () => {
  it("treats small coordinate drift as the same position", () => {
    expect(
      anchorsMatch(
        { pageNumber: 3, x: 0, y: 10 },
        { pageNumber: 3, x: 1, y: 11.5 },
      ),
    ).toBe(true);
    expect(
      anchorsMatch(
        { pageNumber: 3, x: 0, y: 10 },
        { pageNumber: 4, x: 0, y: 10 },
      ),
    ).toBe(false);
  });
});
