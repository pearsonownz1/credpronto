import { describe, expect, it } from "vitest";
import { AiUnavailableError } from "./errors";
import { AI_ATTEMPT_TIMEOUT_MS, AI_MAX_RETRIES } from "./ai";
import {
  TRANSLATION_DEADLINE_MS,
  TRANSLATION_TIMEOUT_REASON,
  decideTranslationFailure,
} from "./translation-failure";

describe("translation failure", () => {
  it("keeps each model attempt under its own budget and the call under five minutes", () => {
    expect(AI_ATTEMPT_TIMEOUT_MS).toBe(150_000);
    expect(AI_MAX_RETRIES).toBe(2);
    expect(TRANSLATION_DEADLINE_MS).toBe(300_000);
  });

  it("sends a timeout to review without order.failed", () => {
    expect(
      decideTranslationFailure({
        error: new AiUnavailableError("Delay was aborted"),
        readyPreview: true,
        openCorrections: true,
      }),
    ).toEqual({
      status: "needs_review",
      reviewReason: TRANSLATION_TIMEOUT_REASON,
      notifyFailed: false,
    });
    expect(
      decideTranslationFailure({
        error: Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
        readyPreview: false,
        openCorrections: false,
      }).reviewReason,
    ).toBe(TRANSLATION_TIMEOUT_REASON);
  });

  it("reverts a failed correction to the previous preview and still fails a first translation", () => {
    expect(
      decideTranslationFailure({
        error: new Error("relation \"qa_runs\" does not exist"),
        readyPreview: true,
        openCorrections: true,
      }),
    ).toEqual({
      status: "preview_ready",
      reviewReason: "relation \"qa_runs\" does not exist",
      notifyFailed: false,
    });
    expect(
      decideTranslationFailure({
        error: new Error("The translation did not return every page."),
        readyPreview: false,
        openCorrections: false,
      }),
    ).toEqual({
      status: "failed",
      reviewReason: "The translation did not return every page.",
      notifyFailed: true,
    });
  });
});
