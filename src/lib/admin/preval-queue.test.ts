import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/orders/storage";
import {
  listPreEvaluations,
  listStaffPreEvaluations,
  paidOrderForSubmission,
  preEvaluationParam,
  preEvaluationResultSummary,
  prevalOffset,
  PREVAL_PAGE_SIZE,
  type PaidOrderCandidate,
} from "./preval-queue";

vi.mock("@/lib/orders/staff", () => ({
  requireStaff: vi.fn(),
}));

vi.mock("@/lib/account/session", () => ({
  isMockMode: () => process.env.CREDPRONTO_MOCK === "1",
  getAccount: vi.fn(),
}));

import { getAccount } from "@/lib/account/session";
import { requireStaff } from "@/lib/orders/staff";

type Row = Record<string, unknown>;

function memoryDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = structuredClone(seed);
  const selects: string[] = [];
  function from(table: string) {
    const state: {
      filters: Array<(row: Row) => boolean>;
      orFilters: Array<(row: Row) => boolean>;
      sorts: Array<{ column: string; ascending: boolean }>;
      range: { from: number; to: number } | null;
      count: boolean;
    } = { filters: [], orFilters: [], sorts: [], range: null, count: false };
    const api = {
      select(columns = "*", options?: { count?: string }) {
        selects.push(`${table} ${columns}`);
        state.count = options?.count === "exact";
        return api;
      },
      eq(column: string, value: unknown) {
        state.filters.push((row) => row[column] === value);
        return api;
      },
      in(column: string, values: unknown[]) {
        const allowed = new Set(values);
        state.filters.push((row) => allowed.has(row[column]));
        return api;
      },
      or(filter: string) {
        const clauses = filter.split(",").map((clause) => {
          const match = /^landing_path\.ilike\.\*preEvaluation=([A-Za-z0-9_-]+)\*$/.exec(clause);
          const id = match?.[1] ?? "";
          return (row: Row) => typeof row.landing_path === "string" && row.landing_path.includes(`preEvaluation=${id}`);
        });
        state.orFilters.push((row) => clauses.some((keep) => keep(row)));
        return api;
      },
      order(column: string, options?: { ascending?: boolean }) {
        state.sorts.push({ column, ascending: options?.ascending !== false });
        return api;
      },
      range(start: number, end: number) {
        state.range = { from: start, to: end };
        return api;
      },
      then(onFulfilled: (value: { data: Row[]; error: null; count: number | null }) => unknown) {
        let rows = (tables[table] ?? []).filter((row) => state.filters.every((keep) => keep(row)));
        if (state.orFilters.length > 0) rows = rows.filter((row) => state.orFilters.every((keep) => keep(row)));
        const total = rows.length;
        for (const sort of [...state.sorts].reverse()) {
          rows.sort((a, b) => {
            const av = String(a[sort.column] ?? "");
            const bv = String(b[sort.column] ?? "");
            const cmp = av < bv ? -1 : av > bv ? 1 : 0;
            return sort.ascending ? cmp : -cmp;
          });
        }
        if (state.range) rows = rows.slice(state.range.from, state.range.to + 1);
        return Promise.resolve({ data: rows, error: null, count: state.count ? total : null }).then(onFulfilled);
      },
    };
    return api;
  }
  return { from, selects };
}

const token = "a".repeat(43);
const otherToken = "b".repeat(43);
const preA = "44444444-4444-4444-8444-444444444444";
const preB = "55555555-5555-4555-8555-555555555555";
const preC = "66666666-6666-4666-8666-666666666666";
const paidOrder = "11111111-1111-4111-8111-111111111111";
const testOrder = "22222222-2222-4222-8222-222222222222";
const landingOrder = "33333333-3333-4333-8333-333333333333";
const newerLanding = "77777777-7777-4777-8777-777777777777";

function candidate(patch: Partial<PaidOrderCandidate> & Pick<PaidOrderCandidate, "id">): PaidOrderCandidate {
  return {
    preEvaluationId: null,
    paymentStatus: "paid",
    createdAt: "2026-10-23T12:00:00.000Z",
    ...patch,
  };
}

