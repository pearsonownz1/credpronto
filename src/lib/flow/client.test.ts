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

describe("order polling fetch", () => {
  it("loads the order with a no-store GET so a poll cannot reuse the first body", async () => {
    const fetchSpy = vi.fn(async () => json({ orderId: "order-1", status: "draft" }));
    vi.stubGlobal("fetch", fetchSpy);

    await getFlowClient().getOrder("order token");

    expect(fetchSpy).toHaveBeenCalledWith("/api/orders/order%20token", {
      cache: "no-store",
      signal: undefined,
    });
  });
});

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
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const notesPath = `${sessionId}/22222222-2222-4222-8222-222222222222/notes.pdf`;
  const photoPath = `${sessionId}/33333333-3333-4333-8333-333333333333/photo.jpg`;

  function stubUpload(options?: { orderStatus?: number; orderBody?: unknown; xhrStatus?: number; xhrBody?: string }) {
    const requests: Array<{ url: string; body: unknown }> = [];
    const puts: string[] = [];
    class FakeXHR {
      upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
      status = options?.xhrStatus ?? 200;
      statusText = "";
      responseText = options?.xhrBody ?? "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      open(_method: string, url: string) {
        puts.push(url);
      }
      setRequestHeader() {}
      send() {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent);
        this.onload?.();
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null;
        requests.push({ url, body });
        if (url === "/api/uploads") {
          const files = (body as { files: Array<{ name: string; size: number; type: string }> }).files;
          return json({
            sessionId,
            uploads: files.map((file, index) => ({
              path: index === 0 ? notesPath : photoPath,
              token: "tok",
              signedUrl: `https://files.example/upload/${index}?token=tok`,
              filename: file.name,
              mime: file.type,
              size: file.size,
            })),
          });
        }
        return json(options?.orderBody ?? { orderToken: "tok", orderId: "ord_1" }, options?.orderStatus ?? 200);
      }),
    );
    return { requests, puts };
  }

  it("uploads each file to storage and posts only the object keys", async () => {
    const progress: number[] = [];
    const fileProgress: Array<Array<{ name: string; ratio: number }>> = [];
    const { requests, puts } = stubUpload();
    const notes = new File(["hello-bytes"], "notes.pdf", { type: "application/pdf" });
    const photo = new File(["pixel-bytes"], "photo.jpg", { type: "image/jpeg" });
    const result = await getFlowClient().upload({
      email: "a@credpronto.com",
      files: [notes, photo],
      choice: { orderType: "evaluation", service: "diploma", degreeCount: 1, includeTranslation: true },
      onProgress: (ratio) => progress.push(ratio),
      onFileProgress: (files) => fileProgress.push(files.map((file) => ({ ...file }))),
    });

    expect(result).toEqual({ orderToken: "tok", orderId: "ord_1" });
    expect(puts).toEqual([
      "https://files.example/upload/0?token=tok",
      "https://files.example/upload/1?token=tok",
    ]);
    expect(requests[0]?.url).toBe("/api/uploads");
    expect(requests[0]?.body).toMatchObject({
      files: [
        { name: "notes.pdf", type: "application/pdf" },
        { name: "photo.jpg", type: "image/jpeg" },
      ],
    });
    const order = requests[1];
    expect(order?.url).toBe("/api/orders");
    expect(JSON.stringify(order?.body)).not.toContain("hello-bytes");
    expect(JSON.stringify(order?.body)).not.toContain("pixel-bytes");
    expect(order?.body).toMatchObject({
      email: "a@credpronto.com",
      sessionId,
      orderType: "evaluation",
      service: "diploma",
      degreeCount: "1",
      includeTranslation: true,
      services: ["translation", "diploma"],
      files: [
        { path: notesPath, filename: "notes.pdf" },
        { path: photoPath, filename: "photo.jpg" },
      ],
    });
    expect(fileProgress.some((list) => list[0]?.ratio === 0.5 && list[1]?.ratio === 0)).toBe(true);
    expect(fileProgress.at(-1)).toEqual([
      { name: "notes.pdf", ratio: 1 },
      { name: "photo.jpg", ratio: 1 },
    ]);
    expect(progress.at(-1)).toBe(1);
  });

  it("leaves email off the order request when the quote form does not send one", async () => {
    const { requests } = stubUpload();
    await getFlowClient().upload({
      files: [new File(["hello"], "notes.pdf", { type: "application/pdf" })],
    });
    const order = requests.find((request) => request.url === "/api/orders");
    expect(order?.body).toMatchObject({ sessionId });
    expect(order?.body).not.toHaveProperty("email");
  });

  it("does not invent a ratio when the browser cannot report a total", async () => {
    const fileProgress: Array<Array<{ name: string; ratio: number }>> = [];
    class FakeXHR {
      upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
      status = 200;
      statusText = "";
      responseText = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      open() {}
      setRequestHeader() {}
      send() {
        this.upload.onprogress?.({ lengthComputable: false, loaded: 5, total: 0 } as ProgressEvent);
        this.onload?.();
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/uploads") {
          return json({
            sessionId,
            uploads: [
              {
                path: notesPath,
                token: "tok",
                signedUrl: "https://files.example/upload?token=tok",
                filename: "notes.pdf",
                mime: "application/pdf",
                size: 5,
              },
            ],
          });
        }
        return json({ orderToken: "tok", orderId: "ord_1" });
      }),
    );
    await getFlowClient().upload({
      email: "a@credpronto.com",
      files: [new File(["hello"], "notes.pdf", { type: "application/pdf" })],
      onFileProgress: (files) => fileProgress.push(files.map((file) => ({ ...file }))),
    });
    expect(fileProgress.some((list) => list[0]?.ratio === 0)).toBe(true);
    expect(fileProgress.some((list) => list[0]?.ratio > 0 && list[0]?.ratio < 1)).toBe(false);
    expect(fileProgress.at(-1)?.[0]?.ratio).toBe(1);
  });

  it("shows the storage error instead of Request failed", async () => {
    stubUpload({
      xhrStatus: 413,
      xhrBody: JSON.stringify({ message: "The object exceeded the maximum allowed size" }),
    });
    await expect(
      getFlowClient().upload({
        email: "a@credpronto.com",
        files: [new File(["hello"], "notes.pdf", { type: "application/pdf" })],
      }),
    ).rejects.toThrow("notes.pdf: The object exceeded the maximum allowed size");
  });

  it("surfaces a nested payload error from the order request", async () => {
    stubUpload({
      orderStatus: 413,
      orderBody: { error: { code: "FUNCTION_PAYLOAD_TOO_LARGE", message: "Request Entity Too Large" } },
    });
    await expect(
      getFlowClient().upload({
        email: "a@credpronto.com",
        files: [new File(["hello"], "notes.pdf", { type: "application/pdf" })],
      }),
    ).rejects.toThrow("Request Entity Too Large");
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
