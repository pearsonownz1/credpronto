import { describe, expect, it } from "vitest";
import type { EdgeCredentialRecord, EdgeEquivalencyRecord } from "@/lib/orders/edge";
import { PENDING_EQUIVALENCY } from "@/lib/orders/equivalency";
import { pickBestSuggestion, preEvalRationale, suggestFromEdgeRows, unmatchedSuggestion } from "./suggest";

function credential(patch: Partial<EdgeCredentialRecord> & { id: string; title: string }): EdgeCredentialRecord {
  return {
    countrySlug: "mexico",
    country: "Mexico",
    content: "Example content for a fictional credential used only in tests.",
    levelNumber: 6,
    levelTitle: "First university degree",
    url: null,
    usEquivalency: "Bachelor's degree",
    ...patch,
  };
}

function equivalency(patch: Partial<EdgeEquivalencyRecord> & { id: string }): EdgeEquivalencyRecord {
  return {
    edgeCredentialId: "lic",
    country: "Mexico",
    credentialTitle: "Licenciatura",
    edgeLevel: "6",
    usEquivalency: "Bachelor's degree",
    basis: "Internal reference note that must stay off the customer suggestion.",
    confidence: "high",
    ...patch,
  };
}

describe("pre-evaluation equivalency suggestion", () => {
  const credentials = [credential({ id: "lic", title: "Licenciatura" })];

  it("uses the highest-confidence equivalency row for the matched title", () => {
    const suggestion = suggestFromEdgeRows({
      printed: { kind: "diploma", country: "Mexico", credential: "LICENCIADA en Derecho" },
      credentials,
      equivalencies: [
        equivalency({ id: "low", confidence: "low", usEquivalency: "Associate degree" }),
        equivalency({ id: "high", confidence: "high", usEquivalency: "Bachelor's degree" }),
      ],
    });
    expect(suggestion).toMatchObject({
      country: "Mexico",
      credentialName: "LICENCIADA en Derecho",
      equivalent: "Bachelor's degree",
      confidence: "high",
      documentKind: "diploma",
      edgeCredentialId: "lic",
      edgeMatchMethod: "base",
    });
    expect(suggestion.rationale).not.toMatch(/\bEDGE\b|basis|Internal reference/i);
    expect(suggestion.rationale).toContain("free suggestion");
  });

  it("stays low confidence when nothing matches", () => {
    const suggestion = suggestFromEdgeRows({
      printed: { kind: "transcript", country: "Narnia", credential: "Scroll of Names" },
      credentials,
      equivalencies: [],
    });
    expect(suggestion.confidence).toBe("low");
    expect(suggestion.equivalent).toBe(PENDING_EQUIVALENCY);
    expect(suggestion.edgeCredentialId).toBeNull();
    expect(suggestion.documentKind).toBe("transcript");
  });

  it("prefers a named equivalent over a higher-confidence pending one", () => {
    const pending = unmatchedSuggestion();
    const named = suggestFromEdgeRows({
      printed: { kind: "diploma", country: "Mexico", credential: "Licenciatura" },
      credentials,
      equivalencies: [equivalency({ id: "med", confidence: "medium" })],
    });
    expect(pickBestSuggestion([pending, named]).equivalent).toBe("Bachelor's degree");
    expect(preEvalRationale({
      country: "Mexico",
      credentialName: "Licenciatura",
      equivalent: "Bachelor's degree",
      confidence: "medium",
      matched: true,
    })).not.toMatch(/\bEDGE\b/);
  });
});
