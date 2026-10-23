import { describe, expect, it } from "vitest";
import {
  RATE_LIMIT_MESSAGE,
  createPreEvaluation,
  getPreEvaluation,
  parsePreEvaluation,
  submitPreEvaluationEmail,
} from "./client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("pre-evaluation client", () => {
  it("posts the diploma as multipart and returns the id", async () => {
    const file = new File([Uint8Array.from([1, 2, 3])], "diploma.pdf", { type: "application/pdf" });
    const seen: { body: FormData | null; headers: HeadersInit | undefined } = { body: null, headers: undefined };
    const created = await createPreEvaluation(file, async (url, init) => {
      expect(url).toBe("/api/pre-evaluation");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBeInstanceOf(FormData);
      seen.body = init?.body instanceof FormData ? init.body : null;
      seen.headers = init?.headers;
      return jsonResponse({ id: "prev-1" });
    });
    expect(created).toEqual({ id: "prev-1" });
    const uploaded = seen.body?.get("file");
    expect(uploaded).toBeInstanceOf(File);
    expect(uploaded instanceof File ? uploaded.name : "").toBe("diploma.pdf");
    expect(seen.headers).toEqual({ accept: "application/json" });
    expect(JSON.stringify(seen.headers)).not.toContain("content-type");
  });

  it("reads a preview and blanks results until the email step is done", async () => {
    const locked = await getPreEvaluation("prev-1", async (url, init) => {
      expect(url).toBe("/api/pre-evaluation/prev-1");
      expect(init?.method).toBe("GET");
      return jsonResponse({
        status: "email_required",
        equivalent: "Bachelor's degree",
        confidence: "high",
        previewUrl: "https://cdn.example/secret.png",
      });
    });
    expect(locked).toEqual({
      status: "email_required",
      equivalent: null,
      confidence: null,
      previewUrl: null,
    });

    expect(
      parsePreEvaluation({
        status: "processing",
        equivalent: "Bachelor's degree",
        confidence: "high",
        previewUrl: "https://cdn.example/secret.png",
      }),
    ).toEqual({ status: "processing", equivalent: null, confidence: null, previewUrl: null });
  });

  it("keeps the equivalent once the preview is done", () => {
    expect(
      parsePreEvaluation({
        status: "done",
        equivalent: "Bachelor's degree",
        confidence: "medium",
        previewUrl: "https://cdn.example/preview.png",
      }),
    ).toEqual({
      status: "done",
      equivalent: "Bachelor's degree",
      confidence: "medium",
      previewUrl: "https://cdn.example/preview.png",
    });
  });

  it("posts the email that unlocks the preview", async () => {
    let sent: unknown;
    await submitPreEvaluationEmail("prev 1", " ada@example.com ", async (url, init) => {
      expect(url).toBe("/api/pre-evaluation/prev%201/email");
      expect(init?.method).toBe("POST");
      sent = JSON.parse(String(init?.body));
      expect(init?.headers).toMatchObject({ "content-type": "application/json" });
      return jsonResponse({ ok: true });
    });
    expect(sent).toEqual({ email: "ada@example.com" });
  });

  it("turns HTTP 429 into the rate-limit message", async () => {
    const file = new File([Uint8Array.from([1])], "diploma.pdf", { type: "application/pdf" });
    await expect(
      createPreEvaluation(file, async () => jsonResponse({ error: "slow down" }, 429)),
    ).rejects.toMatchObject({ status: 429, message: RATE_LIMIT_MESSAGE });
  });

  it("reports a network failure without a response", async () => {
    const file = new File([Uint8Array.from([1])], "diploma.pdf", { type: "application/pdf" });
    await expect(
      createPreEvaluation(file, async () => {
        throw new Error("offline");
      }),
    ).rejects.toMatchObject({ status: 503 });
  });
});
