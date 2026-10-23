import { describe, expect, it } from "vitest";
import { orderPrefill, publicPreEvaluation } from "./view";

const ready = {
  email: "ada@example.com",
  status: "ready" as const,
  usEquivalency: "Bachelor's degree",
  confidence: "high" as const,
  country: "Mexico",
  credentialName: "Licenciatura en Derecho",
  rationale: "The printed title matches a known credential. This is a free suggestion, not an official evaluation.",
  documentKind: "diploma" as const,
  degreeCount: 1,
};

describe("pre-evaluation public result", () => {
  it("hides the suggestion until an email is stored", () => {
    const hidden = publicPreEvaluation(
      { ...ready, email: null },
      "https://credpronto.test/api/pre-evaluation/secret/preview",
    );
    expect(hidden).toEqual({
      status: "email_required",
      equivalent: null,
      confidence: null,
      previewUrl: null,
    });
    expect(Object.keys(hidden).sort()).toEqual(["confidence", "equivalent", "previewUrl", "status"]);
  });

  it("returns the suggestion and preview only after the email and a finished read", () => {
    expect(
      publicPreEvaluation(ready, "https://credpronto.test/api/pre-evaluation/secret/preview"),
    ).toEqual({
      status: "ready",
      equivalent: "Bachelor's degree",
      confidence: "high",
      previewUrl: "https://credpronto.test/api/pre-evaluation/secret/preview",
    });
    expect(publicPreEvaluation({ ...ready, status: "processing" }, "https://credpronto.test/preview")).toEqual({
      status: "processing",
      equivalent: null,
      confidence: null,
      previewUrl: null,
    });
    expect(publicPreEvaluation({ ...ready, status: "failed" }, "https://credpronto.test/preview")).toEqual({
      status: "failed",
      equivalent: null,
      confidence: null,
      previewUrl: null,
    });
  });
});

describe("pre-evaluation order prefill", () => {
  it("carries the lead email into signup and the evaluation order", () => {
    expect(orderPrefill({ ...ready, email: null }, "secret-token")).toBeNull();
    const prefill = orderPrefill(ready, "secret-token");
    expect(prefill).toMatchObject({
      email: "ada@example.com",
      orderType: "evaluation",
      service: "diploma",
      degreeCount: 1,
      country: "Mexico",
      credentialName: "Licenciatura en Derecho",
      equivalent: "Bachelor's degree",
      confidence: "high",
      status: "ready",
    });
    const signup = new URL(prefill!.signupPath, "https://credpronto.test");
    expect(signup.pathname).toBe("/sign-up");
    expect(signup.searchParams.get("email")).toBe("ada@example.com");
    expect(signup.searchParams.get("next")).toBe("/translate?service=diploma&preEvaluation=secret-token");
    expect(JSON.stringify(prefill)).not.toMatch(/edgeCredential|accessToken|tokenHash/);
  });

  it("keeps the suggestion empty while the read is still running", () => {
    const prefill = orderPrefill(
      { ...ready, status: "processing", documentKind: "transcript", country: "Mexico" },
      "secret-token",
    );
    expect(prefill).toMatchObject({
      email: "ada@example.com",
      service: "course_by_course",
      equivalent: null,
      confidence: null,
      country: null,
      status: "processing",
    });
  });
});
