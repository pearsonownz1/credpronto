import { describe, expect, it } from "vitest";
import {
  asOrderProgress,
  fallbackReadingPercent,
  liveReadingPercent,
  progressForOrder,
  publicOrderProgress,
  readingPresentation,
  readOrderProgress,
  uploadFallbackPercent,
  uploadReadingPresentation,
} from "./reading-progress";

describe("live reading progress", () => {
  it("maps each step onto the quote scale", () => {
    expect(liveReadingPercent({ step: "uploaded" })).toBe(5);
    expect(liveReadingPercent({ step: "reading", pagesRead: 6, pagesTotal: 9 })).toBeCloseTo(
      5 + 55 * (6 / 9),
    );
    expect(liveReadingPercent({ step: "language" })).toBe(70);
    expect(liveReadingPercent({ step: "language" })).not.toBe(75);
    expect(liveReadingPercent({ step: "counting" })).toBe(90);
    expect(liveReadingPercent({ step: "quoting" })).toBe(95);
    expect(liveReadingPercent({ step: "done" })).toBe(100);
  });

  it("treats a missing page count as the start of reading", () => {
    expect(liveReadingPercent({ step: "reading" })).toBe(5);
    expect(liveReadingPercent({ step: "reading", pagesRead: 3, pagesTotal: 0 })).toBe(5);
    expect(liveReadingPercent({ step: "reading", pagesRead: 12, pagesTotal: 9 })).toBe(60);
  });
});

describe("reading presentation", () => {
  it("labels a page read and checks off earlier steps", () => {
    const view = readingPresentation({
      progress: { step: "reading", pagesRead: 6, pagesTotal: 9 },
      status: "draft",
      elapsedMs: 0,
    });
    expect(view.percent).toBeCloseTo(41.666, 2);
    expect(view.displayPercent).toBe(42);
    expect(view.label).toBe("Reading page 6 of 9");
    expect(view.steps.map((step) => [step.id, step.state])).toEqual([
      ["uploaded", "done"],
      ["reading", "current"],
      ["language", "pending"],
      ["counting", "pending"],
      ["quoting", "pending"],
    ]);
  });

  it("keeps Building your quote in progress when the payload says done before the quote", () => {
    const view = readingPresentation({
      progress: { step: "done" },
      status: "draft",
      elapsedMs: 0,
    });
    expect(view.percent).toBe(95);
    expect(view.displayPercent).toBe(95);
    expect(view.steps.find((step) => step.id === "quoting")?.state).toBe("current");
    expect(view.displayPercent).toBeLessThan(100);
  });

  it("never shows 100 before the order is quoted", () => {
    for (const step of ["uploaded", "reading", "language", "counting", "quoting", "done"] as const) {
      const view = readingPresentation({
        progress: { step, pagesRead: 9, pagesTotal: 9 },
        status: "draft",
        elapsedMs: 120_000,
      });
      expect(view.percent).toBeLessThan(100);
      expect(view.displayPercent).toBeLessThan(100);
    }
  });

  it("jumps to 100 and completes every step once the order is quoted", () => {
    const view = readingPresentation({
      progress: { step: "reading", pagesRead: 2, pagesTotal: 9 },
      status: "quoted",
      elapsedMs: 1_000,
    });
    expect(view.percent).toBe(100);
    expect(view.displayPercent).toBe(100);
    expect(view.steps.every((step) => step.state === "done")).toBe(true);
  });

  it("eases toward 90 percent over about a minute when progress is missing", () => {
    const start = readingPresentation({ progress: undefined, status: "draft", elapsedMs: 0 });
    expect(start.displayPercent).toBe(0);
    expect(start.steps.find((step) => step.id === "uploaded")?.state).toBe("current");

    const minute = readingPresentation({ progress: null, status: "draft", elapsedMs: 60_000 });
    expect(minute.percent).toBeCloseTo(85.52, 1);
    expect(minute.percent).toBeLessThan(90);
    expect(minute.displayPercent).toBeLessThanOrEqual(89);
    expect(minute.label).toBe("Building your quote");
    expect(minute.steps.find((step) => step.id === "quoting")?.state).toBe("current");
    expect(minute.steps.find((step) => step.id === "counting")?.state).toBe("done");

    const later = readingPresentation({ progress: undefined, status: "draft", elapsedMs: 10 * 60_000 });
    expect(later.percent).toBeLessThan(90);
    expect(later.displayPercent).toBeLessThanOrEqual(89);
    expect(later.steps.find((step) => step.id === "quoting")?.state).toBe("current");
    expect(fallbackReadingPercent(60_000)).toBeCloseTo(minute.percent);
  });

  it("advances the fallback steps on the same ease", () => {
    expect(readingPresentation({ progress: undefined, status: "draft", elapsedMs: 20_000 }).label).toBe(
      "Reading pages",
    );
    expect(readingPresentation({ progress: undefined, status: "draft", elapsedMs: 30_000 }).label).toBe(
      "Detecting language",
    );
    expect(readingPresentation({ progress: undefined, status: "draft", elapsedMs: 40_000 }).label).toBe(
      "Counting translatable text",
    );
  });

  it("keeps a translating step and a positive retry count", () => {
    expect(asOrderProgress({ step: "translating", pagesRead: 2, pagesTotal: 2, retries: 1 })).toEqual({
      step: "translating",
      pagesRead: 2,
      pagesTotal: 2,
      retries: 1,
    });
    expect(asOrderProgress({ step: "translating", pagesRead: 2, pagesTotal: 2 })).toEqual({
      step: "translating",
      pagesRead: 2,
      pagesTotal: 2,
    });
    expect(
      asOrderProgress({
        step: "translating",
        pagesRead: 12,
        pagesTotal: 12,
        pagesDone: 4,
        pagesTranslateTotal: 9,
        retries: 1,
      }),
    ).toEqual({
      step: "translating",
      pagesRead: 12,
      pagesTotal: 12,
      pagesDone: 4,
      pagesTranslateTotal: 9,
      retries: 1,
    });
  });

  it("requires integer page counts for a stored progress value", () => {
    expect(
      asOrderProgress({
        step: "done",
        pagesRead: 2,
        pagesTotal: 2,
        evaluationFailures: [{ service: "course_by_course", reason: "The transcript could not be read." }],
      }),
    ).toEqual({
      step: "done",
      pagesRead: 2,
      pagesTotal: 2,
      evaluationFailures: [{ service: "course_by_course", reason: "The transcript could not be read." }],
    });
    expect(
      publicOrderProgress({
        step: "done",
        pagesRead: 2,
        pagesTotal: 2,
        evaluationFailures: [{ service: "course_by_course", reason: "The transcript could not be read." }],
      }),
    ).toEqual({ step: "done", pagesRead: 2, pagesTotal: 2 });
    expect(asOrderProgress({ step: "reading", pagesRead: 6, pagesTotal: 9 })).toEqual({
      step: "reading",
      pagesRead: 6,
      pagesTotal: 9,
    });
    expect(asOrderProgress({ step: "reading" })).toBeNull();
    expect(asOrderProgress({ step: "reading", pagesRead: 1.5, pagesTotal: 2 })).toBeNull();
  });

  it("ignores a progress payload the API has not shipped", () => {
    expect(readOrderProgress(undefined)).toBeNull();
    expect(readOrderProgress({ step: "scanning" })).toBeNull();
    const view = readingPresentation({
      progress: { step: "scanning", pagesRead: "6" },
      status: "draft",
      elapsedMs: 0,
    });
    expect(view.displayPercent).toBe(0);
    expect(view.label).toBe("Uploaded");
  });
});

