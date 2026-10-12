import { afterEach, describe, expect, it, vi } from "vitest";
import { TARGET_LANGUAGE_REVIEW_MESSAGE, settleTargetLanguageUpdate } from "./present";
import { FlowApiError, getFlowClient } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("target language update", () => {
  it("patches /api/orders/[token] with the chosen target", async () => {
    const fetchSpy = vi.fn(async () => json({ orderId: "order-1", status: "quoted" }));
    vi.stubGlobal("fetch", fetchSpy);

    await getFlowClient().updateTargetLanguage("order token", "es");

    expect(fetchSpy).toHaveBeenCalledWith("/api/orders/order%20token", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetLanguage: "es" }),
    });
  });

  it("keeps the status so a missing route can show the review message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: "Not found" }, 404)),
    );

    try {
      await getFlowClient().updateTargetLanguage("tok", "es");
      expect.fail("expected the patch to fail");
    } catch (cause) {
      expect(cause).toBeInstanceOf(FlowApiError);
      if (!(cause instanceof FlowApiError)) return;
      expect(cause.status).toBe(404);
      expect(cause.message).toBe("Not found");
      expect(settleTargetLanguageUpdate({ status: cause.status, message: cause.message })).toEqual({
        refetch: false,
        message: TARGET_LANGUAGE_REVIEW_MESSAGE,
      });
    }
  });
});
