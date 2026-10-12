import { generateText, Output, type ModelMessage } from "ai";
import type { ZodType } from "zod";
import { DEFAULT_TRANSLATION_MODEL } from "./constants";
import { AiUnavailableError } from "./errors";

export function translationModelId(): string {
  const configured = process.env.TRANSLATION_MODEL?.trim();
  return configured || DEFAULT_TRANSLATION_MODEL;
}

export async function generateObject<T>(
  schema: ZodType<T>,
  messages: ModelMessage[],
): Promise<T> {
  try {
    const result = await generateText({
      model: translationModelId(),
      output: Output.object({ schema }),
      messages,
      maxOutputTokens: 16000,
      timeout: 90_000,
    });
    return result.output;
  } catch (error) {
    const message = error instanceof Error ? error.message : "The model did not respond";
    throw new AiUnavailableError(message);
  }
}
