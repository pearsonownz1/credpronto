import { asSchema } from "@ai-sdk/provider-utils";
import { describe, expect, it } from "vitest";
import { blocksFromModel } from "./pdf/structure";
import {
  BLOCK_TEXT_MAX,
  PAGE_BLOCK_MAX,
  SEAL_TEXT_MAX,
  TRANSLATION_MAX_OUTPUT_TOKENS,
  translationPageSchema,
} from "./translation-output";

function walk(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  visit(value as Record<string, unknown>);
  for (const child of Object.values(value)) walk(child, visit);
}

describe("translation page schema", () => {
  it("is one object with capped blocks and no union", async () => {
    const json = await asSchema(translationPageSchema).jsonSchema;
    const text = JSON.stringify(json);
    expect(text).not.toContain("anyOf");
    expect(text).not.toContain("oneOf");
    expect(TRANSLATION_MAX_OUTPUT_TOKENS).toBe(65_536);

    const nodes: Record<string, unknown>[] = [];
    walk(json, (node) => nodes.push(node));
    expect(nodes.some((node) => node.maxItems === PAGE_BLOCK_MAX)).toBe(true);
    expect(nodes.some((node) => node.maxLength === BLOCK_TEXT_MAX)).toBe(true);
    expect(text).toContain(`at most ${SEAL_TEXT_MAX} characters`);
    expect(text).not.toContain('"lines"');

    const overflow = translationPageSchema.safeParse({
      pageNumber: 1,
      blocks: Array.from({ length: PAGE_BLOCK_MAX + 1 }, () => ({
        type: "seal",
        text: "Civil Registry of Jalisco",
        level: 2,
        electronic: false,
        rows: [],
      })),
    });
    expect(overflow.success).toBe(false);

    const longText = translationPageSchema.safeParse({
      pageNumber: 1,
      blocks: [
        {
          type: "paragraph",
          text: "x".repeat(BLOCK_TEXT_MAX + 1),
          level: 2,
          electronic: false,
          rows: [],
        },
      ],
    });
    expect(longText.success).toBe(false);
  });

  it("cuts a repeated stamp down to one short seal", () => {
    const blocks = blocksFromModel({
      blocks: [{ type: "seal", text: `${"OFICIALIA ".repeat(40)}SAMPLE` }],
    });
    const seals = blocks.filter((block) => block.type === "seal");
    expect(seals).toHaveLength(1);
    expect(seals[0]?.type === "seal" && seals[0].text.length).toBeLessThanOrEqual(SEAL_TEXT_MAX);
  });
});
