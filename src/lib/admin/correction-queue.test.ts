import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/orders/storage";
import {
  CORRECTION_PAGE_SIZE,
  correctionListFilter,
  correctionOffset,
  listCorrectionRequests,
  listStaffCorrections,
  mapCorrectionQueueRow,
} from "./correction-queue";

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
      sorts: Array<{ column: string; ascending: boolean }>;
      range: { from: number; to: number } | null;
      count: boolean;
    } = { filters: [], sorts: [], range: null, count: false };
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
        const total = rows.length;
        const sorts = [...state.sorts].reverse();
        for (const sort of sorts) {
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

const older = "2026-10-01T12:00:00.000Z";
const newer = "2026-10-23T18:00:00.000Z";
const orderA = "11111111-1111-4111-8111-111111111111";
const orderB = "22222222-2222-4222-8222-222222222222";

function seed() {
  return memoryDb({
    order_final_corrections: [
      {
        id: "corr-old",
        order_id: orderA,
        request_text: "The name is wrong",
        status: "open",
        created_at: older,
        fixed_at: null,
      },
      {
        id: "corr-new",
        order_id: orderB,
        request_text: "Page two is cut off",
        status: "open",
        created_at: newer,
        fixed_at: null,
      },
      {
        id: "corr-fixed",
        order_id: orderA,
        request_text: "Please fix the date",
        status: "fixed",
        created_at: "2026-10-20T12:00:00.000Z",
        fixed_at: "2026-10-21T12:00:00.000Z",
      },
      {
        id: "corr-claimed",
        order_id: orderB,
        request_text: "Claimed already",
        status: "in_progress",
        created_at: "2026-10-22T12:00:00.000Z",
        fixed_at: null,
      },
      {
        id: "corr-bad",
        order_id: orderA,
        request_text: "Nope",
        status: "dismissed",
        created_at: newer,
        fixed_at: null,
      },
    ],
    orders: [
      { id: orderA, customer_id: "cust-a" },
      { id: orderB, customer_id: "cust-b" },
    ],
    customers: [
      { id: "cust-a", email: "ada@example.com" },
      { id: "cust-b", email: "  " },
    ],
  });
}

describe("correction queue filter", () => {
  it("defaults to open and accepts fixed or all", () => {
    expect(correctionListFilter(undefined)).toBe("open");
    expect(correctionListFilter("nope")).toBe("open");
    expect(correctionListFilter("fixed")).toBe("fixed");
    expect(correctionListFilter("all")).toBe("all");
    expect(correctionOffset(undefined)).toBe(0);
    expect(correctionOffset("-1")).toBe(0);
    expect(correctionOffset("50")).toBe(50);
    expect(CORRECTION_PAGE_SIZE).toBe(50);
  });
});

describe("correction queue rows", () => {
  it("drops a row that is not a final-file request", () => {
    expect(mapCorrectionQueueRow({ id: "1", status: "dismissed", request_text: "x" }, null)).toBeNull();
  });

  it("lists open requests newest first with the customer email", async () => {
    const db = seed();
    const page = await listCorrectionRequests(db as unknown as Db, "open", { limit: 50, offset: 0 });
    const rows = page.rows;
    expect(page.total).toBe(2);
    expect(rows.map((row) => row.id)).toEqual(["corr-new", "corr-old"]);
    expect(rows[0]).toMatchObject({
      orderId: orderB,
      email: null,
      note: "Page two is cut off",
      status: "open",
      requestedAt: newer,
      fixedAt: null,
    });
    expect(rows[1]?.email).toBe("ada@example.com");
    expect(db.selects.join("\n")).not.toContain("final_path");
    expect(db.selects.join("\n")).not.toContain("access_token");
  });

  it("lists fixed requests and keeps every status in all", async () => {
    const db = seed();
    const fixed = await listCorrectionRequests(db as unknown as Db, "fixed", { limit: 50, offset: 0 });
    expect(fixed.total).toBe(1);
    expect(fixed.rows.map((row) => row.id)).toEqual(["corr-fixed"]);
    expect(fixed.rows[0]?.fixedAt).toBe("2026-10-21T12:00:00.000Z");

    const first = await listCorrectionRequests(db as unknown as Db, "all", { limit: 1, offset: 0 });
    expect(first.total).toBe(4);
    expect(first.rows.map((row) => row.id)).toEqual(["corr-new"]);
    const second = await listCorrectionRequests(db as unknown as Db, "all", { limit: 1, offset: 1 });
    expect(second.rows.map((row) => row.id)).toEqual(["corr-claimed"]);
    expect(second.rows.map((row) => row.id)).not.toContain("corr-bad");
  });
});

describe("staff correction query", () => {
  beforeEach(() => {
    vi.mocked(requireStaff).mockReset();
  });

  it("reads through the staff service-role client", async () => {
    const db = seed();
    vi.mocked(requireStaff).mockResolvedValue({ db: db as unknown as Db, userId: "staff-1", role: "admin" });
    const page = await listStaffCorrections("open", { limit: 50, offset: 0 });
    expect(requireStaff).toHaveBeenCalledOnce();
    expect(page.rows).toHaveLength(2);
    expect(page.total).toBe(2);
  });

  it("uses mock rows for an admin and does not open the service client", async () => {
    vi.stubEnv("CREDPRONTO_MOCK", "1");
    vi.mocked(getAccount).mockResolvedValue({
      id: "admin",
      email: "admin@credpronto.com",
      name: "Admin",
      isAdmin: true,
    });
    const page = await listStaffCorrections("open", { limit: 50, offset: 0 });
    expect(requireStaff).not.toHaveBeenCalled();
    expect(page.total).toBe(1);
    expect(page.rows.map((row) => row.status)).toEqual(["open"]);
    const second = await listStaffCorrections("all", { limit: 1, offset: 1 });
    expect(second.total).toBe(3);
    expect(second.rows).toHaveLength(1);
    expect(second.rows[0]?.status).toBe("in_progress");
    vi.mocked(getAccount).mockResolvedValue({
      id: "user",
      email: "ada@example.com",
      name: "Ada",
      isAdmin: false,
    });
    await expect(listStaffCorrections("all", { limit: 50, offset: 0 })).rejects.toThrow("Staff access required");
    vi.unstubAllEnvs();
  });
});
