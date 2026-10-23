import { describe, expect, it } from "vitest";
import { ADMIN_NAV } from "./nav";

describe("admin nav", () => {
  it("includes the correction queue and the pre-evaluation list", () => {
    expect(ADMIN_NAV.map((item) => item.href)).toEqual([
      "/admin",
      "/admin/certification",
      "/admin/review",
      "/admin/corrections",
      "/admin/preval",
      "/admin/refunds",
      "/admin/settings",
    ]);
    expect(ADMIN_NAV.find((item) => item.href === "/admin/corrections")?.label).toBe("Corrections");
    expect(ADMIN_NAV.find((item) => item.href === "/admin/preval")?.label).toBe("Pre-evaluations");
  });
});
