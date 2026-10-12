import { generateText, NoObjectGeneratedError } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { generateObject } from "./ai";
import { isTemporaryTranslationError, isUnreadableModelOutput } from "./translation-failure";

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return { ...actual, generateText: vi.fn() };
});

const schema = z.object({ pageNumber: z.number() });

describe("generateObject token cutoff", () => {
  beforeEach(() => {
    vi.mocked(generateText).mockReset();
  });

  it("names a length cutoff so a truncated page can be retried", async () => {
    vi.mocked(generateText).mockRejectedValue(
      new NoObjectGeneratedError({
        message: "No object generated: could not parse the response.",
        cause: new Error("JSON parsing failed: Text: {\"blocks\":["),
        text: "{\"blocks\":[",
        response: { id: "test", timestamp: new Date(), modelId: "google/gemini-3.8-flash" },
        usage: {
          inputTokens: 10,
          outputTokens: 16_000,
          totalTokens: 16_010,
          inputTokenDetails: { noCacheTokens: 10, cacheReadTokens: undefined, cacheWriteTokens: undefined },
          outputTokenDetails: { textTokens: 200, reasoningTokens: 15_800 },
        },
        finishReason: "length",
      }),
    );

    const error = await generateObject(schema, [], undefined, { maxRetries: 0 }).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("finishReason=length");
    expect(isUnreadableModelOutput(error)).toBe(true);
    expect(isTemporaryTranslationError(error)).toBe(true);
    expect(vi.mocked(generateText).mock.calls[0]?.[0]).toMatchObject({ maxOutputTokens: 16_000 });
  });

  it("treats a finished object whose finishReason is length as truncated JSON", async () => {
    vi.mocked(generateText).mockResolvedValue({
      output: { pageNumber: 1 },
      finishReason: "length",
    } as Awaited<ReturnType<typeof generateText>>);

    await expect(generateObject(schema, [], undefined, { maxRetries: 0, maxOutputTokens: 65_536, reasoning: "low" })).rejects.toThrow(
      /finishReason=length/,
    );
    expect(vi.mocked(generateText).mock.calls[0]?.[0]).toMatchObject({
      maxOutputTokens: 65_536,
      reasoning: "low",
    });
  });
});
