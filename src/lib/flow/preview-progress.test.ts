import { describe, expect, it } from "vitest";
import {
  PREVIEW_LONG_WAIT_MS,
  PREVIEW_POLL_MS,
  previewIsReady,
  previewPollContinues,
  previewPollDelay,
  previewWork,
  translatingTooLong,
} from "./preview-progress";

describe("preview step progress", () => {
  it("fills by step and stays under 100 while translation is still running", () => {
    const received = previewWork({ status: "confirmed", progressStep: "uploaded" });
    expect(received.phase).toBe("working");
    expect(received.displayPercent).toBeLessThan(100);
    expect(received.steps.map((step) => step.state)).toEqual(["current", "pending", "pending", "pending"]);

    const reading = previewWork({ status: "processing", progressStep: "reading" });
    expect(reading.steps.find((step) => step.id === "read")?.state).toBe("current");
    expect(reading.displayPercent).toBeGreaterThan(received.displayPercent);
    expect(reading.displayPercent).toBeLessThan(100);

    const translating = previewWork({ status: "processing", progressStep: "translating" });
    expect(translating.label).toBe("Translating and laying out");
    expect(translating.steps.map((step) => [step.id, step.state])).toEqual([
      ["received", "done"],
      ["read", "done"],
      ["translating", "current"],
      ["ready", "pending"],
    ]);
    expect(received.percent).toBe(25);
    expect(received.displayPercent).toBe(25);
    expect(reading.percent).toBe(50);
    expect(reading.displayPercent).toBe(50);
    expect(translating.percent).toBe(75);
    expect(translating.displayPercent).toBe(75);

    const quoting = previewWork({ status: "confirmed", progressStep: "quoting" });
    expect(quoting.steps.find((step) => step.id === "read")?.state).toBe("current");
    expect(quoting.displayPercent).toBeLessThan(100);
  });

  it("is ready when status is preview_ready or progress.step is done", () => {
    expect(previewIsReady({ status: "processing", progress: { step: "translating" } })).toBe(false);
    expect(previewIsReady({ status: "processing", progressStep: "uploaded" })).toBe(false);
    expect(previewIsReady({ status: "processing", progress: { step: "done" } })).toBe(true);
    expect(previewIsReady({ status: "confirmed", progressStep: "done" })).toBe(true);
    expect(previewIsReady({ status: "preview_ready", progress: { step: "translating" } })).toBe(true);
    expect(previewIsReady({ status: "approved", progress: { step: "translating" } })).toBe(false);
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
    expect(previewPollContinues({ status: "processing", progress: { step: "done" } }, 200)).toBe(false);
    expect(previewPollContinues({ status: "preview_ready", progress: { step: "translating" } }, 200)).toBe(false);
    expect(previewPollContinues({ status: "failed", progress: { step: "translating" } }, 200)).toBe(false);
    expect(previewPollContinues(null, 404)).toBe(false);
  });

  it("flags a translation that is still translating after 15 minutes", () => {
    const started = Date.parse("2026-10-12T12:00:00.000Z");
    expect(
      translatingTooLong({ progressStep: "translating", startedAt: started, now: started + PREVIEW_LONG_WAIT_MS - 1 }),
    ).toBe(false);
    expect(
      translatingTooLong({ progressStep: "translating", startedAt: started, now: started + PREVIEW_LONG_WAIT_MS }),
    ).toBe(true);
    expect(
      translatingTooLong({ progressStep: "done", startedAt: started, now: started + PREVIEW_LONG_WAIT_MS }),
    ).toBe(false);
  });

  it("names the report step for an evaluation", () => {
    const work = previewWork({ status: "processing", orderType: "evaluation", progressStep: "translating" });
    expect(work.steps.find((step) => step.id === "translating")?.label).toBe("Building the report");
  });
});
