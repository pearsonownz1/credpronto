import { describe, expect, it } from "vitest";
import { isOrderEventType } from "./events";

describe("order event types", () => {
  it("includes account, edit, note, and approval events", () => {
    expect(isOrderEventType("account_linked")).toBe(true);
    expect(isOrderEventType("translation_edited")).toBe(true);
    expect(isOrderEventType("note_added")).toBe(true);
    expect(isOrderEventType("approved")).toBe(true);
    expect(isOrderEventType("staff_notified")).toBe(true);
    expect(isOrderEventType("refunded")).toBe(true);
    expect(isOrderEventType("not_an_event")).toBe(false);
  });
});
