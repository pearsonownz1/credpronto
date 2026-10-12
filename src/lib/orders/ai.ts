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

export async function generateObject<T>(
  schema: ZodType<T>,
  messages: ModelMessage[],
  signal?: AbortSignal,
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt <= AI_MAX_RETRIES; attempt += 1) {
    if (signal?.aborted) break;
    try {
      const result = await generateText({
        model: translationModelId(),
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
      console.error(`AI model ${translationModelId()} failed: ${message}${cause}`, error);
      if (signal?.aborted || attempt === AI_MAX_RETRIES) break;
    }
  }
  const message = last instanceof Error ? last.message : "The model did not respond";
  throw new AiUnavailableError(message);
}
