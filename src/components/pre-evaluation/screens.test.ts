import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RATE_LIMIT_MESSAGE } from "@/lib/pre-evaluation/client";
import { preEvaluationProgress } from "@/lib/pre-evaluation/progress";
import {
  PreEvaluationEmailGate,
  PreEvaluationError,
  PreEvaluationProcessing,
  PreEvaluationResult,
  PreEvaluationUpload,
} from "./screens";

const noop = () => undefined;

describe("pre-evaluation screens", () => {
  it("asks for one PDF, JPG, or PNG inside the upload size limit", () => {
    const html = renderToStaticMarkup(
      createElement(PreEvaluationUpload, { message: null, rateLimited: false, pending: false, onSubmit: noop }),
    );
    expect(html).toContain("Check a diploma or transcript");
    expect(html).toContain("This is not an official evaluation.");
    expect(html).toContain("PDF, JPG, or PNG · 10MB or smaller");
    expect(html).toContain('accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"');
    expect(html).toContain("Check my document");
    expect(html).not.toContain("Get my official evaluation");
  });

  it("shows the minute-long progress while the preview is processing", () => {
    const html = renderToStaticMarkup(createElement(PreEvaluationProcessing, { progress: preEvaluationProgress(60_000) }));
    expect(html).toContain("Preparing your preview");
    expect(html).toContain("This usually takes about a minute.");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("Preparing your preview");
    expect(html).not.toContain("Get my official evaluation");
  });

  it("locks the result behind an email and does not reveal an equivalent", () => {
    const html = renderToStaticMarkup(
      createElement(PreEvaluationEmailGate, { message: null, rateLimited: false, pending: false, onSubmit: noop }),
    );
    expect(html).toContain("Unlock your free preview");
    expect(html).toContain("Your result stays locked until you enter an email.");
    expect(html).toContain("We&#x27;ll email the preview to you as well.");
    expect(html).toContain("This is a free preview, not an official evaluation.");
    expect(html).toContain('data-testid="preview-email"');
    expect(html).toContain("Show my preview");
    expect(html).not.toContain("Get my official evaluation");
    expect(html).not.toContain("Based on EDGE equivalency data");
    expect(html).not.toContain("PREVIEW ONLY");
    expect(html).not.toContain("Bachelor");
  });

  it("shows the rate-limit error", () => {
    const html = renderToStaticMarkup(
      createElement(PreEvaluationError, {
        message: RATE_LIMIT_MESSAGE,
        rateLimited: true,
        retryable: true,
        onRetry: noop,
        onReset: noop,
      }),
    );
    expect(html).toContain("Too many previews");
    expect(html).toContain(RATE_LIMIT_MESSAGE);
    expect(html).toContain('data-testid="pre-evaluation-rate-limit"');
    expect(html).toContain("Try again");
  });

  it("renders the watermarked free preview and the official-evaluation handoff", () => {
    const html = renderToStaticMarkup(
      createElement(PreEvaluationResult, {
        id: "prev-1",
        equivalent: "Bachelor's degree",
        confidence: "high",
        previewUrl: "https://cdn.example/preview.png",
      }),
    );
    expect(html).toContain("This is a free preview, not an official evaluation.");
    expect(html).toContain("Bachelor&#x27;s degree");
    expect(html).toContain("bg-[var(--cp-blue-l)]");
    expect(html).toContain("PREVIEW ONLY · OFFICIAL EVALUATION REQUIRED");
    expect(html).toContain("bg-[#0b1220]");
    expect(html).toContain('data-testid="pre-evaluation-watermark"');
    expect(html).toContain("pointer-events-none");
    expect(html).toContain("select-none");
    expect(html).toContain("pointer-events:none");
    expect(html).toContain("user-select:none");
    expect(html).toContain("data:image/svg+xml,");
    expect(html).toContain("PREVIEW");
    expect(html).toContain("0.09");
    expect(html).toContain("rotate(-30");
    expect(html).toContain('data-confidence="high"');
    expect(html).toContain(">High<");
    expect(html).toContain('aria-label="Based on EDGE equivalency data"');
    expect(html).toContain("Based on EDGE equivalency data");
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain(">Get my official evaluation<");
    expect(html).toContain("ready in about 5 minutes");
    expect(html).not.toContain('href="/sign-up');
    expect(html).toContain("https://cdn.example/preview.png");
    expect(html).toContain('class="mt-8 rounded-[4px] border border-line bg-white');
  });

  it("uses a medium confidence bar", () => {
    const html = renderToStaticMarkup(
      createElement(PreEvaluationResult, {
        id: "prev-2",
        equivalent: "Master's degree",
        confidence: "medium",
        previewUrl: null,
      }),
    );
    expect(html).toContain('data-confidence="medium"');
    expect(html).toContain(">Medium<");
    expect(html).toContain('aria-valuenow="66"');
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<img");
  });

  it("shows a signed PDF in a frame and keeps the watermark over it", () => {
    const html = renderToStaticMarkup(
      createElement(PreEvaluationResult, {
        id: "prev-3",
        equivalent: "Doctoral degree",
        confidence: "low",
        previewUrl: "https://cdn.example/object/sign/document.pdf?token=abc",
      }),
    );
    expect(html).toContain("<iframe");
    expect(html).toContain("document.pdf?token=abc");
    expect(html).toContain('data-testid="pre-evaluation-watermark"');
    expect(html).toContain("pointer-events:none");
    expect(html).toContain('data-confidence="low"');
    expect(html).toContain('aria-valuenow="33"');
  });
});
