import { DOWNLOAD_URL_SECONDS, FINALS_BUCKET } from "./constants";
import { approverDisplayName, stampApprovedCover } from "./certification";
import { notifyLifecycle, notifyOrder } from "./webhook-delivery";
import { orderDownloadFilename } from "./download-name";
import {
  customerEmail,
  dismissCorrections,
  getDelivery,
  getEdgeCredential,
  getEdgeGradingScale,
  getOrderById,
  hasEvent,
  insertEvent,
  listConfirmations,
  listCorrections,
  listDocuments,
  listOrders,
  listPages,
  listQaRuns,
  listTranslations,
  settledPayment,
  updateDelivery,
  updateOrder,
  withCombinedNumbers,
} from "./db";
import { sendDeliveryReady } from "./email";
import { fulfillmentFor, parseTrackingNumber } from "./fulfillment";
import { HttpError } from "./errors";
import { normalizeLanguage } from "./languages";
import { evaluationQuote } from "./evaluation-price";
import { publishCourseEquivalency, publishDiplomaEquivalency, retryEvaluation } from "./evaluation";
import { staffEdgeView } from "./edge";
import { EQUIVALENCY_UNMAPPED, approvalBlockReason } from "./equivalency";
import { etaFromNow } from "./quote";
import { signedObjectUrl } from "./storage";
import { ensureStaffRow, requireStaff } from "./staff";
import { paragraphsForPage } from "./translation-edit";
import { ORDER_STATUSES, type OrderStatus } from "./types";
import { translateOrder } from "./translation";

export { requireStaff } from "./staff";

export function parseStatus(value: string | null): OrderStatus | null {
  if (!value) return null;
  if ((ORDER_STATUSES as readonly string[]).includes(value)) return value as OrderStatus;
  throw new HttpError("Unknown status", 400);
}

export async function listStaffOrders(
  status: string | null,
  page: { limit: number; offset: number },
  reviewReason: string | null = null,
) {
  const { db } = await requireStaff();
  const listed = await listOrders(db, parseStatus(status), page, reviewReason);
  return {
    orders: listed.orders,
    page: { limit: page.limit, offset: page.offset, total: listed.total },
  };
}

export async function staffOrder(orderId: string) {
  const { db } = await requireStaff();
  const order = await getOrderById(db, orderId);
  if (!order) throw new HttpError("Order not found", 404);
  const documents = await listDocuments(db, order.id);
  const pages = withCombinedNumbers(documents, await listPages(db, documents.map((document) => document.id)));
  const translations = await listTranslations(db, documents.map((document) => document.id));
  const [confirmations, corrections, payment, delivery, email, qaRuns] = await Promise.all([
    listConfirmations(db, order.id),
    listCorrections(db, order.id),
    settledPayment(db, order.id),
    getDelivery(db, order.id),
    customerEmail(db, order.customerId),
    listQaRuns(db, order.id),
  ]);
  const latestQa = qaRuns[qaRuns.length - 1] ?? null;
  const [edgeCredential, edgeScale] = await Promise.all([
    order.edgeCredentialId ? getEdgeCredential(db, order.edgeCredentialId) : Promise.resolve(null),
    order.edgeGradingScaleId ? getEdgeGradingScale(db, order.edgeGradingScaleId) : Promise.resolve(null),
  ]);

  return {
    ...order,
    email,
    documents: documents.map((document) => {
      const ready = translations.filter(
        (translation) => translation.documentId === document.id && translation.status === "ready",
      );
      const translation = ready.sort((a, b) => b.version - a.version)[0] ?? null;
      return {
        ...document,
        translation: translation
          ? { version: translation.version, model: translation.model, status: translation.status }
          : null,
        pages: pages
          .filter((page) => page.documentId === document.id)
          .map((page) => {
            const paragraphs = translation
              ? paragraphsForPage(translation.output, {
                  pageNumber: page.pageNumber,
                  combinedPageNumber: page.number,
                })
              : null;
            return {
              ...page,
              sourceText: page.ocrText,
              translation: paragraphs
                ? { version: translation?.version ?? null, model: translation?.model ?? null, paragraphs }
                : null,
            };
          }),
      };
    }),
    confirmations,
    corrections,
    payment,
    delivery,
    fulfillment: fulfillmentFor(order),
    edge: staffEdgeView({ credential: edgeCredential, scale: edgeScale }),
    qa: latestQa
      ? {
          status: latestQa.status,
          score: latestQa.score,
          checkedAt: latestQa.createdAt,
          attempts: qaRuns.length,
          issues: latestQa.issues,
        }
      : null,
  };
}

