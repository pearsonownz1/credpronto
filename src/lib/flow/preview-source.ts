/** Refresh a signed URL this long before `expiresAt`, so a page turn does not use a dead link. */
export const SIGNED_URL_REFRESH_SKEW_MS = 15_000;

export type PreviewSource = { kind: "blob"; blob: Blob } | { kind: "url"; url: string; expiresAt: string | null };

/**
 * A signed URL is stale at `expiresAt`, and a little earlier so the next paint
 * can fetch a replacement. An inline URL has no expiry.
 */
export function signedSourceStale(
  expiresAt: string | null | undefined,
  now = Date.now(),
  skewMs = SIGNED_URL_REFRESH_SKEW_MS,
): boolean {
  if (!expiresAt?.trim()) return false;
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at)) return true;
  return now + skewMs >= at;
}

/**
 * Prefer the file still in memory from the upload. Otherwise use a URL already
 * on the order, then a cached signed URL that has not expired, then the
 * signed-source endpoint. A missing endpoint hides the preview.
 */
export async function resolvePreviewSource(input: {
  blob: Blob | null;
  sourceUrl?: string | null;
  cached?: PreviewSource | null;
  now?: number;
  loadSigned: () => Promise<{ url: string; expiresAt?: string | null }>;
}): Promise<PreviewSource | null> {
  if (input.blob) return { kind: "blob", blob: input.blob };
  const inline = input.sourceUrl?.trim();
  if (inline) return { kind: "url", url: inline, expiresAt: null };

  const cached = input.cached;
  if (cached?.kind === "url" && cached.url && cached.expiresAt && !signedSourceStale(cached.expiresAt, input.now)) {
    return cached;
  }

  try {
    const signed = await input.loadSigned();
    const url = signed.url?.trim();
    if (!url) return null;
    const expiresAt = signed.expiresAt?.trim() || null;
    return { kind: "url", url, expiresAt };
  } catch {
    return null;
  }
}
