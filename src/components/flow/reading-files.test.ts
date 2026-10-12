import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReadingFiles } from "./reading-files";

describe("reading files", () => {
  it("shows the page label, percent, and step states from the order progress", () => {
    const html = renderToStaticMarkup(
      createElement(ReadingFiles, {
        status: "draft",
        progress: { step: "reading", pagesRead: 6, pagesTotal: 9 },
      }),
    );
    expect(html).toContain("Reading your files…");
    expect(html).toContain("This usually takes a minute. You can leave this tab.");
    expect(html).toContain("Reading page 6 of 9");
    expect(html).toContain("42%");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="42"');
    expect(html).toContain('data-testid="reading-step-uploaded"');
    expect(html).toContain('data-state="done"');
    expect(html).toContain('data-testid="reading-step-reading"');
    expect(html).toContain('data-state="current"');
    expect(html).toContain("Building your quote");
    expect(html).toContain("reading-spinner");
    expect(html).toContain("max-w-[520px]");
  });

  it("shows Uploading at 0% until byte progress arrives", () => {
    const html = renderToStaticMarkup(
      createElement(ReadingFiles, { status: "draft", uploadRatio: null }),
    );
    expect(html).toContain("Reading your files…");
    expect(html).toContain("Uploading");
    expect(html).toMatch(/data-testid="reading-percent">\s*0%/);
    expect(html).toContain('data-testid="reading-step-uploaded"');
    expect(html).toContain('data-state="current"');
    expect(html).toContain('data-testid="reading-step-reading" data-state="pending"');
    expect(html).not.toContain("Reading page ");
  });

  it("fills the first 5% from upload byte progress", () => {
    const html = renderToStaticMarkup(
      createElement(ReadingFiles, { status: "draft", uploadRatio: 1 }),
    );
    expect(html).toContain("Uploading");
    expect(html).toMatch(/data-testid="reading-percent">\s*5%/);
    expect(html).toContain('aria-valuenow="5"');
  });
});
