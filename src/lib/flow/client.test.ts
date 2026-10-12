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

describe("source file URL", () => {
  it("requests the signed original for a quote thumbnail", async () => {
    const fetchSpy = vi.fn(async () =>
      json({ url: "https://files.example/a.pdf", expiresAt: "2026-10-12T00:10:00.000Z" }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(getFlowClient().sourceFile("order token", "file/1")).resolves.toEqual({
      url: "https://files.example/a.pdf",
      expiresAt: "2026-10-12T00:10:00.000Z",
    });
    expect(fetchSpy).toHaveBeenCalledWith("/api/orders/order%20token/files/file%2F1/source", undefined);
  });
});

describe("order upload", () => {
  it("reports computable XHR upload progress", async () => {
    const progress: number[] = [];
    const sent: { body: FormData | null } = { body: null };

    class FakeXHR {
      upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
      status = 201;
      responseText = JSON.stringify({ orderToken: "tok", orderId: "ord_1" });
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      open() {}
      send(body: FormData) {
        sent.body = body;
        this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent);
        this.onload?.();
      }
    }

    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const file = new File(["hello"], "notes.pdf", { type: "application/pdf" });
    const result = await getFlowClient().upload({
      email: "a@credpronto.com",
      files: [file],
      onProgress: (ratio) => progress.push(ratio),
    });

    expect(result).toEqual({ orderToken: "tok", orderId: "ord_1" });
    expect(progress).toEqual([0.5]);
    expect(sent.body?.get("email")).toBe("a@credpronto.com");
    expect(sent.body?.get("files")).toBeInstanceOf(File);
  });

  it("leaves progress alone when the browser cannot report a total", async () => {
    const progress: number[] = [];

    class FakeXHR {
      upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
      status = 200;
      responseText = JSON.stringify({ orderToken: "tok", orderId: "ord_1" });
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      open() {}
      send() {
        this.upload.onprogress?.({ lengthComputable: false, loaded: 5, total: 0 } as ProgressEvent);
        this.onload?.();
      }
    }

    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    await getFlowClient().upload({
      email: "a@credpronto.com",
      files: [new File(["hello"], "notes.pdf", { type: "application/pdf" })],
      onProgress: (ratio) => progress.push(ratio),
    });
    expect(progress).toEqual([]);
  });
});

describe("quote update", () => {
  it("patches target language and translation choice without skipPages", async () => {
    const fetchSpy = vi.fn(async () => json({ orderId: "order-1", status: "quoted" }));
    vi.stubGlobal("fetch", fetchSpy);

    await getFlowClient().updateQuote("order token", {
      targetLanguage: "en",
      includeTranslation: true,
    });

    const body = JSON.stringify({ targetLanguage: "en", includeTranslation: true });
    expect(fetchSpy).toHaveBeenCalledWith("/api/orders/order%20token", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(body).not.toContain("skipPages");
  });
});

describe("mock checkout add-ons", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("rejects expedited on translation and evaluation checkout", async () => {
    vi.stubEnv("NEXT_PUBLIC_FLOW_MOCK", "1");
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    });
    vi.stubGlobal("window", { dispatchEvent: () => true });
    await expect(getFlowClient().checkout("tok", { addons: ["expedited"] })).rejects.toMatchObject({
      status: 400,
      message: "Expedited is no longer offered",
    });

    const client = getFlowClient();
    await client.upload({
      email: "ada@example.com",
      files: [],
      choice: { orderType: "evaluation", service: "diploma", degreeCount: 1, includeTranslation: false },
    });
    await expect(client.checkout("tok", { addons: ["notarization", "expedited"] })).rejects.toMatchObject({
      status: 400,
      message: "Expedited is no longer offered",
    });
    const paid = await client.checkout("tok", { addons: ["notarization"] });
    expect(paid).toMatchObject({ sessionId: "cs_mock" });
    const diploma = await client.getOrder("tok");
    expect(diploma.addons).toEqual(["notarization"]);
    expect(diploma.addonOptions.map((option) => option.id)).not.toContain("expedited");
    expect(diploma.totalCents).toBe(1995);
  });
});

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