describe("pre-evaluation result summary", () => {
  it("joins the equivalency with confidence, and falls back to status", () => {
    expect(
      preEvaluationResultSummary({
        status: "ready",
        equivalency: "Bachelor's degree",
        confidence: "high",
      }),
    ).toBe("Bachelor's degree · high");
    expect(preEvaluationResultSummary({ status: "ready", equivalency: "Pending staff review", confidence: null })).toBe(
      "Pending staff review · Ready",
    );
    expect(preEvaluationResultSummary({ status: "processing", equivalency: null, confidence: null })).toBe("Processing");
    expect(preEvaluationResultSummary({ status: "failed", equivalency: null, confidence: null })).toBe("Failed");
  });

  it("reads an exact preEvaluation query value", () => {
    expect(preEvaluationParam("/translate?service=diploma&preEvaluation=abc_DEF-1")).toBe("abc_DEF-1");
    expect(preEvaluationParam("preEvaluation=abc")).toBe("abc");
    expect(preEvaluationParam("/translate?preEvaluation=abcXYZ")).toBe("abcXYZ");
    expect(preEvaluationParam("/translate?service=diploma")).toBeNull();
    expect(preEvaluationParam(null)).toBeNull();
    expect(prevalOffset(undefined)).toBe(0);
    expect(prevalOffset("-1")).toBe(0);
    expect(prevalOffset("40")).toBe(40);
  });
});

describe("paid conversion", () => {
  const submission = { id: preA, publicId: token, linkedOrderId: paidOrder };

  it("requires payment status paid", () => {
    expect(
      paidOrderForSubmission(submission, [
        candidate({ id: paidOrder, paymentStatus: "paid_test" }),
        candidate({ id: landingOrder, preEvaluationId: token, paymentStatus: "refunded" }),
        candidate({ id: testOrder, preEvaluationId: token, paymentStatus: null }),
      ]),
    ).toBeNull();
  });

  it("uses the order created with preEvaluation=<id>, including the stored order link", () => {
    expect(paidOrderForSubmission(submission, [candidate({ id: paidOrder, createdAt: "2026-10-01T00:00:00.000Z" })])).toBe(
      paidOrder,
    );
    expect(
      paidOrderForSubmission(
        { id: preA, publicId: token, linkedOrderId: null },
        [candidate({ id: landingOrder, preEvaluationId: token })],
      ),
    ).toBe(landingOrder);
    expect(
      paidOrderForSubmission(
        { id: preA, publicId: token, linkedOrderId: null },
        [candidate({ id: landingOrder, preEvaluationId: preA })],
      ),
    ).toBe(landingOrder);
  });

  it("does not treat a longer id as the same submission and keeps the newest paid order", () => {
    expect(
      paidOrderForSubmission(
        { id: preA, publicId: token, linkedOrderId: null },
        [candidate({ id: landingOrder, preEvaluationId: `${token}x` })],
      ),
    ).toBeNull();
    expect(
      paidOrderForSubmission(
        { id: preA, publicId: token, linkedOrderId: paidOrder },
        [
          candidate({ id: paidOrder, createdAt: "2026-10-01T00:00:00.000Z" }),
          candidate({ id: newerLanding, preEvaluationId: token, createdAt: "2026-10-23T00:00:00.000Z" }),
        ],
      ),
    ).toBe(newerLanding);
  });
});

