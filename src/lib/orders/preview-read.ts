import { ORIGINALS_BUCKET, PREVIEW_URL_SECONDS, PREVIEWS_BUCKET } from "./constants";
import {
  insertEvent,
  latestReadyPreview,
  listPreviewCorrections,
  listPreviewFrames,
  listReadyPreviewPaths,
  withCombinedNumbers,
} from "./db";
import { HttpError } from "./errors";
import { orderForPreview } from "./order-access";
import { evaluationPreviewSources } from "./preview-documents";
import { previewSignedTargets } from "./preview-targets";
import { signedObjectUrls, type Db } from "./storage";
import { isOrderId } from "./token";
import { previewPages, type PreviewResponse } from "./view";

export type PreviewRead = {
  body: PreviewResponse;
  serverTiming: string;
};

function elapsed(since: number): number {
  return Math.round(performance.now() - since);
}

function serverTiming(parts: Record<string, number>): string {
  return Object.entries(parts)
    .map(([name, dur]) => `${name};dur=${dur}`)
    .join(", ");
}

/**
 * Email-link responses can sit in the browser for a few seconds. The signed URLs
 * last much longer. Dashboard ids stay uncached so every request rechecks the session.
 */
export function previewCacheControl(token: string): string {
  if (isOrderId(token)) return "private, no-store";
  return "private, max-age=15";
}

/** Headers for a successful preview. Errors stay uncached. */
export function previewResponseHeaders(token: string, timing: string): Record<string, string> {
  return {
    "Cache-Control": previewCacheControl(token),
    "Server-Timing": timing,
  };
}

async function signBuckets(
  db: Db,
  originalPath: string,
  previewPaths: readonly string[],
): Promise<{ originalUrl: string; previews: Map<string, string> }> {
  const originalTarget = previewSignedTargets({
    combinedOriginalPath: originalPath,
    previewPath: previewPaths[0] ?? originalPath,
  }).original;
  for (const path of previewPaths) {
    previewSignedTargets({ combinedOriginalPath: originalPath, previewPath: path });
  }
  const [originals, previews] = await Promise.all([
    signedObjectUrls(db, originalTarget.bucket, [originalTarget.path], PREVIEW_URL_SECONDS),
    signedObjectUrls(db, PREVIEWS_BUCKET, previewPaths, PREVIEW_URL_SECONDS),
  ]);
  const originalUrl = originals.get(originalTarget.path);
  if (!originalUrl) throw new HttpError("Preview is not ready", 409);
  if (originalTarget.bucket !== ORIGINALS_BUCKET) throw new HttpError("Preview is not ready", 409);
  return { originalUrl, previews };
}

export async function getPreview(token: string): Promise<PreviewRead> {
  const started = performance.now();
  const { db, order } = await orderForPreview(token);
  const lookupMs = elapsed(started);
  if (!order.combinedOriginalPath) throw new HttpError("Preview is not ready", 409);

  const readStarted = performance.now();
  const needsPreviewList = order.service === "diploma" || order.service === "course_by_course";
  const [preview, frames, corrections, readyPaths] = await Promise.all([
    latestReadyPreview(db, order.id),
    listPreviewFrames(db, order.id),
    listPreviewCorrections(db, order.id),
    needsPreviewList ? listReadyPreviewPaths(db, order.id) : Promise.resolve([] as string[]),
  ]);
  const readsMs = elapsed(readStarted);
  if (!preview) throw new HttpError("Preview is not ready", 409);

  const pages = previewPages(frames.documents, withCombinedNumbers(frames.documents, frames.pages));
  const sources = evaluationPreviewSources({
    service: order.service,
    previewPath: preview.previewPath,
    previewPaths: readyPaths,
  });
  const previewPaths = [
    ...new Set(
      [sources.viewerPath, sources.reportPath, sources.translationPath].filter(
        (path): path is string => Boolean(path),
      ),
    ),
  ];

  const signStarted = performance.now();
  const [{ originalUrl, previews }] = await Promise.all([
    signBuckets(db, order.combinedOriginalPath, previewPaths),
    insertEvent(db, order.id, "preview_viewed", { version: preview.version }),
  ]);
  const signMs = elapsed(signStarted);
  const translationUrl = previews.get(sources.viewerPath);
  if (!translationUrl) throw new HttpError("Preview is not ready", 409);
  const reportUrl = sources.reportPath ? previews.get(sources.reportPath) ?? null : null;
  const totalMs = elapsed(started);
  const timing = serverTiming({ lookup: lookupMs, reads: readsMs, sign: signMs, total: totalMs });
  console.info(
    JSON.stringify({
      event: "preview_api",
      orderId: order.id,
      lookupMs,
      readsMs,
      signMs,
      totalMs,
      pageCount: pages.length,
      signedUrls: previewPaths.length + 1,
      serverTiming: timing,
    }),
  );

  return {
    serverTiming: timing,
    body: {
      status: order.status,
      totalCents: order.totalCents,
      unitPriceCents: order.unitPriceCents,
      billablePages: order.billablePages,
      original: { url: originalUrl, pageCount: pages.length, pages },
      translation: {
        url: sources.translationPath ? previews.get(sources.translationPath) ?? translationUrl : translationUrl,
        pageCount: pages.length,
        pages,
        version: preview.version,
      },
      report: reportUrl
        ? { url: reportUrl, pageCount: order.evaluationPageCount ?? pages.length }
        : null,
      corrections: corrections.map((correction) => ({
        id: correction.id,
        documentId: correction.documentId,
        page: correction.pageNumber,
        quote: correction.passage,
        note: correction.note,
        status: correction.status,
        createdAt: correction.createdAt,
      })),
    },
  };
}
