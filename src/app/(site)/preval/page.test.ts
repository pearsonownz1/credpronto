import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrevalLanding } from "@/components/preval/landing";
import { PRE_EVALUATION_PATH } from "@/lib/pre-evaluation/handoff";
import { PREVAL_CANONICAL, PREVAL_DESCRIPTION, PREVAL_TITLE, ROBOTS_NOINDEX } from "@/lib/seo";
import { metadata } from "./page";

const BANNED = /\bGuy\b|Pearson|\bGCS\b|gcs\.org|GEO Credential Services|ImmiTranslate/i;

describe("preval page", () => {
  it("is indexable with a title, description, and canonical", () => {
    expect(metadata.title).toBe(PREVAL_TITLE);
    expect(metadata.description).toBe(PREVAL_DESCRIPTION);
    expect(metadata.alternates).toEqual({ canonical: PREVAL_CANONICAL });
    expect(metadata.robots).not.toBe(ROBOTS_NOINDEX);
    expect(JSON.stringify(metadata)).not.toMatch(/noindex/i);
    expect(PREVAL_CANONICAL).toBe("https://www.credpronto.com/preval");
  });

  it("renders the landing comp and starts the existing pre-evaluation flow", () => {
    const html = renderToStaticMarkup(createElement(PrevalLanding));
    const example = html.indexOf('data-testid="preval-example"');
    const degree = html.indexOf("Bachelor of Science in Engineering");

    expect(html).toContain("FREE INSTANT PREVAL");
    expect(html).toContain("See your likely U.S. equivalent in about a minute.");
    expect(html).toContain(PREVAL_DESCRIPTION);
    expect(html).toContain(`href="${PRE_EVALUATION_PATH}"`);
    expect(html).toContain("Upload diploma or transcript");
    expect(html).toContain("PDF, JPG or PNG, up to 10 MB");
    expect(html).toContain("LIKELY U.S. EQUIVALENT");
    expect(example).toBeGreaterThan(html.indexOf("LIKELY U.S. EQUIVALENT"));
    expect(example).toBeLessThan(degree);
    expect(html).toContain(">Example<");
    expect(html).toContain("High confidence");
    expect(html).toContain('data-testid="preval-watermark"');
    expect(html).toContain(">PREVIEW<");
    expect(html).toContain("PREVIEW ONLY · OFFICIAL EVALUATION REQUIRED");
    expect(html).toContain(">Upload<");
    expect(html).toContain("Add a diploma or transcript.");
    expect(html).toContain("Enter your email");
    expect(html).toContain("We send your preview there too.");
    expect(html).toContain("See your PreVal");
    expect(html).toContain("Then order the official evaluation, ready in about 5 minutes.");
    expect(html).not.toContain("/api/pre-evaluation");
    expect(html).not.toContain('type="file"');
    expect(html).not.toMatch(BANNED);
  });
});