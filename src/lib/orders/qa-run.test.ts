import { describe, expect, it, vi } from "vitest";
import { insertQaRun } from "./db";
import type { Db } from "./storage";

describe("insertQaRun", () => {
  it("upserts on the order and attempt so a repeated translation does not hit the unique key", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ upsert });
    const db = { from } as unknown as Db;

    await insertQaRun(db, {
      orderId: "order-1",
      attempt: 1,
      status: "fail",
      score: 40,
      issues: [],
    });

    expect(from).toHaveBeenCalledWith("order_qa_runs");
    expect(upsert).toHaveBeenCalledWith(
      {
        order_id: "order-1",
        attempt: 1,
        status: "fail",
        score: 40,
        issues: [],
      },
      { onConflict: "order_id,attempt" },
    );
  });

  it("throws the database message when the upsert fails", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: { message: "check constraint" } });
    const db = { from: () => ({ upsert }) } as unknown as Db;
    await expect(
      insertQaRun(db, { orderId: "order-1", attempt: 1, status: "pass", score: 100, issues: [] }),
    ).rejects.toThrow("check constraint");
  });
});
