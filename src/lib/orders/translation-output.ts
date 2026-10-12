import { z } from "zod";

/**
 * Gemini 3.8 Flash output ceiling. Thinking tokens count against this budget.
 * 16000 was small enough that a seal-heavy page stopped with finishReason=length
 * and the SDK could not parse the truncated JSON.
 */
export const TRANSLATION_MAX_OUTPUT_TOKENS = 65_536;

/** Low keeps thinking from consuming the JSON. `minimal` is rejected by this model. */
export const TRANSLATION_REASONING = "low" as const;

/** One seal caption. Longer stamp rings are cut after the model returns. */
export const SEAL_TEXT_MAX = 80;

/** A paragraph, not a copied stamp. Gemini may ignore maxLength; we still reject longer text. */
export const BLOCK_TEXT_MAX = 1_200;

/** Enough for an acta form. Stops a block-per-letter stamp from running away. */
export const PAGE_BLOCK_MAX = 60;

const rowSchema = z.object({
  label: z.string().max(160),
  value: z.string().max(400),
});

const blockSchema = z.object({
  type: z.enum(["heading", "paragraph", "fields", "seal", "signature", "note"]),
  text: z
    .string()
    .max(BLOCK_TEXT_MAX)
    .describe(
      `English text. When type is seal, at most ${SEAL_TEXT_MAX} characters and only a place name. Never copy a stamp ring or repeat it.`,
    ),
  level: z.number().int().min(1).max(2),
  electronic: z.boolean(),
  rows: z.array(rowSchema).max(40),
});

/** One page. A single object, not a union, so the model is not choosing between shapes. */
export const translationPageSchema = z.object({
  pageNumber: z.number().int(),
  blocks: z.array(blockSchema).min(1).max(PAGE_BLOCK_MAX),
});

export const translationDocumentSchema = z.object({
  pages: z.array(translationPageSchema).min(1),
});

export type TranslationPageOutput = z.infer<typeof translationPageSchema>;

export function translationGenerateOptions(model?: string | null): {
  maxRetries: 0;
  maxOutputTokens: number;
  reasoning: typeof TRANSLATION_REASONING;
  model?: string;
} {
  return {
    maxRetries: 0,
    maxOutputTokens: TRANSLATION_MAX_OUTPUT_TOKENS,
    reasoning: TRANSLATION_REASONING,
    ...(model ? { model } : {}),
  };
}

/** Shared layout rules. The retry adds a shorter reminder on top of these. */
export function translationBlockRules(): string {
  return `Return blocks in the original top-to-bottom order.
Keep names, CURPs, and place spellings exactly as printed or confirmed. Do not join a label and its value into a paragraph.

For a form, use type "fields" and rows of {label, value}. Translate labels into English. One row per field, in the original order. For every other type, set rows to [].

For prose, use type "paragraph" and preserve paragraph breaks. Keep each text value under ${BLOCK_TEXT_MAX} characters.

For a seal, stamp, coat of arms, or letter-spaced ring, use type "seal" once. Set text to a place name of at most ${SEAL_TEXT_MAX} characters, such as "Civil Registry of Jalisco". Do not copy ring text. Do not letter-space it. Do not emit one block per character. Do not repeat the seal.

For a handwritten signature, use type "signature" with electronic false.
For an electronic signature, firma electrónica, or a long unbroken signature token, use type "signature" with electronic true. Do not copy the signature string.

For a section title, use type "heading" and set level to 1. For every other block, set level to 2.
Set electronic to false except on an electronic signature.`;
}
