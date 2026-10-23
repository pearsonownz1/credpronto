import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyQaReview, postQaReviewPing, QA_WEBHOOK_TIMEOUT_MS } from "./qa-webhook";

const order = {
  id: "order-9",
  orderType: "evaluation",
  service: null,
  services: ["diploma", "course_by_course"],
  includeTranslation: false,
} as unknown as Parameters<typeof postQaReviewPing>[0];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.QA_WEBHOOK_URL;
  delete process.env.QA_WEBHOOK_KEY;
});

describe("QA paid-review webhook", () => {
  it("posts the right body and bearer header", async () => {
    process.env.QA_WEBHOOK_URL = "https://hooks.example.test/qa";
    process.env.QA_WEBHOOK_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await postQaReviewPing(order);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hooks.example.test/qa");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer test-key");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual({
      event: "order.paid_review",
      orderId: "order-9",
      orderType: "evaluation",
      services: ["diploma", "course_by_course"],
    });
    expect(QA_WEBHOOK_TIMEOUT_MS).toBe(5_000);
  });

  it("skips when either env var is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const hold = vi.fn();
    process.env.QA_WEBHOOK_URL = "https://hooks.example.test/qa";
    await postQaReviewPing(order);
    notifyQaReview(order, hold);
    delete process.env.QA_WEBHOOK_URL;
    process.env.QA_WEBHOOK_KEY = "test-key";
    await postQaReviewPing(order);
    notifyQaReview(order, hold);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(hold).not.toHaveBeenCalled();
  });

  it("swallows network errors, HTTP errors and a throwing waitUntil", async () => {
    process.env.QA_WEBHOOK_URL = "https://hooks.example.test/qa";
    process.env.QA_WEBHOOK_KEY = "test-key";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    await expect(postQaReviewPing(order)).resolves.toBeUndefined();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    await expect(postQaReviewPing(order)).resolves.toBeUndefined();
    expect(() =>
      notifyQaReview(order, () => {
        throw new Error("no request scope");
      }),
    ).not.toThrow();
    expect(warn.mock.calls.flat().join(" ")).not.toContain("test-key");
  });

  it("hands the post to waitUntil", async () => {
    process.env.QA_WEBHOOK_URL = "https://hooks.example.test/qa";
    process.env.QA_WEBHOOK_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    const hold = vi.fn();
    notifyQaReview(order, hold);
    expect(hold).toHaveBeenCalledTimes(1);
    await hold.mock.calls[0][0];
  });
});