async function signedFinals(
  db: Parameters<typeof signedObjectUrl>[0],
  order: { id: string; targetLanguage: string },
  translationPath: string | null,
  certificationPath: string | null,
) {
  if (!translationPath || !certificationPath) {
    throw new HttpError("Translated files are not ready", 409);
  }
  const names = (await listDocuments(db, order.id)).map((document) => document.filename);
  const translationName = orderDownloadFilename("translation", names, order.targetLanguage);
  const certificationName = orderDownloadFilename("certification", names, order.targetLanguage);
  const [translationUrl, certificationUrl] = await Promise.all([
    signedObjectUrl(db, FINALS_BUCKET, translationPath, DOWNLOAD_URL_SECONDS, { download: translationName }),
    signedObjectUrl(db, FINALS_BUCKET, certificationPath, DOWNLOAD_URL_SECONDS, { download: certificationName }),
  ]);
  return {
    translation: { url: translationUrl, filename: translationName, expiresInSeconds: DOWNLOAD_URL_SECONDS },
    certification: {
      url: certificationUrl,
      filename: certificationName,
      expiresInSeconds: DOWNLOAD_URL_SECONDS,
    },
  };
}

export async function approveOrder(orderId: string) {
  const { db, userId } = await requireStaff();
  const order = await getOrderById(db, orderId);
  if (!order) throw new HttpError("Order not found", 404);
  if (order.status !== "paid" && order.status !== "approved") {
    throw new HttpError("Only a paid order can be certified", 409);
  }
  const equivalencyBlock = approvalBlockReason(order);
  if (equivalencyBlock) throw new HttpError(equivalencyBlock, 409);
  const payment = await settledPayment(db, order.id);
  if (!payment) throw new HttpError("Payment required", 402);
  const delivery = await getDelivery(db, order.id);
  if (!delivery) throw new HttpError("Payment has not created a delivery", 409);
  if (delivery.status === "delivered") {
    const files = await signedFinals(db, order, delivery.finalPath, delivery.certificationPath);
    return { status: "delivered" as const, ...files };
  }
  if (!order.finalTranslationPath || !order.certificationPath) {
    throw new HttpError("Translated files are not ready", 409);
  }

  await ensureStaffRow(db, userId);
  // Status and the delivery email run only after this returns. A throw leaves the order unchanged.
  await stampApprovedCover(db, order, await approverDisplayName(db, userId));
  const now = new Date().toISOString();
  if (delivery.status !== "approved") {
    await updateDelivery(db, order.id, {
      status: "approved",
      approved_by: userId,
      approved_at: now,
      final_path: order.finalTranslationPath,
      certification_path: order.certificationPath,
    });
    await updateOrder(db, order.id, { status: "approved" });
    if (!(await hasEvent(db, order.id, "approved"))) {
      await insertEvent(db, order.id, "approved", { actorId: userId });
    }
  }

  const email = await customerEmail(db, order.customerId);
  const sent = email ? await sendDeliveryReady(email) : { sent: false, skipped: true };
  const files = await signedFinals(db, order, order.finalTranslationPath, order.certificationPath);
  if (!sent.sent && !sent.skipped) {
    return { status: "approved" as const, email: "failed" as const, ...files };
  }

  await updateDelivery(db, order.id, {
    status: "delivered",
    delivered_at: new Date().toISOString(),
    approved_by: delivery.approvedBy ?? userId,
    approved_at: delivery.approvedAt ?? now,
    final_path: order.finalTranslationPath,
    certification_path: order.certificationPath,
  });
  await updateOrder(db, order.id, { status: "delivered" });
  await notifyOrder(db, order.id, "order.delivered");
  await notifyLifecycle(db, order.id, "order.completed");
  return {
    status: "delivered" as const,
    email: sent.skipped ? ("skipped" as const) : ("sent" as const),
    ...files,
  };
}

function stringList(body: unknown, key: string): string[] | null {
  if (!body || typeof body !== "object") return null;
  const value = (body as Record<string, unknown>)[key];
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "string")) return null;
  return value;
}

