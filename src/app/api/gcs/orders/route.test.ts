import { beforeEach, describe, expect, it, vi } from "vitest";
import { GCS_HISTORY_LIMIT, GCS_HISTORY_STATUSES, listGcsHistory } from "@/lib/gcs/history";
import { GCS_PIN_COOKIE, gcsPinSessionToken } from "@/lib/gcs/pin";
import type { Db } from "@/lib/orders/storage";
import * as storage from "@/lib/orders/storage";
import { GET } from "./route";

const orderId = "28492f38-1111-4111-8111-111111111111";
const otherId = "395a3f49-2222-4222-8222-222222222222";

const diploma = {
  kind: "diploma",
  credentials: [
    {
      applicant: "Ana Ruiz",
      institution: "Universidad",
      country: "Mexico",
      credential: "Licenciatura",
      field: "Law",
      dates: "2020",
      usEquivalency: "Bachelor's degree",
      documentsReviewed: ["diploma.pdf"],
    },
  ],
};

type Call = { name: string; args: unknown[] };

function fakeOrdersDb(rows: unknown[]) {
  const calls: Call[] = [];
  const builder = {
    select(columns: string) {
      calls.push({ name: "select", args: [columns] });
      return builder;
    },
    eq(column: string, value: unknown) {
      calls.push({ name: "eq", args: [column, value] });
      return builder;
    },
    in(column: string, value: unknown) {
      calls.push({ name: "in", args: [column, value] });
      return builder;
    },
    order(column: string, options: unknown) {
      calls.push({ name: "order", args: [column, options] });
      return builder;
    },
    limit(count: number) {
      calls.push({ name: "limit", args: [count] });
      return builder;
    },
    then<TResult1, TResult2 = never>(
      onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve({ data: rows, error: null }).then(onfulfilled, onrejected);
    },
  };
  const db = {
    from(table: string) {
      calls.push({ name: "from", args: [table] });
      return builder;
    },
  };
  return { db: db as unknown as Db, calls };
}

function rows() {
  return [
    {
      id: orderId,
      brand: "gcs",
      status: "preview_ready",
      source_language: "es",
      target_language: "en",
      billable_pages: 2,
      created_at: "2026-10-24T15:04:00.000Z",
      service_files: { diploma: `${orderId}/gcs-diploma-evaluation-v2.pdf` },
      evaluation_result: null,
      documents: [
        { filename: "transcript.pdf", position: 2, page_count: 4 },
        { filename: "diploma.pdf", position: 1, page_count: 1 },
      ],
      confirmations: [
        { field_key: "institution", confirmed_value: "Universidad", original_value: null },
        { field_key: "full_name", confirmed_value: "Ana Ruiz", original_value: "ANA RUIZ" },
      ],
    },
    {
      id: otherId,
      brand: "gcs",
      status: "processing",
      source_language: null,
      target_language: "en",
      billable_pages: null,
      created_at: "2026-10-23T12:00:00.000Z",
      service_files: { course_by_course: `${otherId}/course.pdf` },
      evaluation_result: diploma,
      documents: [
        { filename: "scan.png", position: 0, page_count: 1 },
        { filename: "extra.png", position: 1, page_count: 2 },
      ],
      confirmations: [{ field_key: "full_name", confirmed_value: " ", original_value: "  " }],
    },
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      brand: "gcs",
      status: "cancelled",
      source_language: "es",
      target_language: "en",
      billable_pages: 1,
      created_at: "2026-10-22T12:00:00.000Z",
      service_files: null,
      evaluation_result: null,
      documents: [{ filename: "old.pdf", position: 0, page_count: 1 }],
      confirmations: [],
    },
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      brand: "credpronto",
      status: "delivered",
      source_language: "es",
      target_language: "en",
      billable_pages: 9,
      created_at: "2026-10-21T12:00:00.000Z",
      service_files: null,
      evaluation_result: null,
      documents: [{ filename: "cred.pdf", position: 0, page_count: 9 }],
      confirmations: [],
    },
  ];
}

describe("GET /api/gcs/orders", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.GCS_TRANSLATE_PIN;
  });

  it("requires the PIN and returns GCS orders with names and evaluation status", async () => {
    const fake = fakeOrdersDb(rows());
    vi.spyOn(storage, "serviceDb").mockReturnValue(fake.db);

    const denied = await GET(new Request("https://translate.gcs.org/api/gcs/orders"));
    expect(denied.status).toBe(401);
    expect(await denied.json()).toMatchObject({ error: expect.stringMatching(/PIN/i) });
    expect(fake.calls).toHaveLength(0);

    const wrong = await GET(
      new Request("https://translate.gcs.org/api/gcs/orders", {
        headers: { cookie: `${GCS_PIN_COOKIE}=not-the-session` },
      }),
    );
    expect(wrong.status).toBe(401);

    const response = await GET(
      new Request("https://translate.gcs.org/api/gcs/orders", {
        headers: { cookie: `${GCS_PIN_COOKIE}=${gcsPinSessionToken()}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      orders: [
        {
          id: orderId,
          status: "preview_ready",
          title: "Ana Ruiz",
          filenames: ["diploma.pdf", "transcript.pdf"],
          documentCount: 2,
          pageCount: 2,
          sourceLanguage: "es",
          targetLanguage: "en",
          hasEvaluation: true,
          evaluationKind: "diploma",
          createdAt: "2026-10-24T15:04:00.000Z",
        },
        {
          id: otherId,
          status: "processing",
          title: "scan.png + 1 more",
          filenames: ["scan.png", "extra.png"],
          documentCount: 2,
          pageCount: 3,
          sourceLanguage: null,
          targetLanguage: "en",
          hasEvaluation: true,
          evaluationKind: "course_by_course",
          createdAt: "2026-10-23T12:00:00.000Z",
        },
      ],
    });

    expect(fake.calls.map((call) => call.name)).toEqual(["from", "select", "eq", "in", "order", "limit"]);
    expect(fake.calls[0]).toEqual({ name: "from", args: ["orders"] });
    expect(String(fake.calls[1]?.args[0])).toContain("documents(filename, position, page_count)");
    expect(String(fake.calls[1]?.args[0])).toContain("confirmations(field_key, confirmed_value, original_value)");
    expect(fake.calls[2]).toEqual({ name: "eq", args: ["brand", "gcs"] });
    expect(fake.calls[3]?.args[0]).toBe("status");
    expect(fake.calls[3]?.args[1]).toEqual([...GCS_HISTORY_STATUSES]);
    expect(fake.calls[3]?.args[1]).not.toContain("cancelled");
    expect(fake.calls[3]?.args[1]).not.toContain("failed");
    expect(fake.calls[4]).toEqual({ name: "order", args: ["created_at", { ascending: false }] });
    expect(fake.calls[5]).toEqual({ name: "limit", args: [GCS_HISTORY_LIMIT] });
  });

  it("reads the same rows through listGcsHistory", async () => {
    const fake = fakeOrdersDb(rows());
    await expect(listGcsHistory(fake.db)).resolves.toHaveLength(2);
  });
});
