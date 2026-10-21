import { approvalBlockReason } from "./equivalency";
import { EVALUATION_REVIEW_REASON } from "./evaluation-price";
import { stampApprovedCover } from "./certification";
import {
  claimEvalPaidAlert,
  claimOrderColumn,
  claimOrderStatus,
  clearOrderColumn,
  customerEmail,
  getDelivery,
  getOrderById,
  hasEvent,
  insertEvent,
  listCorrections,
  listDocuments,
  listPages,
  listQaRuns,
  listStaffAlertCandidates,
  listTranslations,
  markOrderPaidAt,
  settledPayment,
  updateDelivery,
  updateOrder,
  type Db,
} from "./db";
import { postEvaluationPaidAlert } from "./eval-alert-webhook";
import { adminStudioLink, sendStaffOrderAlert } from "./email";
import { retryFinalCustomerEmail, sendFinalCustomerEmail } from "./final-email";
import { EMPTY_TRANSLATION_MESSAGE, emptyTranslationMessage, paragraphsForPage } from "./translation-edit";
import { notifyLifecycle, notifyOrder } from "./webhook-delivery";
import {
  URGENT_ALERT_DELAY_MS,
  autoReleaseEnabled,
  fulfillmentState,
  releaseAction,
  staffAlertRecipients,
  urgentAlertDue,
  type FulfillmentState,
  type QaSignal,
  type ReleaseInput,
} from "./release-decision";
import type { OrderRecord } from "./types";

export type SettleOptions = {
  /** Pass false from the cron. The default arms the two-minute in-process reminder. */
  scheduleUrgent?: false | ((orderId: string) => void | Promise<void>);
  now?: number;
};

export async function settlePaidOrder(
  db: Db,
  orderId: string,
  options: SettleOptions = {},
): Promise<{ fulfillment: FulfillmentState | null }> {
  const order = await getOrderById(db, orderId);
  if (!order || order.status === "cancelled" || order.status === "failed") {
    return { fulfillment: fulfillmentState(order ?? { status: "cancelled" }) };
  }
  if (order.status === "delivered") {
    return { fulfillment: "released" };
  }
  if (order.status === "approved") {
    await retryFinalCustomerEmail(db, order);
    return { fulfillment: "released" };
  }

  const payment = await settledPayment(db, order.id);
  if (!payment && !order.paidAt && order.status !== "paid") {
    return { fulfillment: fulfillmentState(order) };
  }
  const paidAt = order.paidAt ?? payment?.paidAt ?? new Date().toISOString();
  if (!order.paidAt) await markOrderPaidAt(db, order.id, paidAt);
  const stamped = { ...order, paidAt };

  if (stamped.service && !stamped.reviewReason) {
    await updateOrder(db, stamped.id, { review_reason: EVALUATION_REVIEW_REASON });
    stamped.reviewReason = EVALUATION_REVIEW_REASON;
  }

  const signals = await releaseSignals(db, stamped);
  const action = releaseAction(signals);
  if (action === "release") {
    const released = await autoReleasePaidOrder(db, stamped);
    if (released !== "blocked") return { fulfillment: "released" };
  }
  if (action === "wait") return { fulfillment: fulfillmentState(stamped) };

  const sent = await sendFirstStaffAlert(db, stamped);
  await notifyEvaluationPaidAlert(db, stamped);
  if (sent && options.scheduleUrgent !== false) {
    const schedule = options.scheduleUrgent ?? scheduleDefault;
    await schedule(order.id);
  }
  return { fulfillment: "awaiting_review" };
}

export async function sendUrgentStaffAlert(orderId: string, now = Date.now()): Promise<boolean> {
  const { serviceDb } = await import("./storage");
  const db = serviceDb();
  const order = await getOrderById(db, orderId);
  if (!order || !urgentAlertDue({ ...order, now })) return false;
  return sendUrgentOnce(db, order);
}

export async function runStaffAlertBackstop(
  db: Db,
  now = Date.now(),
): Promise<{ settled: string[]; urgent: string[] }> {
  const cutoff = new Date(now - URGENT_ALERT_DELAY_MS).toISOString();
  const due = await listStaffAlertCandidates(db, cutoff);
  const settled: string[] = [];
  const urgent: string[] = [];
  for (const order of due) {
    await settlePaidOrder(db, order.id, { scheduleUrgent: false, now });
    settled.push(order.id);
    const fresh = await getOrderById(db, order.id);
    if (!fresh || !urgentAlertDue({ ...fresh, now })) continue;
    if (await sendUrgentOnce(db, fresh)) urgent.push(fresh.id);
  }
  return { settled, urgent };
}

async function scheduleDefault(orderId: string): Promise<void> {
  const { scheduleUrgentStaffAlert } = await import("./staff-alert-schedule");
  scheduleUrgentStaffAlert(orderId);
}

async function releaseSignals(db: Db, order: OrderRecord): Promise<ReleaseInput> {
  const documents = await listDocuments(db, order.id);
  const [pages, runs, corrections] = await Promise.all([
    listPages(db, documents.map((document) => document.id)),
    listQaRuns(db, order.id),
    listCorrections(db, order.id),
  ]);
  const confidences = documents
    .map((document) => document.confidence)
    .filter((confidence): confidence is number => confidence != null);
  const latest = runs.at(-1);
  const qa: QaSignal | null = latest ? { status: latest.status, score: latest.score } : null;
  return {
    status: order.status,
    reviewReason: order.reviewReason,
    qa,
    languageConfidence: confidences.length > 0 ? Math.min(...confidences) : null,
    pageNeedsReview: pages.some((page) => page.needsReview),
    openCorrections: corrections.some((correction) => correction.status === "open"),
    finalsReady: Boolean(order.finalTranslationPath && order.certificationPath),
    enabled: autoReleaseEnabled(),
    manualEvaluation: order.service != null,
  };
}

