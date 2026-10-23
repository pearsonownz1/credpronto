import { describe, expect, it } from "vitest";
import { mapPreEvaluation, suggestionClaimable } from "./db";
import { PRE_EVAL_STALE_MS } from "./constants";

describe("pre-evaluation rows", () => {
  it("maps a stored row and drops a row with a bad confidence", () => {
    const row = {
      id: "11111111-1111-4111-8111-111111111111",
      token_hash: "a".repeat(64),
      access_token: "b".repeat(43),
      status: "ready",
      storage_path: "11111111-1111-4111-8111-111111111111/scan.pdf",
      filename: "scan.pdf",
      mime: "application/pdf",
      size_bytes: 12,
      ip_hash: "c".repeat(64),
      country: "Mexico",
      credential_name: "Licenciatura",
      us_equivalency: "Bachelor's degree",
      confidence: "high",
      rationale: "Matched.",
      document_kind: "diploma",
      degree_count: 1,
      edge_credential_id: null,
      edge_match_method: "base",
      email: "ada@example.com",
      email_submitted_at: "2026-10-23T18:00:00.000Z",
      result_email_sent_at: null,
      suggestion_started_at: null,
      preview_path: "11111111-1111-4111-8111-111111111111/renders/preview.pdf",
      preview_mime: "application/pdf",
      created_at: "2026-10-23T17:00:00.000Z",
    };
    const mapped = mapPreEvaluation(row);
    expect(mapped?.confidence).toBe("high");
    expect(mapped?.email).toBe("ada@example.com");
    expect(mapped?.previewPath).toBe("11111111-1111-4111-8111-111111111111/renders/preview.pdf");
    expect(mapped?.previewMime).toBe("application/pdf");
    expect(mapPreEvaluation({ ...row, preview_path: row.storage_path })?.previewPath).toBeNull();
    expect(mapPreEvaluation({ ...row, confidence: "certain" })?.confidence).toBeNull();
    expect(mapPreEvaluation({ ...row, status: "nope" })).toBeNull();
  });

  it("lets a second worker claim only after the first attempt goes quiet", () => {
    const now = "2026-10-23T18:00:00.000Z";
    expect(suggestionClaimable(null, now)).toBe(true);
    expect(suggestionClaimable("2026-10-23T17:59:30.000Z", now)).toBe(false);
    const stale = new Date(Date.parse(now) - PRE_EVAL_STALE_MS).toISOString();
    expect(suggestionClaimable(stale, now)).toBe(true);
  });
});
