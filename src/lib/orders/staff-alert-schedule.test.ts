import { describe, expect, it, vi } from "vitest";
import { URGENT_ALERT_DELAY_MS } from "./release-decision";
import { scheduleUrgentStaffAlert } from "./staff-alert-schedule";

describe("urgent staff reminder", () => {
  it("waits about two minutes inside waitUntil, then checks the order", async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue(undefined);
    let held: Promise<unknown> = Promise.resolve();
    scheduleUrgentStaffAlert("order-9", {
      waitUntil: (task) => {
        held = task;
      },
      delayMs: URGENT_ALERT_DELAY_MS,
      run,
    });
    await vi.advanceTimersByTimeAsync(URGENT_ALERT_DELAY_MS - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await held;
    expect(run).toHaveBeenCalledWith("order-9");
    vi.useRealTimers();
  });
});
