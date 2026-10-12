export type PreviewSource = { kind: "blob"; blob: Blob } | { kind: "url"; url: string };

/**
 * Prefer the file still in memory from the upload. Otherwise use a URL already
 * on the order, then the signed-source endpoint. A missing endpoint hides the preview.
 */
export async function resolvePreviewSource(input: {
  blob: Blob | null;
  sourceUrl?: string | null;
  loadSigned: () => Promise<{ url: string }>;
}): Promise<PreviewSource | null> {
  if (input.blob) return { kind: "blob", blob: input.blob };
  const inline = input.sourceUrl?.trim();
  if (inline) return { kind: "url", url: inline };
  try {
    const url = (await input.loadSigned()).url?.trim();
    return url ? { kind: "url", url } : null;
  } catch {
    return null;
  }
}
