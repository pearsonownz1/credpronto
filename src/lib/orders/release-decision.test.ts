import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND_ADDRESS, BRAND_FOOTER, BRAND_NAME } from "./brand";
import { BANNED_EMAIL_TEXT, renderStaffAlertEmail } from "./email-templates";
import {
  DEFAULT_STAFF_ALERT_EMAILS,
  HIGH_QA_SCORE,
  URGENT_ALERT_DELAY_MS,
  autoReleaseEnabled,
  fulfillmentState,
  releaseAction,
  staffAlertRecipients,
  urgentAlertDue,
  type ReleaseInput,
} from "./release-decision";

const PAID = "2026-10-12T12:00:00.000Z";

function input(patch: Partial<ReleaseInput> = {}): ReleaseInput {
  return {
    status: "paid",
    reviewReason: null,
    qa: { status: "pass", score: HIGH_QA_SCORE },
    languageConfidence: 0.96,
    pageNeedsReview: false,
    openCorrections: false,
    finalsReady: true,
    enabled: true,
    ...patch,
  };
}

describe("auto release", () => {
  it("releases a clean high-confidence pass and holds everything else", () => {
    expect(releaseAction(input())).toBe("release");
    expect(releaseAction(input({ qa: { status: "pass", score: HIGH_QA_SCORE - 1 } }))).toBe("staff");
    expect(releaseAction(input({ qa: { status: "retranslated", score: 100 } }))).toBe("staff");
    expect(releaseAction(input({ qa: null }))).toBe("staff");
    expect(releaseAction(input({ reviewReason: "equivalency_qa_review" }))).toBe("staff");
    expect(releaseAction(input({ languageConfidence: 0.2 }))).toBe("staff");
    expect(releaseAction(input({ languageConfidence: null }))).toBe("staff");
    expect(releaseAction(input({ pageNeedsReview: true }))).toBe("staff");
    expect(releaseAction(input({ openCorrections: true }))).toBe("staff");
    expect(releaseAction(input({ enabled: false }))).toBe("staff");
    expect(releaseAction(input({ finalsReady: false, qa: null }))).toBe("wait");
    expect(releaseAction(input({ status: "needs_review", reviewReason: "QA found issues" }))).toBe("staff");
    expect(releaseAction(input({ status: "delivered" }))).toBe("release");
  });

  it("defaults the flag on and the alert list to support plus the backup mailbox", () => {
    expect(autoReleaseEnabled(undefined)).toBe(true);
    expect(autoReleaseEnabled("")).toBe(true);
    expect(autoReleaseEnabled("true")).toBe(true);
    expect(autoReleaseEnabled("0")).toBe(false);
    expect(autoReleaseEnabled("false")).toBe(false);
    expect(autoReleaseEnabled("off")).toBe(false);
    expect(staffAlertRecipients(undefined)).toEqual(DEFAULT_STAFF_ALERT_EMAILS.split(","));
    expect(staffAlertRecipients("ada@example.com, ada@example.com")).toEqual(["ada@example.com"]);
  });

  it("exposes released and awaiting_review from status and paidAt", () => {
    expect(fulfillmentState({ status: "delivered", paidAt: PAID })).toBe("released");
    expect(fulfillmentState({ status: "approved", paidAt: PAID })).toBe("released");
    expect(fulfillmentState({ status: "paid", paidAt: PAID })).toBe("awaiting_review");
    expect(fulfillmentState({ status: "needs_review", paidAt: PAID })).toBe("awaiting_review");
    expect(fulfillmentState({ status: "preview_ready", paidAt: null })).toBeNull();
    expect(fulfillmentState({ status: "needs_review", paidAt: null })).toBeNull();
  });

  it("sends the urgent alert once, two minutes after paid, and only after the first alert", () => {
    const base = {
      status: "paid",
      paidAt: PAID,
      staffAlertSentAt: PAID,
      staffUrgentAlertSentAt: null as string | null,
    };
    const paid = Date.parse(PAID);
    expect(urgentAlertDue({ ...base, now: paid + URGENT_ALERT_DELAY_MS - 1 })).toBe(false);
    expect(urgentAlertDue({ ...base, now: paid + URGENT_ALERT_DELAY_MS })).toBe(true);
    expect(urgentAlertDue({ ...base, status: "delivered", now: paid + URGENT_ALERT_DELAY_MS })).toBe(false);
    expect(urgentAlertDue({ ...base, staffAlertSentAt: null, now: paid + URGENT_ALERT_DELAY_MS })).toBe(false);
    expect(
      urgentAlertDue({
        ...base,
        staffUrgentAlertSentAt: PAID,
        now: paid + URGENT_ALERT_DELAY_MS,
      }),
    ).toBe(false);
    expect(URGENT_ALERT_DELAY_MS).toBe(120_000);
  });
});

