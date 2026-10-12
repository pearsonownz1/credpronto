import { generateText, Output, type ModelMessage } from "ai";
import type { ZodType } from "zod";
import { DEFAULT_TRANSLATION_MODEL } from "./constants";
import { AiUnavailableError } from "./errors";

/** Each model attempt gets its own deadline. The SDK default shares one timeout across retries. */
export const AI_ATTEMPT_TIMEOUT_MS = 150_000;
/** Retries after the first attempt. Three calls at most. */
export const AI_MAX_RETRIES = 2;

export function translationModelId(): string {
  const configured = process.env.TRANSLATION_MODEL?.trim();
  return configured || DEFAULT_TRANSLATION_MODEL;
}

function attemptSignal(parent: AbortSignal | undefined): AbortSignal {
  const attempt = AbortSignal.timeout(AI_ATTEMPT_TIMEOUT_MS);
  return parent ? AbortSignal.any([parent, attempt]) : attempt;
}

export function translationFallbackModelId(): string | null {
  const configured = process.env.TRANSLATION_FALLBACK_MODEL?.trim();
  return configured || null;
}

export async function generateObject<T>(
  schema: ZodType<T>,
  messages: ModelMessage[],
  signal?: AbortSignal,
  options?: { maxRetries?: number; model?: string },
): Promise<T> {
  const maxRetries = options?.maxRetries ?? AI_MAX_RETRIES;
  const model = options?.model?.trim() || translationModelId();
  let last: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (signal?.aborted) break;
    try {
      const result = await generateText({
        model,
        output: Output.object({ schema }),
        messages,
        maxOutputTokens: 16000,
        maxRetries: 0,
        abortSignal: attemptSignal(signal),
      });
      return result.output;
    } catch (error) {
      last = error;
      const message = error instanceof Error ? error.message : "The model did not respond";
      const cause =
        error instanceof Error && error.cause instanceof Error ? ` (cause: ${error.cause.message})` : "";
      console.error(`AI model ${model} failed: ${message}${cause}`, error);
      if (signal?.aborted || attempt === maxRetries) break;
    }
  }
  const message = last instanceof Error ? last.message : "The model did not respond";
  throw new AiUnavailableError(message);
}
