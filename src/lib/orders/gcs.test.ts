import { describe, expect, it } from "vitest";
import {
  GCS_CERTIFICATION_STATEMENTS,
  GCS_CLIENT_FALLBACK,
  gcsCoverClientName,
  gcsFreePricePatch,
  gcsSummaryLine,
  isGcsOrder,
  readGcsClientName,
  readGcsSourceLanguage,
  readGcsTargetLanguage,
} from "./gcs";

describe("GCS order brand", () => {
  it("treats only brand gcs as the free flow", () => {
    expect(isGcsOrder({ brand: "gcs" })).toBe(true);
    expect(isGcsOrder({ brand: "credpronto" })).toBe(false);
    expect(isGcsOrder({ brand: null })).toBe(false);
    expect(isGcsOrder(undefined)).toBe(false);
    expect(gcsFreePricePatch()).toEqual({ total_cents: 0, translation_cents: 0, unit_price_cents: 0 });
  });

  it("accepts auto-detect and supported source languages", () => {
    expect(readGcsSourceLanguage(null)).toBeNull();
    expect(readGcsSourceLanguage("  ")).toBeNull();
    expect(readGcsSourceLanguage("auto-detect")).toBeNull();
    expect(readGcsSourceLanguage("Spanish")).toBe("es");
    expect(readGcsSourceLanguage("pt-BR")).toBe("pt");
    expect(() => readGcsSourceLanguage("english")).toThrow(/auto-detect/);
    expect(() => readGcsSourceLanguage("klingon")).toThrow(/auto-detect/);
    expect(readGcsTargetLanguage(null)).toBe("en");
    expect(readGcsTargetLanguage("English")).toBe("en");
    expect(readGcsTargetLanguage("Portuguese")).toBe("pt");
    expect(() => readGcsTargetLanguage("klingon")).toThrow(/English/);
  });

  it("prefers a typed client name, then the name extracted from the document", () => {
    expect(readGcsClientName("  Jane   Example  ")).toBe("Jane Example");
    expect(readGcsClientName("   ")).toBeNull();
    expect(
      gcsCoverClientName([
        { fieldKey: "full_name", confirmedValue: "Jane Example", originalValue: "Someone Else" },
      ]),
    ).toBe("Jane Example");
    expect(
      gcsCoverClientName([{ fieldKey: "full_name", confirmedValue: null, originalValue: "María Ruiz" }]),
    ).toBe("María Ruiz");
    expect(gcsCoverClientName([])).toBe(GCS_CLIENT_FALLBACK);
    expect(gcsSummaryLine({ sourceLabel: "Spanish", targetLabel: "English", documents: 1, pages: 2 })).toBe(
      "Spanish to English · 1 document · 2 pages",
    );
    expect(GCS_CERTIFICATION_STATEMENTS[0]).toContain("GEO Credential Services");
    expect(GCS_CERTIFICATION_STATEMENTS.join(" ")).not.toContain("CredPronto");
  });
});
