import { describe, expect, it } from "vitest";
import { paidOrderPath } from "./preview-redirect";

describe("paid preview redirect", () => {
  it("sends a paid order to the order page and leaves an unpaid preview alone", () => {
    expect(paidOrderPath("0301d079-8368-40d8-854d-95475933124f", "paid")).toBe(
      "/order/0301d079-8368-40d8-854d-95475933124f",
    );
    expect(paidOrderPath("tok", "approved")).toBe("/order/tok");
    expect(paidOrderPath("tok", "delivered")).toBe("/order/tok");
    expect(paidOrderPath("tok", "preview_ready")).toBeNull();
    expect(paidOrderPath("", "paid")).toBeNull();
  });
});