describe("delivered evaluation progress", () => {
  it("reports delivered instead of the stored uploaded step", () => {
    expect(
      progressForOrder({
        status: "delivered",
        orderType: "evaluation",
        serviceType: "evaluation",
        service: "diploma",
        progress: { step: "uploaded", pagesRead: 0, pagesTotal: 1 },
      }),
    ).toEqual({ step: "delivered", pagesRead: 0, pagesTotal: 1 });
    expect(
      progressForOrder(
        {
          status: "paid",
          orderType: "evaluation",
          service: "course_by_course",
          progress: { step: "uploaded", pagesRead: 0, pagesTotal: 0 },
        },
        "delivered",
      ).step,
    ).toBe("delivered");
    expect(
      progressForOrder({
        status: "delivered",
        orderType: "translation",
        serviceType: "translation",
        service: null,
        progress: { step: "done", pagesRead: 1, pagesTotal: 1 },
      }).step,
    ).toBe("done");
  });
});

describe("upload reading progress", () => {
  it("keeps step 1 on Uploading and eases toward 5% without byte progress", () => {
    const start = uploadReadingPresentation({ ratio: null, elapsedMs: 0 });
    expect(start.percent).toBe(0);
    expect(start.displayPercent).toBe(0);
    expect(start.label).toBe("Uploading");
    expect(start.steps.map((step) => [step.id, step.label, step.state])).toEqual([
      ["uploaded", "Uploading", "current"],
      ["reading", "Reading pages", "pending"],
      ["language", "Detecting language", "pending"],
      ["counting", "Counting translatable text", "pending"],
      ["quoting", "Building your quote", "pending"],
    ]);

    const later = uploadReadingPresentation({ ratio: null, elapsedMs: 60_000 });
    expect(later.percent).toBeGreaterThan(4);
    expect(later.percent).toBeLessThan(5);
    expect(later.displayPercent).toBeLessThanOrEqual(4);
    expect(later.label).toBe("Uploading");
    expect(later.steps[0]?.state).toBe("current");
    expect(uploadFallbackPercent(60_000)).toBeCloseTo(later.percent);
  });

  it("maps byte progress onto the 0–5% stage", () => {
    expect(uploadReadingPresentation({ ratio: 0, elapsedMs: 30_000 }).percent).toBe(0);
    const half = uploadReadingPresentation({ ratio: 0.5, elapsedMs: 0 });
    expect(half.percent).toBe(2.5);
    expect(half.displayPercent).toBe(3);
    expect(half.label).toBe("Uploading");
    const done = uploadReadingPresentation({ ratio: 1, elapsedMs: 0 });
    expect(done.percent).toBe(5);
    expect(done.displayPercent).toBe(5);
    expect(done.steps[0]?.state).toBe("current");
    expect(uploadReadingPresentation({ ratio: 4, elapsedMs: 0 }).percent).toBe(5);
  });
});
