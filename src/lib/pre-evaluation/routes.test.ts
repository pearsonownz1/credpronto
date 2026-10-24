import { extractText, getDocumentProxy } from "unpdf";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isOrderId, isOrderToken } from "@/lib/orders/token";
import { PRE_EVAL_BURST, PRE_EVAL_DAILY_UPLOADS, type PreEvalBurstKind } from "./constants";
import { preEvalIpHash } from "./rate-limit";

const send = vi.hoisted(() =>
  vi.fn(
    async (
      to: string,
      input: {
        equivalent: string;
        resultUrl: string;
        officialUrl: string;
        attachment?: { filename: string; content: Uint8Array; contentType: string };
      },
    ) => ({
      sent: Boolean(to && input.equivalent && input.attachment?.content.byteLength),
      skipped: false,
    }),
  ),
);
const memory = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  pending: [] as Promise<unknown>[],
  objects: new Map<string, Uint8Array>(),
  downloads: [] as string[],
  signs: [] as Array<{ bucket: string; path: string; expiresIn: number }>,
  windows: new Map<string, number>(),
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
  uploadObject: vi.fn(async (_db: unknown, _bucket: unknown, path: string, bytes: Uint8Array) => {
    memory.objects.set(path, Uint8Array.from(bytes));
  }),
  downloadObject: vi.fn(async (_db: unknown, _bucket: unknown, path: string) => {
    memory.downloads.push(path);
    const found = memory.objects.get(path);
    if (!found) throw new Error("missing object");
    return found;
  }),
  signedObjectUrl: vi.fn(async (_db: unknown, bucket: string, path: string, expiresIn: number) => {
    memory.signs.push({ bucket, path, expiresIn });
    return `https://files.example/sign/${bucket}?token=signed&path=${encodeURIComponent(path)}&expires=${expiresIn}`;
  }),
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
  consumePreEvalWindow: async (_db: unknown, subjectHash: string, kind: PreEvalBurstKind, nowMs: number) => {
    const rule = PRE_EVAL_BURST[kind];
    const start = Math.floor(nowMs / rule.windowMs) * rule.windowMs;
    const key = `${kind}:${subjectHash}:${start}`;
    const count = memory.windows.get(key) ?? 0;
    if (count >= rule.max) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((start + rule.windowMs - nowMs) / 1000)) };
    }
    memory.windows.set(key, count + 1);
    return { allowed: true, retryAfterSeconds: 0 };
  },
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
      previewPath: null,
      previewMime: null,
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
  finishPreEvaluation: async (
    _db: unknown,
    id: string,
    suggestion: Record<string, unknown>,
    _now: string,
    preview: { path: string; mime: string },
  ) => {
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
    row.previewPath = preview.path;
    row.previewMime = preview.mime;
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

let samplePdf = new Uint8Array();

function uploadRequest(ip = "203.0.113.20", bytes = samplePdf, name = "credential.pdf", type = "application/pdf") {
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

async function pdfText(bytes: Uint8Array): Promise<string> {
  const proxy = await getDocumentProxy(bytes.slice());
  const extracted = await extractText(proxy, { mergePages: true });
  return Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
}

beforeEach(async () => {
  memory.rows.length = 0;
  memory.pending.length = 0;
  memory.objects.clear();
  memory.downloads.length = 0;
  memory.signs.length = 0;
  memory.windows.clear();
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("ORIGINAL-ONLY", { x: 72, y: 720, size: 18, font });
  samplePdf = new Uint8Array(await doc.save());
  send.mockClear();
  send.mockResolvedValue({ sent: true, skipped: false });
  vi.mocked(extractPrintedCredentials).mockResolvedValue([
    { kind: "diploma", country: "Mexico", credential: "Licenciatura en Derecho" },
  ]);
});

afterEach(async () => {
  await settle();
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
    const hiddenBody = await hidden.json();
    expect(hiddenBody).toEqual({
      status: "email_required",
      equivalent: null,
      confidence: null,
      previewUrl: null,
      kind: "diploma",
    });
    expect(Object.keys(hiddenBody).sort()).toEqual(["confidence", "equivalent", "kind", "previewUrl", "status"]);
    expect(JSON.stringify(hiddenBody)).not.toContain("credential.pdf");
    expect(JSON.stringify(hiddenBody)).not.toContain("pageCount");
    expect(memory.signs).toHaveLength(0);

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
    if (!mailed?.attachment) throw new Error("missing result email");
    expect(mailed.equivalent).toBe("Bachelor's degree");
    expect(mailed.resultUrl).toBe(`https://credpronto.test/pre-evaluation/${id}`);
    expect(mailed.officialUrl).toContain("email=Ada%40Example.com");
    expect(mailed.officialUrl).toContain("preEvaluation");
    expect(mailed.attachment.filename).toBe("preview.pdf");
    expect(mailed.attachment.contentType).toBe("application/pdf");
    const row = memory.rows.find((item) => item.accessToken === id);
    const storedOriginal = memory.objects.get(String(row?.storagePath));
    const storedPreview = memory.objects.get(String(row?.previewPath));
    if (!storedOriginal || !storedPreview) throw new Error("missing stored files");
    expect(Buffer.compare(Buffer.from(mailed.attachment.content), Buffer.from(storedOriginal))).not.toBe(0);
    expect(Buffer.compare(Buffer.from(mailed.attachment.content), Buffer.from(storedPreview))).toBe(0);
    expect(Buffer.compare(Buffer.from(mailed.attachment.content), Buffer.from(samplePdf))).not.toBe(0);
    expect(await pdfText(mailed.attachment.content)).toContain("PREVIEW");
    expect(row?.previewPath).not.toBe(row?.storagePath);
    expect(String(row?.previewPath)).toContain("/renders/preview.pdf");
    expect(memory.downloads.filter((path) => path === row?.storagePath)).toHaveLength(1);
    expect(memory.downloads).toContain(row?.previewPath);
    expect(errors.mock.calls.flat().join(" ")).not.toContain("Ada@Example.com");
    expect(errors.mock.calls.flat().join(" ")).not.toContain(id);

    const shown = await readResult(
      new Request("https://credpronto.test/api/pre-evaluation/" + id, { headers: { "x-forwarded-for": "203.0.113.22" } }),
      { params: Promise.resolve({ id }) },
    );
    const shownBody = await shown.json();
    expect(shownBody).toMatchObject({
      status: "ready",
      equivalent: "Bachelor's degree",
      confidence: "high",
      kind: "diploma",
    });
    expect(shownBody).not.toHaveProperty("name");
    expect(shownBody).not.toHaveProperty("size");
    expect(shownBody).not.toHaveProperty("pageCount");
    expect(shownBody.previewUrl).toContain("token=signed");
    expect(shownBody.previewUrl).toContain("expires=300");
    expect(shownBody.previewUrl).toContain(encodeURIComponent(String(row?.previewPath)));
    expect(shownBody.previewUrl).not.toContain("/api/pre-evaluation/");
    expect(shownBody.previewUrl).not.toContain(encodeURIComponent(String(row?.storagePath)));
    expect(memory.signs).toEqual([
      { bucket: "pre-evaluations", path: row?.previewPath, expiresIn: 300 },
    ]);
    expect(send).toHaveBeenCalledTimes(1);

    const downloadsBeforePreview = memory.downloads.length;
    const preview = await readPreview(
      new Request("https://credpronto.test/api/pre-evaluation/" + id + "/preview", { headers: { "x-forwarded-for": "203.0.113.22" } }),
      { params: Promise.resolve({ id }) },
    );
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toBe("application/pdf");
    expect(preview.headers.get("content-disposition")).toBe('inline; filename="document.pdf"');
    expect(preview.headers.get("x-robots-tag")).toContain("noindex");
    const previewBytes = new Uint8Array(await preview.arrayBuffer());
    expect(Buffer.compare(Buffer.from(previewBytes), Buffer.from(samplePdf))).not.toBe(0);
    expect(await pdfText(previewBytes)).toContain("PREVIEW");
    expect(memory.downloads.slice(downloadsBeforePreview)).toEqual([row?.previewPath]);
    expect(memory.downloads.slice(downloadsBeforePreview)).not.toContain(row?.storagePath);

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
    const failedBody = await shown.json();
    expect(failedBody).toEqual({
      status: "failed",
      equivalent: null,
      confidence: null,
      previewUrl: null,
      kind: null,
    });
    expect(JSON.stringify(failedBody)).not.toContain("credential.pdf");
    expect(failedBody).not.toHaveProperty("pageCount");
    expect(send).not.toHaveBeenCalled();
    expect(errors.mock.calls.flat().join(" ")).not.toContain("Ada Lovelace");
    expect(errors.mock.calls.flat().join(" ")).not.toContain("ada@example.com");
    errors.mockRestore();
  });

  it("holds the short upload window in the database", async () => {
    const ip = "203.0.113.77";
    for (let index = 0; index < PRE_EVAL_BURST.upload.max; index += 1) {
      const created = await upload(uploadRequest(ip));
      expect(created.status).toBe(200);
    }
    const blocked = await upload(uploadRequest(ip));
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).code).toBe("rate_limited");
  });
});
