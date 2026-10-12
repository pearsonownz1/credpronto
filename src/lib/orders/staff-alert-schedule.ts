import { after } from "next/server";
import { URGENT_ALERT_DELAY_MS } from "./release-decision";

/** Extra millisecond so the timer is not early when it checks paid_at. */
const TIMER_SLACK_MS = 1_500;

type WaitUntil = (task: Promise<unknown>) => void;

/** `after` keeps working after the response. That is the Next.js waitUntil. */
export function waitUntil(task: Promise<unknown>): void {
  after(() => task);
}

/**
 * One in-process reminder about two minutes after the first staff alert.
 * The five-minute cron is the backstop when this isolate is gone.
 */
export function scheduleUrgentStaffAlert(
  orderId: string,
  deps: {
    waitUntil?: WaitUntil;
    delayMs?: number;
    run?: (orderId: string) => Promise<void>;
  } = {},
): void {
  const hold = deps.waitUntil ?? waitUntil;
  const delayMs = deps.delayMs ?? URGENT_ALERT_DELAY_MS + TIMER_SLACK_MS;
  const run = deps.run ?? runUrgentStaffAlert;
  hold(
    new Promise((resolve) => {
      setTimeout(() => {
        void run(orderId).finally(() => resolve(undefined));
      }, delayMs);
    }),
  );
}

async function runUrgentStaffAlert(orderId: string): Promise<void> {
  const { sendUrgentStaffAlert } = await import("./paid-release");
  await sendUrgentStaffAlert(orderId);
}
