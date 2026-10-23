import { beforeEach, describe, expect, it, vi } from "vitest";
import { attachAccountEmail, deliverAttachedQuoteEmail } from "./account-order-email";
import { assignOrderEmail, insertCustomerWithoutEmail, type Db } from "./db";
import * as db from "./db";
import * as email from "./email";
import * as finalEmail from "./final-email";
import { HttpError } from "./errors";
import type { OrderRecord } from "./types";

const orderId = "28492f38-1111-4111-8111-111111111111";

function order(patch: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: orderId,
    customerId: "anon",
    userId: null,
    status: "preview_ready",
    orderType: "translation",
    service: null,
    includeTranslation: false,
    translationCents: 0,
    sourceLanguage: "es",
    targetLanguage: "en",
    billablePages: 2,
    totalCents: 1990,
    paidAt: null,
    ...patch,
  } as OrderRecord;
}

type Customer = { id: string; email: string | null };
type OrderRow = { id: string; customer_id: string };

function memoryDb(state: { customers: Customer[]; orders: OrderRow[] }) {
  class Query {
    private action: "select" | "update" | "insert" = "select";
    private patch: Record<string, unknown> = {};
    private filters: Array<{ op: "eq" | "is"; col: string; val: unknown }> = [];

    constructor(private table: "customers" | "orders") {}

    select() {
      return this;
    }

    insert(patch: Record<string, unknown>) {
      this.action = "insert";
      this.patch = patch;
      return this;
    }

    update(patch: Record<string, unknown>) {
      this.action = "update";
      this.patch = patch;
      return this;
    }

    eq(col: string, val: unknown) {
      this.filters.push({ op: "eq", col, val });
      return this;
    }

    is(col: string, val: unknown) {
      this.filters.push({ op: "is", col, val });
      return this;
    }

    maybeSingle() {
      return this.execute("one");
    }

    single() {
      return this.execute("one");
    }

    then(
      onFulfilled: (value: { data: unknown; error: { message: string; code?: string } | null }) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) {
      return this.execute("many").then(onFulfilled, onRejected);
    }

    private matches(row: Record<string, unknown>): boolean {
      return this.filters.every((filter) => {
        const value = row[filter.col];
        if (filter.op === "is") return value == null;
        if (filter.col === "email" && typeof value === "string" && typeof filter.val === "string") {
          return value.toLowerCase() === filter.val.toLowerCase();
        }
        return value === filter.val;
      });
    }

    private rows(): Record<string, unknown>[] {
      return (this.table === "customers" ? state.customers : state.orders) as Record<string, unknown>[];
    }

    private async execute(mode: "one" | "many") {
      const matched = this.rows().filter((row) => this.matches(row));
      if (this.action === "insert") {
        const row = { id: `cust-${state.customers.length + 1}`, email: null, ...this.patch };
        state.customers.push(row as Customer);
        return { data: row, error: null };
      }
      if (this.action === "update") {
        if (this.table === "customers" && typeof this.patch.email === "string") {
          const clash = state.customers.some(
            (row) =>
              row.email?.toLowerCase() === String(this.patch.email).toLowerCase() &&
              !matched.includes(row as Record<string, unknown>),
          );
          if (clash) return { data: null, error: { message: "duplicate key value", code: "23505" } };
        }
        for (const row of matched) Object.assign(row, this.patch);
        return { data: matched, error: null };
      }
      return { data: mode === "one" ? (matched[0] ?? null) : matched, error: null };
    }
  }

  return {
    from(table: string) {
      if (table !== "customers" && table !== "orders") throw new Error(table);
      return new Query(table);
    },
  } as unknown as Db;
}

describe("guest customer rows", () => {
  it("creates a customer with no email, and another quote gets its own row", async () => {
    const state = { customers: [] as Customer[], orders: [] as OrderRow[] };
    const db = memoryDb(state);
    const first = await insertCustomerWithoutEmail(db);
    const second = await insertCustomerWithoutEmail(db);
    expect(first.id).not.toBe(second.id);
    expect(state.customers).toEqual([
      { id: first.id, email: null },
      { id: second.id, email: null },
    ]);
  });
});

