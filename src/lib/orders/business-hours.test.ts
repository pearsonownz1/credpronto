import { describe, expect, it } from "vitest";
import { addBusinessHours } from "./business-hours";
import { EVALUATION_URGENT_BUSINESS_HOURS, evaluationUrgentDue } from "./release-decision";

function at(iso: string): string {
  return new Date(addBusinessHours(Date.parse(iso), EVALUATION_URGENT_BUSINESS_HOURS)).toISOString();
}

describe("Los Angeles business hours", () => {
  it("counts four hours inside one weekday", () => {
    // Monday 19 Oct 2026, 10:00am PDT → 2:00pm PDT.
    expect(at("2026-10-19T17:00:00.000Z")).toBe("2026-10-19T21:00:00.000Z");
    // Friday 16 Oct 2026, 1:00pm PDT ends exactly at 5:00pm PDT.
    expect(at("2026-10-16T20:00:00.000Z")).toBe("2026-10-17T00:00:00.000Z");
  });

  it("carries leftover hours into the next business morning", () => {
    // Monday 3:00pm PDT has two hours left, then Tuesday 9:00am–11:00am.
    expect(at("2026-10-19T22:00:00.000Z")).toBe("2026-10-20T18:00:00.000Z");
    // Monday 4:30pm PDT → Tuesday 12:30pm PDT.
    expect(at("2026-10-19T23:30:00.000Z")).toBe("2026-10-20T19:30:00.000Z");
  });

  it("starts at the next open when paid before hours or after hours", () => {
    // Monday 8:00am PDT → Monday 1:00pm PDT.
    expect(at("2026-10-19T15:00:00.000Z")).toBe("2026-10-19T20:00:00.000Z");
    // Monday 6:00pm PDT → Tuesday 1:00pm PDT.
    expect(at("2026-10-20T01:00:00.000Z")).toBe("2026-10-20T20:00:00.000Z");
    // Monday 5:00pm PDT is already closed → Tuesday 1:00pm PDT.
    expect(at("2026-10-20T00:00:00.000Z")).toBe("2026-10-20T20:00:00.000Z");
  });

  it("skips the weekend", () => {
    // Saturday noon PDT → Monday 1:00pm PDT.
    expect(at("2026-10-17T19:00:00.000Z")).toBe("2026-10-19T20:00:00.000Z");
    // Sunday 3:00pm PDT → Monday 1:00pm PDT.
    expect(at("2026-10-18T22:00:00.000Z")).toBe("2026-10-19T20:00:00.000Z");
  });

  it("crosses from Friday afternoon to Monday", () => {
    // Friday 4:00pm PDT has one hour left, then Monday 9:00am–12:00pm.
    expect(at("2026-10-16T23:00:00.000Z")).toBe("2026-10-19T19:00:00.000Z");
    // Friday 5:00pm PDT is closed for the weekend → Monday 1:00pm PDT.
    expect(at("2026-10-17T00:00:00.000Z")).toBe("2026-10-19T20:00:00.000Z");
  });

  it("uses Pacific standard time in winter, not a fixed offset", () => {
    // Monday 5 Jan 2026, 3:00pm PST → Tuesday 11:00am PST.
    expect(at("2026-01-05T23:00:00.000Z")).toBe("2026-01-06T19:00:00.000Z");
  });

  it("keeps wall-clock hours across the spring-forward weekend", () => {
    // Friday 6 Mar 2026, 4:00pm PST. Monday 9 Mar is PDT. Due Monday noon PDT.
    expect(at("2026-03-07T00:00:00.000Z")).toBe("2026-03-09T19:00:00.000Z");
  });
});

describe("evaluation urgent reminder", () => {
  const paidAt = "2026-10-19T17:00:00.000Z";
  const due = Date.parse("2026-10-19T21:00:00.000Z");
  const base = {
    status: "paid",
    paidAt,
    staffAlertSentAt: paidAt,
    staffUrgentAlertSentAt: null as string | null,
    service: "diploma",
  };

  it("waits four business hours, then fires once, including when a translation was bundled", () => {
    expect(EVALUATION_URGENT_BUSINESS_HOURS).toBe(4);
    expect(evaluationUrgentDue({ ...base, now: due - 1 })).toBe(false);
    expect(evaluationUrgentDue({ ...base, now: Date.parse(paidAt) + 2 * 60 * 1000 })).toBe(false);
    expect(evaluationUrgentDue({ ...base, now: due })).toBe(true);
    expect(evaluationUrgentDue({ ...base, service: "course_by_course", now: due })).toBe(true);
    expect(evaluationUrgentDue({ ...base, staffUrgentAlertSentAt: paidAt, now: due + 60_000 })).toBe(false);
  });

  it("does not fire after the order leaves the staff queue", () => {
    expect(evaluationUrgentDue({ ...base, status: "delivered", now: due })).toBe(false);
    expect(evaluationUrgentDue({ ...base, status: "approved", now: due })).toBe(false);
    expect(evaluationUrgentDue({ ...base, status: "cancelled", now: due })).toBe(false);
    expect(evaluationUrgentDue({ ...base, staffAlertSentAt: null, now: due })).toBe(false);
    expect(evaluationUrgentDue({ ...base, service: null, now: due })).toBe(false);
  });
});
