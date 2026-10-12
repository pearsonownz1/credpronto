import { describe, expect, it } from "vitest";
import { parseAdminListQuery } from "./admin-query";

describe("admin order list query", () => {
  it("defaults to the first page of 50", () => {
    expect(parseAdminListQuery(new URLSearchParams("status=paid"))).toEqual({
      status: "paid",
      limit: 50,
      offset: 0,
    });
  });

  it("accepts limit and offset", () => {
    expect(parseAdminListQuery(new URLSearchParams("limit=20&offset=40"))).toEqual({
      status: null,
      limit: 20,
      offset: 40,
    });
  });

  it("rejects a limit above 100", () => {
    expect(() => parseAdminListQuery(new URLSearchParams("limit=101"))).toThrow(/limit/);
  });
});
