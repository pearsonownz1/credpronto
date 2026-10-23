import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/pre-evaluation/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pre-evaluation/client")>("@/lib/pre-evaluation/client");
  return {
    ...actual,
    createPreEvaluation: vi.fn(),
    getPreEvaluation: vi.fn(),
    submitPreEvaluationEmail: vi.fn(),
  };
});

import { PreEvaluationExperience } from "./experience";

describe("pre-evaluation page", () => {
  it("opens on the public upload step", () => {
    const html = renderToStaticMarkup(createElement(PreEvaluationExperience));
    expect(html).toContain('data-testid="pre-evaluation"');
    expect(html).toContain('data-testid="pre-evaluation-upload"');
    expect(html).toContain("Check my document");
    expect(html).not.toContain("Get my official evaluation");
    expect(html).not.toContain("Unlock your free preview");
  });
});
