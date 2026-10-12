import { describe, expect, it } from "vitest";
import type { ApiOrder } from "./client";
import {
  QUICK_START_CODE_CLASS,
  apiOrdersCsv,
  formatCharged,
  formatKeyPrefix,
  formatLastUsed,
  quickStartCurl,
  safeOrderLink,
} from "./present";

const order: ApiOrder = {
  id: "ord_1",
  externalRef: "crm, \"1842\"",
  keyName: "Production",
  keyPrefix: "cp_live_",
  keyLast4: "ab12",
  pages: 3,
  status: "paid",
  amountCents: 2985,
  currency: "usd",
  placedAt: "2026-10-12T00:00:00.000Z",
  downloadUrl: "https://files.example/doc.pdf",
  viewUrl: null,
};

describe("integrations presentation", () => {
  it("shows a prefix like cp_live_ab12… and leaves unknown last-used blank", () => {
    expect(formatKeyPrefix("cp_live_", "ab12")).toBe("cp_live_ab12…");
    expect(formatKeyPrefix("cp_test_", "c0de")).toBe("cp_test_c0de…");
    expect(formatLastUsed(null, Date.parse("2026-10-12T00:00:00.000Z"))).toBe("Never");
  });

  it("formats a charged amount from cents and never substitutes a price", () => {
    expect(formatCharged(2985, "usd")).toBe("$29.85");
    expect(formatCharged(null, "usd")).toBe("—");
    expect(formatCharged(995, "")).toBe("9.95");
  });

  it("builds a bearer curl and a csv from api fields only", () => {
    const placeholder = quickStartCurl(null);
    expect(placeholder).toContain('Authorization: Bearer <key>');
    expect(placeholder).toContain("curl https://www.credpronto.com/api/v1/orders");
    expect(placeholder).not.toMatch(/\$\d/);
    expect(quickStartCurl("cp_test_secret")).toContain('Authorization: Bearer cp_test_secret');
    expect(QUICK_START_CODE_CLASS).toContain("overflow-x-auto");
    expect(QUICK_START_CODE_CLASS).toContain("whitespace-pre-wrap");
    expect(QUICK_START_CODE_CLASS).toContain("break-words");
    expect(QUICK_START_CODE_CLASS).toContain("min-w-0");
    expect(QUICK_START_CODE_CLASS).toContain("max-w-full");

    const csv = apiOrdersCsv([order]);
    expect(csv).toContain("ord_1");
    expect(csv).toContain("cp_live_ab12…");
    expect(csv).toContain("29.85");
    expect(csv).toContain('"crm, ""1842"""');
    expect(apiOrdersCsv([{ ...order, amountCents: null }])).not.toContain("29.85");
    expect(safeOrderLink("javascript:alert(1)")).toBeNull();
    expect(safeOrderLink("/order/tok")).toBe("/order/tok");
    expect(safeOrderLink("https://files.example/doc.pdf")).toBe("https://files.example/doc.pdf");
  });
});