function optionalStrings(body: unknown, key: string): string[] | undefined {
  if (!body || typeof body !== "object" || !(key in body)) return undefined;
  const value = (body as Record<string, unknown>)[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return undefined;
  return value;
}

export async function resolveReview(orderId: string, body: unknown) {
  const { db } = await requireStaff();
  const order = await getOrderById(db, orderId);
  if (!order) throw new HttpError("Order not found", 404);
  if (order.reviewReason === EQUIVALENCY_UNMAPPED) {
    const equivalencies = stringList(body, "equivalencies");
    if (!equivalencies) throw new HttpError("Each credential needs a U.S. equivalency", 400);
    if (order.evaluationResult?.kind === "course_by_course") {
      const equivalency = equivalencies[0];
      if (!equivalency) throw new HttpError("Each credential needs a U.S. equivalency", 400);
      await publishCourseEquivalency(db, order, equivalency);
      return { status: order.status, reviewReason: null as string | null };
    }
    await publishDiplomaEquivalency(db, order, equivalencies, {
      countries: optionalStrings(body, "countries"),
      fields: optionalStrings(body, "fields"),
      dates: optionalStrings(body, "dates"),
    });
    return { status: order.status, reviewReason: null as string | null };
  }
  if (order.status !== "needs_review") throw new HttpError("This order is not waiting for review", 409);
  if (!order.billablePages || order.billablePages < 1 || (!order.service && order.totalCents == null)) {
    throw new HttpError("There is no billable page count to quote", 409);
  }

  const requested =
    body && typeof body === "object" && typeof (body as { sourceLanguage?: unknown }).sourceLanguage === "string"
      ? (body as { sourceLanguage: string }).sourceLanguage
      : null;
  const language = requested ? normalizeLanguage(requested) : order.sourceLanguage;
  if (!language) throw new HttpError("Set a source language", 400);

  if (order.service && order.degreeCount != null) {
    if (!order.evaluationResult) {
      await retryEvaluation(db, order, language);
      const updated = await getOrderById(db, order.id);
      return { status: updated?.status ?? ("needs_review" as const), sourceLanguage: language };
    }
    const quote = evaluationQuote({
      service: order.service,
      degreeCount: order.degreeCount,
      sourceLanguage: language,
      billablePages: order.billablePages,
    });
    await updateOrder(db, order.id, {
      status: "preview_ready",
      source_language: language,
      language_confirmed: true,
      review_reason: null,
      eta_at: null,
      evaluation_cents: quote.evaluationCents,
      translation_cents: quote.translationCents,
      total_cents: quote.totalCents,
    });
    return { status: "preview_ready" as const, sourceLanguage: language };
  }

  await updateOrder(db, order.id, {
    status: "quoted",
    source_language: language,
    review_reason: null,
    eta_at: etaFromNow(1),
  });
  if (!(await hasEvent(db, order.id, "quote_shown"))) {
    await insertEvent(db, order.id, "quote_shown", {
      billablePages: order.billablePages,
      totalCents: order.totalCents,
    });
  }
  return { status: "quoted" as const, sourceLanguage: language };
}

export async function resolveCorrections(orderId: string, body: unknown) {
  const { db } = await requireStaff();
  const order = await getOrderById(db, orderId);
  if (!order) throw new HttpError("Order not found", 404);
  const action =
    body && typeof body === "object" && typeof (body as { action?: unknown }).action === "string"
      ? (body as { action: string }).action
      : "";
  const ids =
    body && typeof body === "object" && Array.isArray((body as { correctionIds?: unknown }).correctionIds)
      ? (body as { correctionIds: unknown[] }).correctionIds.filter((id): id is string => typeof id === "string")
      : [];

  if (action === "dismiss") {
    const open = (await listCorrections(db, order.id)).filter((correction) => correction.status === "open");
    const target = ids.length > 0 ? open.filter((correction) => ids.includes(correction.id)) : open;
    await dismissCorrections(db, target.map((correction) => correction.id));
    const remaining = (await listCorrections(db, order.id)).filter((correction) => correction.status === "open");
    if (remaining.length === 0 && order.status === "correction_requested") {
      await updateOrder(db, order.id, { status: "preview_ready" });
    }
    return { status: remaining.length === 0 ? "preview_ready" : order.status, dismissed: target.length };
  }

  if (action === "regenerate") {
    await translateOrder(db, order.id, null);
    const updated = await getOrderById(db, order.id);
    return { status: updated?.status ?? order.status };
  }

  throw new HttpError("action must be dismiss or regenerate", 400);
}

export async function shipOrder(orderId: string, body: unknown) {
  const { db } = await requireStaff();
  const order = await getOrderById(db, orderId);
  if (!order) throw new HttpError("Order not found", 404);
  if (!order.mailStatus) throw new HttpError("This order has no mail add-on", 409);
  const trackingNumber = parseTrackingNumber(body);
  await updateOrder(db, order.id, { mail_status: "shipped", mail_tracking: trackingNumber });
  return { task: "mail" as const, status: "shipped" as const, trackingNumber };
}

export async function notarizeOrder(orderId: string) {
  const { db } = await requireStaff();
  const order = await getOrderById(db, orderId);
  if (!order) throw new HttpError("Order not found", 404);
  if (!order.notarizationStatus) throw new HttpError("This order has no notarization add-on", 409);
  if (order.notarizationStatus === "done") {
    return { task: "notarization" as const, status: "done" as const, duplicate: true as const };
  }
  await updateOrder(db, order.id, { notarization_status: "done" });
  return { task: "notarization" as const, status: "done" as const };
}
