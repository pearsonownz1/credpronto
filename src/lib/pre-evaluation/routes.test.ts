import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isOrderId, isOrderToken } from "@/lib/orders/token";
import { PRE_EVAL_DAILY_UPLOADS } from "./constants";
import { preEvalIpHash, resetPreEvalBursts } from "./rate-limit";

const send = vi.hoisted(() =>
  vi.fn(async (to: string, input: { equivalent: string; resultUrl: string; officialUrl: string }) => ({
    sent: Boolean(to && input.equivalent),
    skipped: false,
  })),
);
const memory = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  pending: [] as Promise<unknown>[],
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: (task: () => Promise<void>) => {
      memory.pending.push(Promise.resolve().then(task));
    },
  };
});

vi.mock("@/lib/orders/storage", () => ({
  serviceDb: () => ({ kind: "db" }),
  uploadObject: vi.fn(async () => undefined),
  downloadObject: vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])),
}));

vi.mock("@/lib/orders/pdf-text", () => ({
  pdfPageTexts: vi.fn(async () => ["Licenciatura en Derecho, Mexico"]),
}));

vi.mock("@/lib/orders/evaluation", () => ({
  extractPrintedCredentials: vi.fn(async () => [
    { kind: "diploma", country: "Mexico", credential: "Licenciatura en Derecho" },
  ]),
}));

vi.mock("@/lib/orders/email", () => ({
  appOrigin: () => "https://credpronto.test",
  sendPreEvaluationResult: send,
}));

vi.mock("./suggest", () => ({
  suggestPrintedCredentials: vi.fn(async () => ({
    country: "Mexico",
    credentialName: "Licenciatura en Derecho",
    equivalent: "Bachelor's degree",
    confidence: "high",
    rationale:
      "The printed Licenciatura en Derecho from Mexico matches a known credential. This is a free suggestion, not an official evaluation.",
    documentKind: "diploma",
    degreeCount: 1,
    edgeCredentialId: "cred-1",
    edgeMatchMethod: "base",
  })),
}));

vi.mock("./db", () => ({
  countPreEvaluationsByIp: async (_db: unknown, ipHash: string, since: string) =>
    memory.rows.filter((row) => row.ipHash === ipHash && String(row.createdAt) >= since).length,
  countPreEvaluationEmailsByIp: async (_db: unknown, ipHash: string, since: string) =>
    memory.rows.filter(
      (row) => row.ipHash === ipHash && typeof row.emailSubmittedAt === "string" && row.emailSubmittedAt >= since,
    ).length,
  insertPreEvaluation: async (_db: unknown, input: Record<string, unknown>) => {
    memory.rows.push({
      ...input,
      status: "processing",
      country: null,
      credentialName: null,
      usEquivalency: null,
      confidence: null,
      rationale: null,
      documentKind: null,
      degreeCount: 1,
      edgeCredentialId: null,
      edgeMatchMethod: null,
      email: null,
      emailSubmittedAt: null,
      resultEmailSentAt: null,
      suggestionStartedAt: null,
      createdAt: new Date().toISOString(),
    });
  },
  preEvaluationByTokenHash: async (_db: unknown, tokenHash: string) =>
    memory.rows.find((row) => row.tokenHash === tokenHash) ?? null,
  preEvaluationById: async (_db: unknown, id: string) => memory.rows.find((row) => row.id === id) ?? null,
  claimPreEvaluation: async (_db: unknown, id: string) => {
    const row = memory.rows.find((item) => item.id === id);
    if (!row || row.status !== "processing" || row.suggestionStartedAt) return null;
    row.suggestionStartedAt = new Date().toISOString();
    return row;
  },
  finishPreEvaluation: async (_db: unknown, id: string, suggestion: Record<string, unknown>) => {
    const row = memory.rows.find((item) => item.id === id && item.status === "processing");
    if (!row) return;
    row.status = "ready";
    row.country = suggestion.country;
    row.credentialName = suggestion.credentialName;
    row.usEquivalency = suggestion.equivalent;
    row.confidence = suggestion.confidence;
    row.rationale = suggestion.rationale;
    row.documentKind = suggestion.documentKind;
    row.degreeCount = suggestion.degreeCount;
    row.edgeCredentialId = suggestion.edgeCredentialId;
    row.edgeMatchMethod = suggestion.edgeMatchMethod;
  },
  failPreEvaluation: async (_db: unknown, id: string) => {
    const row = memory.rows.find((item) => item.id === id && item.status === "processing");
    if (row) row.status = "failed";
  },
  savePreEvaluationEmail: async (_db: unknown, tokenHash: string, email: string, nowIso: string) => {
    const row = memory.rows.find((item) => item.tokenHash === tokenHash);
    if (!row) return "missing";
    if (row.email) return "taken";
    row.email = email;
    row.emailSubmittedAt = nowIso;
    return "saved";
  },
  claimResultEmail: async (_db: unknown, id: string, nowIso: string) => {
    const row = memory.rows.find((item) => item.id === id);
    if (!row || row.status !== "ready" || !row.email || row.resultEmailSentAt) return false;
    row.resultEmailSentAt = nowIso;
    return true;
  },
  clearResultEmailClaim: async (_db: unknown, id: string, nowIso: string) => {
    const row = memory.rows.find((item) => item.id === id && item.resultEmailSentAt === nowIso);
    if (row) row.resultEmailSentAt = null;
  },
}));

