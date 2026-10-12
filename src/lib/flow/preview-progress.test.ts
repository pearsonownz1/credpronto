import { describe, expect, it } from "vitest";
import { previewIsReady, previewWork } from "./preview-progress";

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
    expect(translating.percent).toBeLessThan(100);
    expect(translating.displayPercent).toBeLessThan(100);

    const afterQuote = previewWork({ status: "confirmed", progressStep: "done" });
    expect(afterQuote.steps.find((step) => step.id === "translating")?.state).toBe("current");
    expect(afterQuote.displayPercent).toBeLessThan(100);
  });

  it("is ready only when the order status is preview_ready", () => {
    expect(previewIsReady("processing")).toBe(false);
    expect(previewIsReady("correction_requested")).toBe(false);
    expect(previewIsReady("preview_ready")).toBe(true);
    const ready = previewWork({ status: "preview_ready", progressStep: "translating" });
    expect(ready.phase).toBe("ready");
    expect(ready.displayPercent).toBe(100);
    expect(ready.steps.every((step) => step.state === "done")).toBe(true);
  });

  it("names the report step for an evaluation", () => {
    const work = previewWork({ status: "processing", orderType: "evaluation", progressStep: "translating" });
    expect(work.steps.find((step) => step.id === "translating")?.label).toBe("Building the report");
  });
});
