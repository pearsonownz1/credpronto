import { PREVIEW_URL_SECONDS } from "./constants";
import { evaluationPrice } from "./evaluation-price";
import {
  insertEvent,
  latestReadyPreview,
  listCorrections,
  listDocuments,
  listPageFrames,
  listReadyPreviewPaths,
  withCombinedNumbers,
} from "./db";
import { HttpError } from "./errors";
import { orderForToken } from "./order-access";
import { evaluationPreviewSources } from "./preview-documents";
import { previewSignedTargets } from "./preview-targets";
import { signedObjectUrl, type Db } from "./storage";
import { previewPages, type PreviewResponse } from "./view";

/** One signature per preview object, so two links to the same path share one URL. */
async function signPreviewPaths(
  db: Db,
  combinedOriginalPath: string,
  paths: readonly string[],
): Promise<Map<string, string>> {
  const entries = await Promise.all(
    paths.map(async (path) => {
      const target = previewSignedTargets({
        combinedOriginalPath,
        previewPath: path,
      }).translation;
      const url = await signedObjectUrl(db, target.bucket, target.path, PREVIEW_URL_SECONDS);
      return [path, url] as const;
    }),
  );
  return new Map(entries);
}

export async function getPreview(token: string): Promise<PreviewResponse> {
  const started = performance.now();
  const { db, order } = await orderForToken(token);
  const lookupMs = Math.round(performance.now() - started);
  const preview = await latestReadyPreview(db, order.id);
  if (!preview || !order.combinedOriginalPath) {
    throw new HttpError("Preview is not ready", 409);
  }

  const documents = await listDocuments(db, order.id);
  const pages = previewPages(
    documents,
    withCombinedNumbers(documents, await listPageFrames(db, documents.map((document) => document.id))),
  );
  const pagesMs = Math.round(performance.now() - started) - lookupMs;
  const sources = evaluationPreviewSources({
    service: order.service,
    previewPath: preview.previewPath,
    previewPaths: await listReadyPreviewPaths(db, order.id),
  });
  const originalTarget = previewSignedTargets({
    combinedOriginalPath: order.combinedOriginalPath,
    previewPath: sources.viewerPath,
  }).original;
  const previewPaths = [
    ...new Set(
      [sources.viewerPath, sources.reportPath, sources.translationPath].filter(
        (path): path is string => Boolean(path),
      ),
    ),
  ];
  const [originalUrl, signedPreviews] = await Promise.all([
    signedObjectUrl(db, originalTarget.bucket, originalTarget.path, PREVIEW_URL_SECONDS),
    signPreviewPaths(db, order.combinedOriginalPath, previewPaths),
  ]);
  const translationUrl = signedPreviews.get(sources.viewerPath);
  if (!translationUrl) throw new HttpError("Preview is not ready", 409);
  const reportUrl = sources.reportPath ? signedPreviews.get(sources.reportPath) ?? null : null;
  const signMs = Math.round(performance.now() - started) - lookupMs - pagesMs;
  await insertEvent(db, order.id, "preview_viewed", { version: preview.version });

  const corrections = await listCorrections(db, order.id);
  console.info(
    JSON.stringify({
      event: "preview_api",
      orderId: order.id,
      lookupMs,
      pagesMs,
      signMs,
      totalMs: Math.round(performance.now() - started),
      pageCount: pages.length,
      signedUrls: previewPaths.length + 1,
    }),
  );
  const priced = evaluationPrice(order);
  return {
    status: order.status,
    totalCents: priced?.totalCents ?? order.totalCents,
    unitPriceCents: priced?.unitPriceCents ?? order.unitPriceCents,
    billablePages: order.billablePages,
    original: { url: originalUrl, pageCount: pages.length, pages },
    translation: {
      url: sources.translationPath ? signedPreviews.get(sources.translationPath) ?? translationUrl : translationUrl,
      pageCount: pages.length,
      pages,
      version: preview.version,
    },
    report: reportUrl
      ? { url: reportUrl, pageCount: order.evaluationResult?.pageCount ?? pages.length }
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
  };
}
