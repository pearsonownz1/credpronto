import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ROBOTS_NOINDEX } from "@/lib/seo";

vi.mock("next/server", () => ({
  connection: vi.fn(() => Promise.resolve()),
}));

vi.mock("next/image", () => ({
  default: (props: { alt?: string }) => createElement("img", { alt: props.alt ?? "" }),
}));

import { connection } from "next/server";
import Page, { instant, metadata } from "./page";

describe("verify page", () => {
  it("stays out of the index and is not cached as a static shell", () => {
    expect(instant).toBe(false);
    expect(metadata.robots).toBe(ROBOTS_NOINDEX);
    expect(metadata.title).toBe("Verify document · CredPronto");
  });

  it("renders a loading check and does not print the access token", async () => {
    const element = await Page({ params: Promise.resolve({ token: "secret-access-token" }) });
    const markup = renderToStaticMarkup(element);

    expect(connection).toHaveBeenCalled();
    expect(markup).toContain("Checking this document");
    expect(markup).not.toContain("secret-access-token");
    expect(markup).not.toContain('data-testid="document-viewer"');
    expect(markup).not.toContain("<iframe");
  });
});