describe("staff alert email", () => {
  it("includes the order facts, an absolute studio link, and the CredPronto footer", () => {
    const studio = "https://credpronto.com/admin/orders/order-9";
    const rendered = renderStaffAlertEmail({
      urgent: false,
      orderId: "order-9",
      sourceLanguage: "es",
      targetLanguage: "en",
      serviceType: "translation",
      billablePages: 3,
      totalCents: 2985,
      studioUrl: studio,
    });
    const urgent = renderStaffAlertEmail({
      urgent: true,
      orderId: "order-9",
      sourceLanguage: "es",
      targetLanguage: "en",
      serviceType: "evaluation",
      billablePages: 1,
      totalCents: 1995,
      studioUrl: studio,
    });
    expect(rendered.subject).toBe("CredPronto order paid");
    expect(urgent.subject).toMatch(/^URGENT:/);
    expect(rendered.text).toContain("order-9");
    expect(rendered.text).toContain("Spanish to English");
    expect(rendered.text).toContain("Certified translation");
    expect(rendered.text).toContain("3 billable pages");
    expect(rendered.text).toContain("$29.85");
    expect(rendered.text).toContain(studio);
    expect(rendered.html).toContain(`href="${studio}"`);
    expect(rendered.html).toContain(BRAND_FOOTER);
    expect(rendered.html).toContain(BRAND_ADDRESS);
    expect(urgent.text).toContain("Credential evaluation");
    expect(urgent.text).toContain("1 billable page");
    for (const value of [rendered.subject, rendered.text, rendered.html, urgent.subject, urgent.text, urgent.html]) {
      expect(value).not.toMatch(BANNED_EMAIL_TEXT);
      expect(value).toContain(BRAND_NAME);
    }
  });
});

describe("paid staff migration and cron", () => {
  it("adds nullable timestamps, backfills paid_at, and lets auto-release omit a staff user", () => {
    const sql = readFileSync(
      path.join(process.cwd(), "supabase/migrations/20261012170000_order_paid_staff_alerts.sql"),
      "utf8",
    );
    expect(sql).toMatch(/add column if not exists paid_at timestamptz/);
    expect(sql).toMatch(/staff_alert_sent_at timestamptz/);
    expect(sql).toMatch(/staff_urgent_alert_sent_at timestamptz/);
    expect(sql).toMatch(/from public\.payments/);
    expect(sql).toMatch(/type = 'paid'/);
    expect(sql).toMatch(/approved_at is not null/);
    expect(sql.toLowerCase()).not.toMatch(/drop column/);

    const vercel = readFileSync(path.join(process.cwd(), "vercel.json"), "utf8");
    expect(vercel).toMatch(/\/api\/cron\/translation-watchdog/);
    expect(vercel).toMatch(/\*\/5 \* \* \* \*/);
    const route = readFileSync(
      path.join(process.cwd(), "src/app/api/cron/translation-watchdog/route.ts"),
      "utf8",
    );
    expect(route).toMatch(/CRON_SECRET/);
    expect(route).toMatch(/runStaffAlertBackstop/);
  });
});
