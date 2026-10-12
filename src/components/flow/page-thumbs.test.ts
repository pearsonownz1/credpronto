import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageThumb } from "./page-thumbs";

describe("page detail thumbs", () => {
  it("uses a neutral gray skeleton until a page image exists", () => {
    const html = renderToStaticMarkup(createElement(PageThumb, { pageNumber: 0 }));
    expect(html).toContain('data-testid="page-thumb-skeleton"');
    expect(html).toContain("bg-bg-muted");
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain("#fbf8ef");
    expect(html).not.toContain("#e9e4d6");
  });
});