describe("assignOrderEmail", () => {
  it("stores the account email on a quote that has none", async () => {
    const state = {
      customers: [{ id: "anon", email: null }],
      orders: [{ id: orderId, customer_id: "anon" }],
    };
    const result = await assignOrderEmail(memoryDb(state), orderId, "anon", " Ada@example.com ");
    expect(result).toEqual({ attached: true, customerId: "anon" });
    expect(state.customers[0]).toEqual({ id: "anon", email: "Ada@example.com" });
  });

  it("leaves an email the quote already has", async () => {
    const state = {
      customers: [{ id: "anon", email: "guest@example.com" }],
      orders: [{ id: orderId, customer_id: "anon" }],
    };
    const result = await assignOrderEmail(memoryDb(state), orderId, "anon", "ada@example.com");
    expect(result).toEqual({ attached: false, customerId: "anon" });
    expect(state.customers[0]?.email).toBe("guest@example.com");
  });

  it("points the quote at the customer who already owns the account email", async () => {
    const state = {
      customers: [
        { id: "anon", email: null },
        { id: "known", email: "ada@example.com" },
      ],
      orders: [{ id: orderId, customer_id: "anon" }],
    };
    const result = await assignOrderEmail(memoryDb(state), orderId, "anon", "Ada@example.com");
    expect(result).toEqual({ attached: true, customerId: "known" });
    expect(state.orders[0]?.customer_id).toBe("known");
    expect(state.customers[0]?.email).toBeNull();
  });

  it("repoints the quote when the address is claimed while it is being saved", async () => {
    const calls: unknown[] = [];
    let reads = 0;
    const db = {
      from(table: string) {
        const query = {
          select() {
            return query;
          },
          eq() {
            return query;
          },
          is() {
            return query;
          },
          update(patch: Record<string, unknown>) {
            calls.push({ table, patch });
            return query;
          },
          maybeSingle() {
            reads += 1;
            if (reads === 1) return Promise.resolve({ data: { email: null }, error: null });
            if (reads === 2) return Promise.resolve({ data: null, error: null });
            return Promise.resolve({ data: { id: "known" }, error: null });
          },
          then(
            onFulfilled: (value: { data: unknown; error: { message: string; code?: string } | null }) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) {
            const result =
              table === "customers"
                ? { data: null, error: { message: "duplicate key value", code: "23505" } }
                : { data: [{ id: orderId }], error: null };
            return Promise.resolve(result).then(onFulfilled, onRejected);
          },
        };
        return query;
      },
    } as unknown as Db;

    await expect(assignOrderEmail(db, orderId, "anon", "ada@example.com")).resolves.toEqual({
      attached: true,
      customerId: "known",
    });
    expect(calls).toContainEqual({ table: "orders", patch: { customer_id: "known" } });
  });

  it("rejects an address the customer table would not store", async () => {
    const db = memoryDb({ customers: [{ id: "anon", email: null }], orders: [] });
    await expect(assignOrderEmail(db, orderId, "anon", "not-an-email")).rejects.toBeInstanceOf(HttpError);
  });
});

describe("attachAccountEmail", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("sends the preview that was waiting, and the receipt when the quote is already paid", async () => {
    vi.spyOn(db, "assignOrderEmail").mockResolvedValue({ attached: true, customerId: "known" });
    vi.spyOn(db, "latestReadyPreview").mockResolvedValue({ version: 1 } as never);
    vi.spyOn(db, "customerEmail").mockResolvedValue("ada@example.com");
    vi.spyOn(db, "listDocuments").mockResolvedValue([{ id: "doc-1" }, { id: "doc-2" }] as never);
    const preview = vi.spyOn(email, "sendPreviewReady").mockResolvedValue({ sent: true, skipped: false });
    const receipt = vi.spyOn(finalEmail, "sendFinalCustomerEmail").mockResolvedValue({ sent: true, skipped: false });

    await expect(attachAccountEmail({} as Db, order({ paidAt: "2026-10-23T00:00:00.000Z" }), "ada@example.com")).resolves.toBe(
      true,
    );

    expect(preview).toHaveBeenCalledWith("ada@example.com", {
      token: null,
      orderId,
      sourceLanguage: "es",
      targetLanguage: "en",
      documentCount: 2,
      pageCount: 2,
      totalCents: 1990,
      includesTranslation: true,
    });
    expect(receipt).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ customerId: "known" }));
  });

  it("does not mail a quote that already had an email, or a preview that is not ready", async () => {
    vi.spyOn(db, "assignOrderEmail").mockResolvedValue({ attached: false, customerId: "anon" });
    const previewLookup = vi.spyOn(db, "latestReadyPreview");
    const preview = vi.spyOn(email, "sendPreviewReady");
    const receipt = vi.spyOn(finalEmail, "sendFinalCustomerEmail");

    await expect(attachAccountEmail({} as Db, order(), "ada@example.com")).resolves.toBe(false);
    expect(previewLookup).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
    expect(receipt).not.toHaveBeenCalled();
  });

  it("skips the receipt until the quote is paid", async () => {
    vi.spyOn(db, "latestReadyPreview").mockResolvedValue(null);
    const receipt = vi.spyOn(finalEmail, "sendFinalCustomerEmail");
    await deliverAttachedQuoteEmail({} as Db, order({ status: "quoted" }));
    expect(receipt).not.toHaveBeenCalled();
  });
});
