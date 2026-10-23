import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORIGINALS_BUCKET, PRE_EVALUATIONS_BUCKET } from "./constants";
import { HttpError } from "./errors";
import type { PreEvaluationRecord } from "@/lib/pre-evaluation/db";

const TOKEN = "b".repeat(43);
const INTERNAL = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const FILE = "33333333-3333-4333-8333-333333333333";
const CLIENT_PATH = "pre-evaluations/evil/secret.pdf";

const memory = vi.hoisted(() => ({
  user: null as { id: string; email: string | null; emailVerified: boolean } | null,
  record: null as PreEvaluationRecord | null,
  bytes: new Uint8Array(),
  downloads: [] as Array<{ bucket: string; path: string }>,
  uploads: [] as Array<{ bucket: string; path: string; mime: string; size: number }>,
  documents: [] as Array<Record<string, unknown>>,
  links: [] as Array<{ id: string; orderId: string }>,
  orders: [] as Array<{ id?: string }>,
  originals: new Map<string, number>(),
}));

vi.mock("@/lib/auth/session", () => ({
  optionalUser: async () => memory.user,
}));

vi.mock("@/lib/orders/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/orders/storage")>("@/lib/orders/storage");
  return {
    ...actual,
    serviceDb: () => ({
      storage: {
        from() {
          return {
            async info(path: string) {
              const size = memory.originals.get(path);
              if (size == null) return { data: null, error: { message: "Object not found" } };
              return { data: { size, contentType: "application/pdf" }, error: null };
            },
            async download() {
              return { data: null, error: { message: "not hashed" } };
            },
          };
        },
      },
    }),
    downloadObject: async (_db: unknown, bucket: string, path: string) => {
      memory.downloads.push({ bucket, path });
      if (bucket === PRE_EVALUATIONS_BUCKET && path === memory.record?.storagePath) return memory.bytes;
      throw new Error(`unexpected download ${bucket} ${path}`);
    },
    uploadObject: async (_db: unknown, bucket: string, path: string, bytes: Uint8Array, mime: string) => {
      memory.uploads.push({ bucket, path, mime, size: bytes.byteLength });
    },
  };
});

vi.mock("@/lib/pre-evaluation/db", () => ({
  preEvaluationByTokenHash: async () => memory.record,
  linkPreEvaluationOrder: async (_db: unknown, id: string, orderId: string) => {
    memory.links.push({ id, orderId });
  },
  consumePreEvalWindow: async () => ({ allowed: true, retryAfterSeconds: 0 }),
}));

vi.mock("@/lib/orders/db", () => ({
  upsertCustomer: async () => ({ id: "cust-1" }),
  insertCustomerWithoutEmail: async () => ({ id: "guest-1" }),
  insertOrder: async (_db: unknown, input: { id?: string }) => {
    memory.orders.push(input);
    return {
      id: input.id,
      evaluationCents: null,
      sourceLanguage: null,
      targetLanguage: "en",
      orderType: "evaluation",
    };
  },
  insertDocument: async (_db: unknown, input: Record<string, unknown>) => {
    memory.documents.push(input);
  },
  insertEvent: async () => undefined,
}));

import { createOrder } from "./create";

