import { describe, expect, it } from "vitest";
import { formatAdminTimestamp } from "./format";

describe("admin timestamps", () => {
  it("prints the UTC date and time", () => {
    const printed = formatAdminTimestamp("2026-10-23T18:05:00.000Z");
    expect(printed).toContain("Oct");
    expect(printed).toContain("23");
    expect(printed).toContain("2026");
    expect(printed).toContain("UTC");
  });

  it("uses a dash when the time is missing", () => {
    expect(formatAdminTimestamp(null)).toBe("—");
    expect(formatAdminTimestamp("not-a-date")).toBe("—");
  });
});
