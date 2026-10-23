import { describe, expect, it } from "vitest";
import { preEvaluationProgress } from "./progress";

describe("pre-evaluation progress", () => {
  it("starts at zero and stays under 100 after about a minute", () => {
    expect(preEvaluationProgress(0)).toMatchObject({
      displayPercent: 0,
      label: "Reading the document",
    });
    const minute = preEvaluationProgress(60_000);
    expect(minute.displayPercent).toBeGreaterThan(80);
    expect(minute.displayPercent).toBeLessThan(100);
    expect(minute.percent).toBeLessThan(100);
    expect(minute.steps.map((step) => step.state)).toEqual(["done", "done", "current"]);
  });
});
