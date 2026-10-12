import { describe, expect, it } from "vitest";
import {
  PREVIEW_POLL_MS,
  TRANSLATING_FLOOR,
  previewIsReady,
  previewPollContinues,
  previewPollDelay,
  previewStepPercent,
  previewWork,
  translatingEase,
  translatingPercent,
} from "./preview-progress";

describe("preview step progress", () => {
  it("follows progress.step and page counts, and stays under 100 while translation is running", () => {
    const received = previewWork({ status: "confirmed", progressStep: "uploaded", pagesRead: 0, pagesTotal: 4 });
    expect(received.phase).toBe("working");
    expect(received.percent).toBe(5);
    expect(received.displayPercent).toBe(5);
    expect(received.steps.map((step) => step.state)).toEqual(["current", "pending", "pending", "pending"]);

    const readingStart = previewWork({
      status: "processing",
      progressStep: "reading",
      pagesRead: 0,
      pagesTotal: 4,
    });
    expect(readingStart.percent).toBe(5);
    expect(readingStart.displayPercent).toBe(5);

    const reading = previewWork({
      status: "processing",
      progressStep: "reading",
      pagesRead: 2,
      pagesTotal: 4,
    });
    expect(reading.steps.find((step) => step.id === "read")?.state).toBe("current");
    expect(reading.percent).toBeCloseTo(32.5);
    expect(reading.displayPercent).toBe(33);
    expect(reading.displayPercent).toBeGreaterThan(received.displayPercent);
    expect(reading.displayPercent).toBeLessThanOrEqual(60);

    const readingDone = previewStepPercent({ progressStep: "reading", pagesRead: 9, pagesTotal: 9 });
    expect(readingDone).toBe(60);

    expect(previewStepPercent({ progressStep: "language" })).toBe(70);
    expect(previewStepPercent({ progressStep: "counting" })).toBe(80);
    expect(previewStepPercent({ progressStep: "quoting" })).toBe(90);

    const quoting = previewWork({ status: "confirmed", progressStep: "quoting" });
    expect(quoting.steps.find((step) => step.id === "read")?.state).toBe("current");
    expect(quoting.percent).toBe(90);
    expect(quoting.displayPercent).toBe(90);

    const translating = previewWork({
      status: "processing",
      progressStep: "translating",
      translatingElapsedMs: 0,
    });
    expect(translating.label).toBe("Translating and laying out");
    expect(translating.steps.map((step) => [step.id, step.state])).toEqual([
      ["received", "done"],
      ["read", "done"],
      ["translating", "current"],
      ["ready", "pending"],
    ]);
    expect(translating.percent).toBe(TRANSLATING_FLOOR);
    expect(translating.displayPercent).toBe(92);
    expect(translating.displayPercent).not.toBe(75);

    const later = translatingEase(120_000);
    expect(later).toBeGreaterThan(92);
    expect(later).toBeLessThan(99);
    const eased = previewWork({
      status: "processing",
      progressStep: "translating",
      translatingElapsedMs: 120_000,
    });
    expect(eased.percent).toBeCloseTo(later);
    expect(eased.displayPercent).toBeGreaterThanOrEqual(92);
    expect(eased.displayPercent).toBeLessThan(100);
  });

  it("moves with translating page counts and never presets 75", () => {
    expect(translatingPercent({ pagesRead: 0, pagesTotal: 4, translatingElapsedMs: 0 })).toBe(92);
    expect(translatingPercent({ pagesRead: 1, pagesTotal: 4, translatingElapsedMs: 0 })).toBe(93.5);
    expect(translatingPercent({ pagesRead: 2, pagesTotal: 2, translatingElapsedMs: 0 })).toBe(92);
    for (const step of ["uploaded", "reading", "language", "counting", "quoting", "translating"] as const) {
      expect(
        previewStepPercent({
          progressStep: step,
          pagesRead: 1,
          pagesTotal: 4,
          translatingElapsedMs: 0,
        }),
      ).not.toBe(75);
    }
  });

  it("does not open at 75 when the step is missing or already translating", () => {
    const missing = previewWork({ status: "processing" });
    expect(missing.percent).toBe(5);
    expect(missing.displayPercent).toBe(5);
    const translating = previewWork({ status: "confirmed", progressStep: "translating" });
    expect(translating.displayPercent).toBe(92);
    for (const step of ["uploaded", "reading", "language", "counting", "quoting", "translating"] as const) {
      expect(previewStepPercent({ progressStep: step, pagesRead: 1, pagesTotal: 2, translatingElapsedMs: 0 })).not.toBe(
        75,
      );
    }
  });

  it("is ready when status is preview_ready or progress.step is done", () => {
    expect(previewIsReady({ status: "processing", progress: { step: "translating" } })).toBe(false);
    expect(previewIsReady({ status: "processing", progressStep: "uploaded" })).toBe(false);
    expect(previewIsReady({ status: "processing", progress: { step: "done" } })).toBe(true);
    expect(previewIsReady({ status: "confirmed", progressStep: "done" })).toBe(true);
    expect(previewIsReady({ status: "preview_ready", progress: { step: "translating" } })).toBe(true);
    expect(previewIsReady({ status: "approved", progress: { step: "translating" } })).toBe(false);
    expect(previewIsReady({ status: "needs_review", progress: { step: "done" } })).toBe(false);
    const held = previewWork({ status: "needs_review", progressStep: "done" });
    expect(held.phase).toBe("working");
    expect(held.displayPercent).toBe(92);
    expect(held.displayPercent).not.toBe(75);
    expect(held.steps.find((step) => step.id === "translating")?.state).toBe("current");
    const ready = previewWork({ status: "processing", progressStep: "done" });
    expect(ready.phase).toBe("ready");
    expect(ready.displayPercent).toBe(100);
    expect(ready.label).toBe("Preview ready");
    expect(ready.steps.every((step) => step.state === "done")).toBe(true);
    const byStatus = previewWork({ status: "preview_ready", progressStep: "translating" });
    expect(byStatus.phase).toBe("ready");
  });

  it("polls every 3 seconds until a preview or an order error", () => {
    expect(PREVIEW_POLL_MS).toBe(3_000);
    expect(previewPollDelay()).toBe(PREVIEW_POLL_MS);
    const waiting = { status: "processing", progress: { step: "translating" } };
    expect(previewPollContinues(waiting, null)).toBe(true);
    expect(previewPollContinues(waiting, 500)).toBe(true);
    expect(previewPollContinues({ status: "needs_review", progress: { step: "translating" } }, 200)).toBe(true);
    expect(previewPollContinues({ status: "needs_review", progress: { step: "done" } }, 200)).toBe(true);
    expect(previewPollContinues({ status: "processing", progress: { step: "done" } }, 200)).toBe(false);
    expect(previewPollContinues({ status: "preview_ready", progress: { step: "translating" } }, 200)).toBe(false);
    expect(previewPollContinues({ status: "failed", progress: { step: "translating" } }, 200)).toBe(false);
    expect(previewPollContinues(null, 404)).toBe(false);
  });

  it("names the report step for an evaluation", () => {
    const work = previewWork({ status: "processing", orderType: "evaluation", progressStep: "translating" });
    expect(work.steps.find((step) => step.id === "translating")?.label).toBe("Building the report");
  });
});
