import { describe, expect, it } from "vitest";
import { translatingEase } from "@/lib/flow/preview-progress";
import { gcsTranslationProgress, gcsUploadProgress } from "./gcs-progress";

describe("GCS translation progress", () => {
  it("eases off a floor before the order payload arrives", () => {
    const start = gcsTranslationProgress(null, 0);
    expect(start.progressPct).toBe(5);
    expect(start.barPercent).toBeGreaterThan(0);
    expect(start.progressStage).toBe("Reading the document and starting the translation.");
    const later = gcsTranslationProgress(null, 5_000);
    expect(later.progressPct).toBeGreaterThan(start.progressPct);
    expect(later.progressPct).toBeLessThan(20);
  });

  it("follows billable pages from the order progress", () => {
    const view = gcsTranslationProgress(
      {
        status: "processing",
        progress: {
          step: "translating",
          pagesRead: 12,
          pagesTotal: 12,
          pagesDone: 4,
          pagesTranslateTotal: 9,
        },
      },
      0,
    );
    expect(view.barPercent).toBeCloseTo(92 + 6 * (4 / 9));
    expect(view.progressPct).toBe(95);
    expect(view.progressStage).toBe("Translating… 4 pages done");
    expect(view.progressStage).not.toMatch(/page \d+ of \d+/);
    expect(view.steps.find((step) => step.id === "translating")?.state).toBe("current");
  });

  it("uses progressPct and progressStage, then eases while translating", () => {
    const order = {
      status: "processing",
      progressPct: 92,
      progressStage: "Translating and laying out",
      progress: { step: "translating", pagesRead: 2, pagesTotal: 2 },
    };
    const start = gcsTranslationProgress(order, 0);
    expect(start.progressPct).toBe(92);
    expect(start.progressStage).toBe("Translating and laying out");
    expect(start.progressPct).not.toBe(75);

    const later = gcsTranslationProgress(order, 120_000);
    expect(later.barPercent).toBeCloseTo(translatingEase(120_000));
    expect(later.progressPct).toBeGreaterThan(92);
    expect(later.progressPct).toBeLessThan(100);
    expect(later.progressStage).toBe("Translating and laying out");
  });

  it("keeps a page-based progressPct ahead of the translating ease", () => {
    const view = gcsTranslationProgress(
      {
        status: "processing",
        progressPct: 94,
        progressStage: "Translating and laying out",
        progress: {
          step: "translating",
          pagesRead: 12,
          pagesTotal: 12,
          pagesDone: 4,
          pagesTranslateTotal: 9,
        },
      },
      120_000,
    );
    expect(view.barPercent).toBeCloseTo(92 + 6 * (4 / 9));
    expect(view.progressPct).toBe(95);
    expect(view.progressStage).toBe("Translating and laying out");
  });

  it("shows upload bytes, then keeps moving while the order is created", () => {
    const quiet = gcsUploadProgress({ ratio: null, elapsedMs: 0, creating: false });
    expect(quiet.progressStage).toBe("Uploading");
    expect(quiet.progressPct).toBe(0);
    expect(quiet.barPercent).toBeGreaterThanOrEqual(0);

    const half = gcsUploadProgress({ ratio: 0.5, elapsedMs: 0, creating: false });
    expect(half.progressStage).toBe("Uploading");
    expect(half.progressPct).toBe(3);
    expect(half.barPercent).toBeCloseTo(2.5);

    const creating = gcsUploadProgress({ ratio: 1, elapsedMs: 0, creating: true });
    expect(creating.progressStage).toBe("Starting the translation");
    expect(creating.progressPct).toBeGreaterThanOrEqual(5);
    const later = gcsUploadProgress({ ratio: 1, elapsedMs: 6_000, creating: true });
    expect(later.progressPct).toBeGreaterThan(creating.progressPct);
    expect(later.progressPct).toBeLessThan(20);
  });
});
