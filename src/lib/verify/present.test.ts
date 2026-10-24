import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { downloadFilename, formatIssuedOn, verificationFacts } from "./present";

const BANNED = /\bGuy\b|Pearson|\bGCS\b|gcs\.org|GEO Credential Services|ImmiTranslate/i;

describe("verification presentation", () => {
  it("formats the issue date and the public document type", () => {
    expect(
      verificationFacts({
        status: "valid",
        type: "evaluation",
        issuedAt: "2026-03-04",
        documentUrl: null,
        reference: "CP-10428",
      }),
    ).toEqual({
      typeLabel: "Evaluation",
      issuedOn: "March 4, 2026",
      reference: "CP-10428",
    });
    expect(formatIssuedOn("2026-10-23T19:10:00.000Z")).toBe("October 23, 2026");
    expect(formatIssuedOn("not-a-date")).toBeNull();
    expect(
      verificationFacts({
        status: "valid",
        type: "translation",
        issuedAt: "2026-11-02T15:04:00.000Z",
        documentUrl: null,
        reference: null,
      }).typeLabel,
    ).toBe("Translation");
  });

  it("builds a download name from the reference only", () => {
    expect(downloadFilename("CP-10428")).toBe("credpronto-CP-10428.pdf");
    expect(downloadFilename("CP 10428/A")).toBe("credpronto-CP10428A.pdf");
    expect(downloadFilename(null)).toBe("credpronto-document.pdf");
  });

  it("does not name other credential businesses", () => {
    const files = [
      "src/lib/verify/client.ts",
      "src/lib/verify/link-refresh.ts",
      "src/lib/verify/load.ts",
      "src/lib/verify/present.ts",
      "src/components/verify/verify-screen.tsx",
      "src/components/verify/verify-experience.tsx",
      "src/app/verify/layout.tsx",
      "src/app/verify/[token]/page.tsx",
    ];
    for (const file of files) {
      expect(readFileSync(file, "utf8")).not.toMatch(BANNED);
    }
  });
});
