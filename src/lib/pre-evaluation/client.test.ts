import { describe, expect, it } from "vitest";
import {
  RATE_LIMIT_MESSAGE,
  REJECTED_FILE_MESSAGE,
  createPreEvaluation,
  getPreEvaluation,
  getPreEvaluationPrefill,
  parsePreEvaluation,
  parsePreEvaluationPrefill,
  replacementPreviewUrl,
  submitPreEvaluationEmail,
} from "./client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ready = {
  status: "ready" as const,
  equivalent: "Bachelor's degree",
  confidence: "high" as const,
  previewUrl: "https://cdn.example/preview.png?token=one",
};

describe("pre-evaluation client", () => {
  it("posts the diploma as multipart and returns the id", async () => {
    const file = new File([Uint8Array.from([1, 2, 3])], "diploma.pdf", { type: "application/pdf" });
    const seen: { body: FormData | null; headers: HeadersInit | undefined; cache: RequestCache | undefined } = {
      body: null,
      headers: undefined,
      cache: undefined,
    };
    const created = await createPreEvaluation(file, async (url, init) => {
      expect(url).toBe("/api/pre-evaluation");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBeInstanceOf(FormData);
      seen.body = init?.body instanceof FormData ? init.body : null;
      seen.headers = init?.headers;
      seen.cache = init?.cache;
      return jsonResponse({ id: "prev-1" });
    });
    expect(created).toEqual({ id: "prev-1" });
    const uploaded = seen.body?.get("file");
    expect(uploaded).toBeInstanceOf(File);
    expect(uploaded instanceof File ? uploaded.name : "").toBe("diploma.pdf");
    expect(seen.headers).toEqual({ accept: "application/json" });
    expect(JSON.stringify(seen.headers)).not.toContain("content-type");
    expect(seen.cache).toBe("no-store");
  });

  it("reads a preview and blanks results until the email step is done", async () => {
    const locked = await getPreEvaluation("prev-1", async (url, init) => {
      expect(url).toBe("/api/pre-evaluation/prev-1");
      expect(init?.method).toBe("GET");
      expect(init?.cache).toBe("no-store");
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

    expect(parsePreEvaluation({ ...ready, status: "failed", previewUrl: "https://cdn.example/secret.png" })).toEqual({
      status: "failed",
      equivalent: null,
      confidence: null,
      previewUrl: null,
    });
  });

  it("keeps the equivalent once the preview is ready", () => {
    expect(parsePreEvaluation(ready)).toEqual(ready);
  });

  it("replaces an expired signed preview once", () => {
    const fresh = "https://cdn.example/preview.png?token=two";
    expect(replacementPreviewUrl({ ...ready, previewUrl: fresh }, 1)).toBe(fresh);
    expect(replacementPreviewUrl({ ...ready, previewUrl: fresh }, 2)).toBeNull();
    expect(replacementPreviewUrl({ ...ready, status: "email_required", previewUrl: fresh }, 1)).toBeNull();
  });

  it("posts the email that unlocks the preview and requires { ok: true }", async () => {
    let sent: unknown;
    const saved = await submitPreEvaluationEmail("prev 1", " ada@example.com ", async (url, init) => {
      expect(url).toBe("/api/pre-evaluation/prev%201/email");
      expect(init?.method).toBe("POST");
      sent = JSON.parse(String(init?.body));
      expect(init?.headers).toMatchObject({ "content-type": "application/json" });
      return jsonResponse({ ok: true });
    });
    expect(sent).toEqual({ email: "ada@example.com" });
    expect(saved).toEqual({ ok: true });
    await expect(submitPreEvaluationEmail("prev-1", "ada@example.com", async () => jsonResponse({ ok: false }))).rejects.toMatchObject({
      status: 502,
    });
  });

  it("loads signup and order fields from the prefill route", async () => {
    const prefill = await getPreEvaluationPrefill("prev-1", async (url, init) => {
      expect(url).toBe("/api/pre-evaluation/prev-1/prefill");
      expect(init?.cache).toBe("no-store");
      return jsonResponse({
        email: "ada@example.com",
        orderType: "evaluation",
        service: "course_by_course",
        degreeCount: 2,
        country: "Mexico",
        credentialName: "Licenciatura en Derecho",
        equivalent: "Bachelor's degree",
        confidence: "high",
        rationale: "A free suggestion.",
        status: "ready",
        signupPath: "/sign-up?email=ada%40example.com&next=%2Ftranslate",
        orderPath: "/translate?service=course_by_course&preEvaluation=prev-1",
        resultPath: "/pre-evaluation/prev-1",
      });
    });
    expect(prefill).toMatchObject({
      email: "ada@example.com",
      service: "course_by_course",
      degreeCount: 2,
      equivalent: "Bachelor's degree",
      preEvaluationFile: null,
    });
    expect(
      parsePreEvaluationPrefill({
        ...prefill,
        preEvaluationFile: { name: " ", mimeType: "application/pdf", size: 10, pageCount: 1, kind: "diploma" },
      }).preEvaluationFile,
    ).toBeNull();
    expect(
      parsePreEvaluationPrefill({
        ...prefill,
        preEvaluationFile: {
          name: "licenciatura.pdf",
          mimeType: "application/pdf",
          size: 4096,
          pageCount: 2,
          kind: "transcript",
        },
      }).preEvaluationFile,
    ).toEqual({
      name: "licenciatura.pdf",
      mimeType: "application/pdf",
      size: 4096,
      pageCount: 2,
      kind: "transcript",
    });
    expect(
      parsePreEvaluationPrefill({
        ...prefill,
        status: "processing",
        equivalent: "Bachelor's degree",
        confidence: "high",
        country: "Mexico",
      }),
    ).toMatchObject({ status: "processing", equivalent: null, confidence: null, country: null, email: "ada@example.com" });
  });

  it("turns HTTP 429 and rejected file types into the API messages", async () => {
    const file = new File([Uint8Array.from([1])], "diploma.pdf", { type: "application/pdf" });
    await expect(
      createPreEvaluation(file, async () => jsonResponse({ error: "Daily pre-evaluation limit reached", code: "rate_limited" }, 429)),
    ).rejects.toMatchObject({ status: 429, message: "Daily pre-evaluation limit reached" });
    await expect(createPreEvaluation(file, async () => jsonResponse({}, 429))).rejects.toMatchObject({
      status: 429,
      message: RATE_LIMIT_MESSAGE,
    });
    await expect(
      createPreEvaluation(file, async () => jsonResponse({ error: "Upload a PDF, JPG, or PNG" }, 415)),
    ).rejects.toMatchObject({ status: 415, message: REJECTED_FILE_MESSAGE });
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
