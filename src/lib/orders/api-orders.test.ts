import { describe, expect, it } from "vitest";
import { apiOrderView, chargedCents } from "./api-orders";

describe("API order history", () => {
  it("lists the key that placed the order and the settled charge only", () => {
    const unpaid = apiOrderView({
      id: "order-1",
      externalRef: "crm-1842",
      pages: 1,
      status: "quoted",
      currency: "usd",
      placedAt: "2026-10-12T00:00:00.000Z",
      key: { name: "Production", prefix: "cp_live_", last4: "ab12" },
      payments: [],
    });
    expect(unpaid).toEqual({
      id: "order-1",
      externalRef: "crm-1842",
      keyName: "Production",
      keyPrefix: "cp_live_",
      keyLast4: "ab12",
      pages: 1,
      status: "quoted",
      amountCents: null,
      currency: "usd",
      placedAt: "2026-10-12T00:00:00.000Z",
      downloadUrl: null,
      viewUrl: null,
    });
    expect(unpaid).not.toHaveProperty("secret");
    expect(unpaid).not.toHaveProperty("keyHash");

    expect(
      chargedCents([
        { status: "failed", amountCents: 100, createdAt: "2026-10-12T00:00:00.000Z" },
        { status: "paid", amountCents: 995, createdAt: "2026-10-12T01:00:00.000Z" },
      ]),
    ).toBe(995);
    expect(chargedCents([{ status: "pending", amountCents: 995, createdAt: "2026-10-12T01:00:00.000Z" }])).toBeNull();
  });
});