type ReleaseResult = "released" | "blocked" | "duplicate";

async function autoReleasePaidOrder(db: Db, order: OrderRecord): Promise<ReleaseResult> {
  if (order.status !== "paid") return "blocked";
  if (approvalBlockReason(order)) return "blocked";
  if (!order.finalTranslationPath || !order.certificationPath) return "blocked";
  const payment = await settledPayment(db, order.id);
  if (!payment) return "blocked";
  const delivery = await getDelivery(db, order.id);
  if (!delivery) return "blocked";
  if (delivery.status === "delivered") return "released";
  if (!order.service && (await translationEmpty(db, order))) return "blocked";

  try {
    await stampApprovedCover(db, order, null);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "auto-release cover failed");
    return "blocked";
  }

  const claimed = await claimOrderStatus(db, order.id, "paid", "approved");
  if (!claimed) return "duplicate";
  const now = new Date().toISOString();
  await updateDelivery(db, order.id, {
    status: "approved",
    approved_by: null,
    approved_at: now,
    final_path: order.finalTranslationPath,
    certification_path: order.certificationPath,
  });
  if (!(await hasEvent(db, order.id, "approved"))) {
    await insertEvent(db, order.id, "approved", { auto: true });
  }

  const sent = await sendFinalCustomerEmail(db, order);
  if (!sent.sent && !sent.skipped) return "released";

  await updateDelivery(db, order.id, {
    status: "delivered",
    delivered_at: new Date().toISOString(),
    approved_by: null,
    approved_at: now,
    final_path: order.finalTranslationPath,
    certification_path: order.certificationPath,
  });
  await updateOrder(db, order.id, { status: "delivered" });
  await notifyOrder(db, order.id, "order.delivered");
  await notifyLifecycle(db, order.id, "order.completed");
  return "released";
}

async function translationEmpty(db: Db, order: OrderRecord): Promise<boolean> {
  const documents = await listDocuments(db, order.id);
  const pages = await listPages(db, documents.map((document) => document.id));
  const translations = await listTranslations(db, documents.map((document) => document.id));
  const paragraphs = pages.map((page) => {
    const ready = translations
      .filter((translation) => translation.documentId === page.documentId && translation.status === "ready")
      .sort((a, b) => b.version - a.version);
    const translation = ready[0];
    return translation ? paragraphsForPage(translation.output, { pageNumber: page.pageNumber }) ?? [] : [];
  });
  return emptyTranslationMessage(paragraphs.map((page) => ({ paragraphs: page }))) === EMPTY_TRANSLATION_MESSAGE;
}

/** Staff webhook at payment time. The later urgent email does not send this again. */
async function notifyEvaluationPaidAlert(db: Db, order: OrderRecord): Promise<void> {
  if (order.service !== "diploma" && order.service !== "course_by_course") return;
  if (!process.env.EVAL_ALERT_WEBHOOK_URL?.trim()) return;
  try {
    const at = new Date().toISOString();
    const claimed = await claimEvalPaidAlert(db, order.id, at);
    if (!claimed) return;
    const email = await customerEmail(db, order.customerId);
    await postEvaluationPaidAlert({
      orderId: order.id,
      type: order.service,
      customerEmail: email,
      paidAt: order.paidAt ?? at,
      adminUrl: adminStudioLink(order.id),
    });
  } catch {
    // Payment stays settled when the alert cannot be claimed or delivered.
  }
}

async function sendFirstStaffAlert(db: Db, order: OrderRecord): Promise<boolean> {
  if (order.staffAlertSentAt) return false;
  const at = new Date().toISOString();
  const claimed = await claimOrderColumn(db, order.id, "staff_alert_sent_at", at);
  if (!claimed) return false;
  const sent = await dispatchStaffAlert(order, false);
  if (!sent) await clearOrderColumn(db, order.id, "staff_alert_sent_at", at);
  return sent;
}

async function sendUrgentOnce(db: Db, order: OrderRecord): Promise<boolean> {
  const at = new Date().toISOString();
  const claimed = await claimOrderColumn(db, order.id, "staff_urgent_alert_sent_at", at, [
    "paid",
    "needs_review",
    "correction_requested",
  ]);
  if (!claimed) return false;
  const sent = await dispatchStaffAlert(order, true);
  if (!sent) await clearOrderColumn(db, order.id, "staff_urgent_alert_sent_at", at);
  return sent;
}

async function dispatchStaffAlert(order: OrderRecord, urgent: boolean): Promise<boolean> {
  const recipients = staffAlertRecipients();
  if (recipients.length === 0) return false;
  const result = await sendStaffOrderAlert(recipients, {
    urgent,
    orderId: order.id,
    sourceLanguage: order.sourceLanguage,
    targetLanguage: order.targetLanguage,
    serviceType: order.serviceType,
    billablePages: order.billablePages,
    totalCents: order.totalCents,
    studioUrl: adminStudioLink(order.id),
  });
  return result.sent;
}

export { fulfillmentState };