describe("pre-evaluation list", () => {
  function db() {
    return memoryDb({
      pre_evaluations: [
        {
          id: preA,
          access_token: token,
          email: "ada@example.com",
          status: "ready",
          us_equivalency: "Bachelor's degree",
          confidence: "high",
          order_id: paidOrder,
          created_at: "2026-10-22T00:00:00.000Z",
        },
        {
          id: preB,
          access_token: otherToken,
          email: null,
          status: "processing",
          us_equivalency: null,
          confidence: null,
          order_id: testOrder,
          created_at: "2026-10-23T00:00:00.000Z",
        },
        {
          id: preC,
          access_token: "c".repeat(43),
          email: "bea@example.com",
          status: "failed",
          us_equivalency: null,
          confidence: null,
          order_id: null,
          created_at: "2026-10-21T00:00:00.000Z",
        },
      ],
      orders: [
        { id: paidOrder, landing_path: null, created_at: "2026-10-22T01:00:00.000Z" },
        { id: testOrder, landing_path: `/translate?preEvaluation=${otherToken}`, created_at: "2026-10-23T01:00:00.000Z" },
        {
          id: landingOrder,
          landing_path: `/translate?service=diploma&preEvaluation=${"c".repeat(43)}`,
          created_at: "2026-10-21T01:00:00.000Z",
        },
        {
          id: newerLanding,
          landing_path: `/translate?preEvaluation=${token}extra`,
          created_at: "2026-10-24T01:00:00.000Z",
        },
      ],
      payments: [
        { order_id: paidOrder, status: "paid" },
        { order_id: testOrder, status: "paid_test" },
        { order_id: landingOrder, status: "paid" },
        { order_id: newerLanding, status: "paid" },
      ],
    });
  }

  it("pages newest first and links only a paid order", async () => {
    const store = db();
    const first = await listPreEvaluations(store as unknown as Db, { limit: 2, offset: 0 });
    expect(first.total).toBe(3);
    expect(first.rows.map((row) => row.id)).toEqual([preB, preA]);
    expect(first.rows[0]).toMatchObject({ email: null, summary: "Processing", orderId: null });
    expect(first.rows[1]).toMatchObject({
      email: "ada@example.com",
      summary: "Bachelor's degree · high",
      orderId: paidOrder,
    });
    expect(JSON.stringify(first.rows)).not.toContain(token);
    expect(JSON.stringify(first.rows)).not.toContain("access_token");
    expect(store.selects.some((select) => select.startsWith("pre_evaluations") && select.includes("access_token"))).toBe(
      true,
    );

    const second = await listPreEvaluations(store as unknown as Db, { limit: PREVAL_PAGE_SIZE, offset: 2 });
    expect(second.rows).toEqual([
      expect.objectContaining({
        id: preC,
        email: "bea@example.com",
        summary: "Failed",
        orderId: landingOrder,
      }),
    ]);
  });

  it("does not look up orders when the page is empty", async () => {
    const store = memoryDb({ pre_evaluations: [], orders: [], payments: [] });
    const list = await listPreEvaluations(store as unknown as Db, { limit: 50, offset: 0 });
    expect(list).toEqual({ rows: [], total: 0 });
    expect(store.selects.some((select) => select.startsWith("orders"))).toBe(false);
    expect(store.selects.some((select) => select.startsWith("payments"))).toBe(false);
  });
});

describe("staff pre-evaluation query", () => {
  beforeEach(() => {
    vi.mocked(requireStaff).mockReset();
  });

  it("reads through the staff service-role client", async () => {
    const store = memoryDb({ pre_evaluations: [], orders: [], payments: [] });
    vi.mocked(requireStaff).mockResolvedValue({ db: store as unknown as Db, userId: "staff-1", role: "admin" });
    await listStaffPreEvaluations({ limit: 50, offset: 0 });
    expect(requireStaff).toHaveBeenCalledOnce();
  });

  it("uses mock rows for an admin and does not open the service client", async () => {
    vi.stubEnv("CREDPRONTO_MOCK", "1");
    vi.mocked(getAccount).mockResolvedValue({
      id: "admin",
      email: "admin@credpronto.com",
      name: "Admin",
      isAdmin: true,
    });
    const list = await listStaffPreEvaluations({ limit: 2, offset: 0 });
    expect(requireStaff).not.toHaveBeenCalled();
    expect(list.total).toBe(3);
    expect(list.rows).toHaveLength(2);
    expect(list.rows[0]?.orderId).toBe("CP-24790");
    vi.unstubAllEnvs();
  });
});