function record(patch: Partial<PreEvaluationRecord> = {}): PreEvaluationRecord {
  return {
    id: INTERNAL,
    tokenHash: "c".repeat(64),
    accessToken: TOKEN,
    status: "ready",
    storagePath: `${INTERNAL}/diploma.pdf`,
    filename: "diploma.pdf",
    mime: "application/pdf",
    sizeBytes: 10,
    ipHash: "d".repeat(64),
    country: "Mexico",
    credentialName: "Licenciatura",
    usEquivalency: "Bachelor's degree",
    confidence: "high",
    rationale: "Matched.",
    documentKind: "diploma",
    degreeCount: 1,
    edgeCredentialId: null,
    edgeMatchMethod: null,
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

function orderRequest(body: Record<string, unknown>) {
  return new Request("https://credpronto.test/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.addPage();
  memory.bytes = new Uint8Array(await doc.save());
  memory.user = { id: "user-1", email: "ADA@example.com", emailVerified: true };
  memory.record = record({ sizeBytes: memory.bytes.byteLength });
  memory.downloads.length = 0;
  memory.uploads.length = 0;
  memory.documents.length = 0;
  memory.links.length = 0;
  memory.orders.length = 0;
  memory.originals.clear();
});

describe("order create from a pre-evaluation", () => {
  it("copies the stored original when no other file is sent and links the order", async () => {
    const created = await createOrder(
      orderRequest({
        preEvaluationId: TOKEN,
        files: [],
        services: ["diploma"],
        degreeCount: 1,
        storagePath: CLIENT_PATH,
        path: CLIENT_PATH,
      }),
    );
    expect(created.documentCount).toBe(1);
    expect(created.orderId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(memory.downloads).toEqual([{ bucket: PRE_EVALUATIONS_BUCKET, path: `${INTERNAL}/diploma.pdf` }]);
    expect(memory.downloads.some((item) => item.path === CLIENT_PATH)).toBe(false);
    expect(memory.uploads).toEqual([
      {
        bucket: ORIGINALS_BUCKET,
        path: `${created.orderId}/${memory.documents[0]?.id}/diploma.pdf`,
        mime: "application/pdf",
        size: memory.bytes.byteLength,
      },
    ]);
    expect(String(memory.uploads[0]?.path)).not.toContain(CLIENT_PATH);
    expect(memory.documents).toEqual([
      expect.objectContaining({
        orderId: created.orderId,
        filename: "diploma.pdf",
        mime: "application/pdf",
        size: memory.bytes.byteLength,
        position: 1,
        pageCount: 2,
        originalPath: memory.uploads[0]?.path,
      }),
    ]);
    expect(memory.links).toEqual([{ id: INTERNAL, orderId: created.orderId }]);
  });

  it("keeps an extra upload and still counts the pre-evaluation pages", async () => {
    const extra = `${SESSION}/${FILE}/extra.pdf`;
    memory.originals.set(extra, 20);
    const created = await createOrder(
      orderRequest({
        preEvaluationId: TOKEN,
        sessionId: SESSION,
        services: ["diploma"],
        degreeCount: 1,
        files: [{ path: extra, filename: "extra.pdf", mime: "application/pdf", size: 20 }],
      }),
    );
    expect(created.orderId).toBe(SESSION);
    expect(created.documentCount).toBe(2);
    expect(memory.documents.map((row) => [row.filename, row.position, row.pageCount])).toEqual([
      ["diploma.pdf", 1, 2],
      ["extra.pdf", 2, null],
    ]);
    expect(memory.links).toEqual([{ id: INTERNAL, orderId: SESSION }]);
  });

  it("rejects a guest or a different account before copying", async () => {
    memory.user = null;
    await expect(
      createOrder(
        orderRequest({
          preEvaluationId: TOKEN,
          email: "ada@example.com",
          services: ["diploma"],
          degreeCount: 1,
        }),
      ),
    ).rejects.toMatchObject({ status: 404, message: "Pre-evaluation not found" });

    memory.user = { id: "user-2", email: "eve@example.com", emailVerified: true };
    await expect(
      createOrder(orderRequest({ preEvaluationId: TOKEN, services: ["diploma"], degreeCount: 1 })),
    ).rejects.toBeInstanceOf(HttpError);
    expect(memory.uploads).toEqual([]);
    expect(memory.orders).toEqual([]);
    expect(memory.downloads).toEqual([]);
  });

  it("still copies an owned file that has not been classified", async () => {
    memory.record = record({ documentKind: null });
    const created = await createOrder(
      orderRequest({ preEvaluationId: TOKEN, services: ["diploma"], degreeCount: 1 }),
    );
    expect(created.documentCount).toBe(1);
    expect(memory.links).toEqual([{ id: INTERNAL, orderId: created.orderId }]);
  });
});