import { extractPrintedCredentials } from "@/lib/orders/evaluation";
import { POST as upload } from "@/app/api/pre-evaluation/route";
import { GET as readResult } from "@/app/api/pre-evaluation/[id]/route";
import { POST as submitEmail } from "@/app/api/pre-evaluation/[id]/email/route";
import { GET as readPreview } from "@/app/api/pre-evaluation/[id]/preview/route";
import { GET as readPrefill } from "@/app/api/pre-evaluation/[id]/prefill/route";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);

function uploadRequest(ip = "203.0.113.20", bytes: Uint8Array = PDF, name = "credential.pdf", type = "application/pdf") {
  const form = new FormData();
  form.set("file", new File([Buffer.from(bytes)], name, { type }));
  return new Request("https://credpronto.test/api/pre-evaluation", {
    method: "POST",
    body: form,
    headers: { "x-forwarded-for": ip },
  });
}

async function settle(): Promise<void> {
  while (memory.pending.length > 0) {
    const batch = memory.pending.splice(0, memory.pending.length);
    await Promise.all(batch);
  }
}

beforeEach(() => {
  memory.rows.length = 0;
  memory.pending.length = 0;
  send.mockClear();
  send.mockResolvedValue({ sent: true, skipped: false });
  vi.mocked(extractPrintedCredentials).mockResolvedValue([
    { kind: "diploma", country: "Mexico", credential: "Licenciatura en Derecho" },
  ]);
  resetPreEvalBursts();
});

afterEach(() => {
  resetPreEvalBursts();
});

