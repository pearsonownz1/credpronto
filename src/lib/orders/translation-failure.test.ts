import { describe, expect, it } from "vitest";
import { AiUnavailableError } from "./errors";
import { AI_ATTEMPT_TIMEOUT_MS, AI_MAX_RETRIES } from "./ai";
import {
  TRANSLATION_DEADLINE_MS,
  TRANSLATION_MAX_DURATION_SEC,
  TRANSLATION_PAGE_DEADLINE_MS,
  TRANSLATION_SHUTDOWN_MS,
  TRANSLATION_TIMEOUT_REASON,
  decideTranslationFailure,
  raceWorkAgainstDeadline,
} from "./translation-failure";

describe("translation failure", () => {
  it("aborts the model before maxDuration so the failure can be written", () => {
    expect(AI_ATTEMPT_TIMEOUT_MS).toBe(150_000);
    expect(AI_MAX_RETRIES).toBe(2);
    expect(TRANSLATION_MAX_DURATION_SEC).toBe(300);
    expect(TRANSLATION_DEADLINE_MS).toBe(TRANSLATION_MAX_DURATION_SEC * 1000 - TRANSLATION_SHUTDOWN_MS);
    expect(TRANSLATION_DEADLINE_MS).toBeLessThan(TRANSLATION_MAX_DURATION_SEC * 1000);
    expect(TRANSLATION_DEADLINE_MS).toBeGreaterThan(AI_ATTEMPT_TIMEOUT_MS);
    expect(TRANSLATION_PAGE_DEADLINE_MS).toBe(TRANSLATION_DEADLINE_MS);
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
      reviewReason: "A database update failed. The order needs another look.",
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

describe("raceWorkAgainstDeadline", () => {
  it("rejects when the deadline has already passed and the work never finishes", async () => {
    const pending = new Promise<void>(() => {});
    await expect(raceWorkAgainstDeadline(pending, AbortSignal.abort())).rejects.toMatchObject({
      name: "AiUnavailableError",
      message: "translation_timeout",
    });
  });

  it("returns the work result when that finishes first", async () => {
    const deadline = new AbortController().signal;
    await expect(raceWorkAgainstDeadline(Promise.resolve("laid-out"), deadline)).resolves.toBe("laid-out");
  });

  it("surfaces a work error that happens before the deadline", async () => {
    const deadline = new AbortController().signal;
    await expect(raceWorkAgainstDeadline(Promise.reject(new Error("qa insert failed")), deadline)).rejects.toThrow(
      "qa insert failed",
    );
  });

  it("ignores work that fails after the deadline already won", async () => {
    let rejectWork: (error: Error) => void = () => {};
    const work = new Promise<void>((_, reject) => {
      rejectWork = reject;
    });
    await expect(raceWorkAgainstDeadline(work, AbortSignal.abort())).rejects.toMatchObject({
      name: "AiUnavailableError",
    });
    rejectWork(new Error("layout finished late"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
