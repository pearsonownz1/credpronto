import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FILE_UNAVAILABLE } from "@/lib/verify/present";
import { VerifyScreen, type VerifyScreenModel } from "./verify-screen";

vi.mock("next/image", () => ({
  default: (props: { alt?: string }) => createElement("img", { alt: props.alt ?? "" }),
}));

function html(model: VerifyScreenModel): string {
  return renderToStaticMarkup(createElement(VerifyScreen, model));
}

const noop = () => undefined;

describe("verification screen", () => {
  it("shows an authentic document, its public facts, an embedded PDF, and a download", () => {
    const markup = html({
      state: "valid",
      typeLabel: "Evaluation",
      issuedOn: "March 4, 2026",
      reference: "CP-10428",
      viewerUrl: "https://files.example/report.pdf?sig=abc",
      opening: false,
      downloading: false,
      fileMessage: null,
      onDownload: noop,
      onRetry: noop,
    });

    expect(markup).toContain("Authentic CredPronto document");
    expect(markup).toContain("This document was issued by CredPronto.");
    expect(markup).toContain("Document type");
    expect(markup).toContain("Evaluation");
    expect(markup).toContain("Issued");
    expect(markup).toContain("March 4, 2026");
    expect(markup).toContain("Reference");
    expect(markup).toContain("CP-10428");
    expect(markup).toContain('data-testid="document-viewer"');
    expect(markup).toContain('src="https://files.example/report.pdf?sig=abc"');
    expect(markup).toContain('loading="eager"');
    expect(markup).toContain('referrerPolicy="no-referrer"');
    expect(markup).toContain('data-testid="document-download"');
    expect(markup).toContain("Download");
    expect(markup).not.toContain("Maria");
    expect(markup.toLowerCase()).not.toContain("date of birth");
    expect(markup.toLowerCase()).not.toContain("address");
  });

  it("shows a translation the same way", () => {
    const markup = html({
      state: "valid",
      typeLabel: "Translation",
      issuedOn: "November 2, 2026",
      reference: "TR-22",
      viewerUrl: "blob:https://www.credpronto.com/pdf",
      opening: false,
      downloading: false,
      fileMessage: null,
      onDownload: noop,
      onRetry: noop,
    });

    expect(markup).toContain("Translation");
    expect(markup).toContain("TR-22");
    expect(markup).toContain('src="blob:https://www.credpronto.com/pdf"');
  });

  it("keeps the authentic result when the file link cannot be opened", () => {
    const markup = html({
      state: "valid",
      typeLabel: "Evaluation",
      issuedOn: "March 4, 2026",
      reference: "CP-10428",
      viewerUrl: null,
      opening: false,
      downloading: false,
      fileMessage: FILE_UNAVAILABLE,
      onDownload: noop,
      onRetry: noop,
    });

    expect(markup).toContain("Authentic CredPronto document");
    expect(markup).toContain(FILE_UNAVAILABLE);
    expect(markup).toContain("Try again");
    expect(markup).not.toContain('data-testid="document-viewer"');
    expect(markup).not.toContain('data-testid="document-download"');
    expect(markup).not.toContain("files.example");
  });

  it("shows no document when the link is revoked, missing, or the check fails", () => {
    const revoked = html({
      state: "revoked",
      typeLabel: "Translation",
      issuedOn: "October 23, 2026",
      reference: "28492f38-1111-4111-8111-111111111111",
    });
    const missing = html({ state: "not_found" });
    const failed = html({ state: "error", onRetry: noop });
    const loading = html({ state: "loading" });

    expect(revoked).toContain("This document was revoked");
    expect(revoked).toContain('data-testid="verify-revoked"');
    expect(revoked).toContain("Translation");
    expect(revoked).toContain("October 23, 2026");
    expect(revoked).toContain("28492f38-1111-4111-8111-111111111111");
    expect(missing).toContain("No CredPronto document for this link");
    expect(missing).toContain("invalid");
    expect(failed).toContain("We couldn&#x27;t check this document");
    expect(loading).toContain("Checking this document");

    for (const markup of [revoked, missing, failed, loading]) {
      expect(markup).not.toContain('data-testid="document-viewer"');
      expect(markup).not.toContain('data-testid="document-download"');
      expect(markup).not.toContain("files.example");
      expect(markup).not.toContain("<iframe");
    }
  });
});
