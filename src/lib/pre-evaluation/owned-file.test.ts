import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRE_EVALUATIONS_BUCKET } from "@/lib/orders/constants";
import { GET as readFile } from "@/app/api/pre-evaluation/[id]/file/route";
import type { PreEvaluationRecord } from "./db";

const TOKEN = "a".repeat(43);
const INTERNAL = "11111111-1111-4111-8111-111111111111";

const memory = vi.hoisted(() => ({
  user: null as { id: string; email: string | null; emailVerified: boolean } | null,
  record: null as PreEvaluationRecord | null,
  bytes: new Uint8Array() as Uint8Array<ArrayBufferLike>,
  downloads: [] as Array<{ bucket: string; path: string }>,
  allowed: true,
}));

vi.mock("@/lib/auth/session", () => ({
  optionalUser: async () => memory.user,
}));

vi.mock("@/lib/orders/storage", () => ({
  serviceDb: () => ({ kind: "db" }),
  downloadObject: async (_db: unknown, bucket: string, path: string) => {
    memory.downloads.push({ bucket, path });
    return memory.bytes;
  },
  uploadObject: async () => undefined,
}));

vi.mock("@/lib/pre-evaluation/db", () => ({
  preEvaluationByTokenHash: async () => memory.record,
  consumePreEvalWindow: async () =>
    memory.allowed ? { allowed: true, retryAfterSeconds: 0 } : { allowed: false, retryAfterSeconds: 30 },
}));

function record(patch: Partial<PreEvaluationRecord> = {}): PreEvaluationRecord {
  return {
    id: INTERNAL,
    tokenHash: "b".repeat(64),
    accessToken: TOKEN,
    status: "ready",
    storagePath: `${INTERNAL}/diploma.pdf`,
    filename: "diploma.pdf",
    mime: "application/pdf",
    sizeBytes: 10,
    ipHash: "c".repeat(64),
    country: "Mexico",
    credentialName: "Licenciatura",
    usEquivalency: "Bachelor's degree",
    confidence: "high",
    rationale: "Matched.",
    documentKind: "diploma",
    degreeCount: 1,
    edgeCredentialId: null,
    edgeMatchMethod: "base",
    email: "ada@example.com",
    emailSubmittedAt: "2026-10-23T18:00:00.000Z",
    resultEmailSentAt: null,
    suggestionStartedAt: null,
    previewPath: `${INTERNAL}/renders/preview.pdf`,
    previewMime: "application/pdf",
    createdAt: "2026-10-23T17:00:00.000Z",
    ...patch,
  };
}

async function twoPagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.addPage();
  return Uint8Array.from(await doc.save());
}

beforeEach(async () => {
  memory.user = { id: "user-1", email: "Ada@Example.com", emailVerified: true };
  memory.bytes = await twoPagePdf();
  memory.record = record({ sizeBytes: memory.bytes.byteLength });
  memory.downloads.length = 0;
  memory.allowed = true;
});

function request() {
  return new Request(`https://credpronto.test/api/pre-evaluation/${TOKEN}/file`, {
    headers: { "x-forwarded-for": "203.0.113.40" },
  });
}

describe("owned pre-evaluation file", () => {
  it("returns exactly the classified file for the matching account email", async () => {
    const response = await readFile(request(), { params: Promise.resolve({ id: TOKEN }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).toEqual({
      preEvaluationFile: {
        name: "diploma.pdf",
        mimeType: "application/pdf",
        size: memory.bytes.byteLength,
        pageCount: 2,
        kind: "diploma",
      },
    });
    expect(Object.keys(body)).toEqual(["preEvaluationFile"]);
    expect(Object.keys(body.preEvaluationFile).sort()).toEqual(["kind", "mimeType", "name", "pageCount", "size"]);
    expect(JSON.stringify(body)).not.toContain(INTERNAL);
    expect(JSON.stringify(body)).not.toContain("renders");
    expect(JSON.stringify(body)).not.toContain("ada@");
    expect(memory.downloads).toEqual([{ bucket: PRE_EVALUATIONS_BUCKET, path: `${INTERNAL}/diploma.pdf` }]);
  });

  it("counts a photo as one page and uses the transcript classification", async () => {
    memory.bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
    memory.record = record({
      filename: "scan.jpg",
      mime: "image/jpeg",
      documentKind: "transcript",
      storagePath: `${INTERNAL}/scan.jpg`,
      sizeBytes: memory.bytes.byteLength,
    });
    const response = await readFile(request(), { params: Promise.resolve({ id: TOKEN }) });
    expect(await response.json()).toEqual({
      preEvaluationFile: {
        name: "scan.jpg",
        mimeType: "image/jpeg",
        size: 4,
        pageCount: 1,
        kind: "transcript",
      },
    });
  });

  it("is 404 for a signed-out caller, another account, an unknown id, and an unclassified file", async () => {
    memory.user = null;
    const signedOut = await readFile(request(), { params: Promise.resolve({ id: TOKEN }) });
    expect(signedOut.status).toBe(404);
    expect(await signedOut.json()).toEqual({ error: "Pre-evaluation not found" });

    memory.user = { id: "user-2", email: "eve@example.com", emailVerified: true };
    const other = await readFile(request(), { params: Promise.resolve({ id: TOKEN }) });
    expect(other.status).toBe(404);

    memory.user = { id: "user-1", email: "ada@example.com", emailVerified: true };
    memory.record = null;
    const missing = await readFile(request(), { params: Promise.resolve({ id: TOKEN }) });
    expect(missing.status).toBe(404);

    memory.record = record({ documentKind: null });
    const unclassified = await readFile(request(), { params: Promise.resolve({ id: TOKEN }) });
    expect(unclassified.status).toBe(404);

    const traversal = await readFile(request(), { params: Promise.resolve({ id: "../secret" }) });
    expect(traversal.status).toBe(404);
    expect(memory.downloads).toEqual([]);
  });

  it("does not follow a stored path outside the pre-evaluation object", async () => {
    memory.record = record({ storagePath: "../originals/secret.pdf" });
    const response = await readFile(request(), { params: Promise.resolve({ id: TOKEN }) });
    expect(response.status).toBe(404);
    expect(memory.downloads).toEqual([]);
  });
});