describe("pre-evaluation HTTP contract", () => {
  it("hides the suggestion until the lead email, then returns it and mails the preview", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const created = await upload(uploadRequest());
    await settle();
    expect(created.status).toBe(200);
    const body = await created.json();
    expect(Object.keys(body)).toEqual(["id"]);
    const id = body.id as string;
    expect(isOrderToken(id)).toBe(true);
    expect(isOrderId(id)).toBe(false);

    const hidden = await readResult(new Request("https://credpronto.test/api/pre-evaluation/" + id, { headers: { "x-forwarded-for": "203.0.113.20" } }), {
      params: Promise.resolve({ id }),
    });
    expect(hidden.headers.get("cache-control")).toBe("private, no-store");
    expect(await hidden.json()).toEqual({
      status: "email_required",
      equivalent: null,
      confidence: null,
      previewUrl: null,
    });

    const lockedPreview = await readPreview(
      new Request("https://credpronto.test/api/pre-evaluation/" + id + "/preview", { headers: { "x-forwarded-for": "203.0.113.20" } }),
      { params: Promise.resolve({ id }) },
    );
    expect(lockedPreview.status).toBe(404);

    const lockedPrefill = await readPrefill(
      new Request("https://credpronto.test/api/pre-evaluation/" + id + "/prefill", { headers: { "x-forwarded-for": "203.0.113.20" } }),
      { params: Promise.resolve({ id }) },
    );
    expect(lockedPrefill.status).toBe(409);
    const lockedBody = await lockedPrefill.json();
    expect(lockedBody).toMatchObject({ code: "email_required" });
    expect(JSON.stringify(lockedBody)).not.toContain("Bachelor");

    const emailed = await submitEmail(
      new Request("https://credpronto.test/api/pre-evaluation/" + id + "/email", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.21" },
        body: JSON.stringify({ email: " Ada@Example.com " }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(emailed.status).toBe(200);
    expect(await emailed.json()).toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(1);
    const mailed = send.mock.calls[0]?.[1];
    if (!mailed) throw new Error("missing result email");
    expect(mailed.equivalent).toBe("Bachelor's degree");
    expect(mailed.resultUrl).toBe(`https://credpronto.test/pre-evaluation/${id}`);
    expect(mailed.officialUrl).toContain("email=Ada%40Example.com");
    expect(mailed.officialUrl).toContain("preEvaluation");
    expect(errors.mock.calls.flat().join(" ")).not.toContain("Ada@Example.com");
    expect(errors.mock.calls.flat().join(" ")).not.toContain(id);

    const shown = await readResult(
      new Request("https://credpronto.test/api/pre-evaluation/" + id, { headers: { "x-forwarded-for": "203.0.113.22" } }),
      { params: Promise.resolve({ id }) },
    );
    expect(await shown.json()).toEqual({
      status: "ready",
      equivalent: "Bachelor's degree",
      confidence: "high",
      previewUrl: `https://credpronto.test/api/pre-evaluation/${encodeURIComponent(id)}/preview`,
    });
    expect(send).toHaveBeenCalledTimes(1);

    const preview = await readPreview(
      new Request("https://credpronto.test/api/pre-evaluation/" + id + "/preview", { headers: { "x-forwarded-for": "203.0.113.22" } }),
      { params: Promise.resolve({ id }) },
    );
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toBe("application/pdf");
    expect(preview.headers.get("content-disposition")).toBe('inline; filename="document.pdf"');
    expect(preview.headers.get("x-robots-tag")).toContain("noindex");

    const prefill = await readPrefill(
      new Request("https://credpronto.test/api/pre-evaluation/" + id + "/prefill", { headers: { "x-forwarded-for": "203.0.113.22" } }),
      { params: Promise.resolve({ id }) },
    );
    const prefillBody = await prefill.json();
    expect(prefillBody).toMatchObject({
      email: "Ada@Example.com",
      orderType: "evaluation",
      service: "diploma",
      equivalent: "Bachelor's degree",
      confidence: "high",
    });
    expect(JSON.stringify(prefillBody)).not.toContain("cred-1");

    const conflict = await submitEmail(
      new Request("https://credpronto.test/api/pre-evaluation/" + id + "/email", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.23" },
        body: JSON.stringify({ email: "other@example.com" }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(conflict.status).toBe(409);
    errors.mockRestore();
  });

  it("rejects a non-upload, a bad type, a bad email, and the daily cap", async () => {
    const text = await upload(
      new Request("https://credpronto.test/api/pre-evaluation", {
        method: "POST",
        headers: { "content-type": "text/plain", "x-forwarded-for": "203.0.113.30" },
        body: "hello",
      }),
    );
    expect(text.status).toBe(400);

    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    const wrong = await upload(uploadRequest("203.0.113.31", gif, "anim.gif", "image/gif"));
    expect(wrong.status).toBe(415);

    const created = await upload(uploadRequest("203.0.113.32"));
    await settle();
    const { id } = await created.json();
    const badEmail = await submitEmail(
      new Request("https://credpronto.test/api/pre-evaluation/" + id + "/email", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.32" },
        body: JSON.stringify({ email: "not-an-email" }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(badEmail.status).toBe(400);
    expect(send).not.toHaveBeenCalled();

    const hash = preEvalIpHash("203.0.113.40");
    for (let index = 0; index < PRE_EVAL_DAILY_UPLOADS; index += 1) {
      memory.rows.push({ ipHash: hash, createdAt: new Date().toISOString() });
    }
    const limited = await upload(uploadRequest("203.0.113.40"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    const limitedBody = await limited.json();
    expect(limitedBody.code).toBe("rate_limited");
  });

  it("returns a failed read with no suggestion after the email, and does not log the document error", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(extractPrintedCredentials).mockRejectedValueOnce(new Error("unreadable Ada Lovelace"));
    const created = await upload(uploadRequest("203.0.113.60"));
    await settle();
    const { id } = (await created.json()) as { id: string };
    const emailed = await submitEmail(
      new Request("https://credpronto.test/api/pre-evaluation/" + id + "/email", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.60" },
        body: JSON.stringify({ email: "ada@example.com" }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(emailed.status).toBe(200);
    const shown = await readResult(
      new Request("https://credpronto.test/api/pre-evaluation/" + id, { headers: { "x-forwarded-for": "203.0.113.61" } }),
      { params: Promise.resolve({ id }) },
    );
    expect(await shown.json()).toEqual({
      status: "failed",
      equivalent: null,
      confidence: null,
      previewUrl: null,
    });
    expect(send).not.toHaveBeenCalled();
    expect(errors.mock.calls.flat().join(" ")).not.toContain("Ada Lovelace");
    expect(errors.mock.calls.flat().join(" ")).not.toContain("ada@example.com");
    errors.mockRestore();
  });
});
