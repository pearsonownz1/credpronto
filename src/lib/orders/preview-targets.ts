import { FINALS_BUCKET, ORIGINALS_BUCKET, PREVIEWS_BUCKET } from "./constants";

export type StorageTarget = {
  bucket: typeof ORIGINALS_BUCKET | typeof PREVIEWS_BUCKET;
  path: string;
};

/**
 * Preview signing is a separate choice of objects: the combined original and
 * the watermarked preview. The clean files in finals are never a preview target.
 */
export function previewSignedTargets(input: {
  combinedOriginalPath: string;
  previewPath: string;
}): { original: StorageTarget; translation: StorageTarget } {
  const original: StorageTarget = {
    bucket: ORIGINALS_BUCKET,
    path: input.combinedOriginalPath,
  };
  const translation: StorageTarget = {
    bucket: PREVIEWS_BUCKET,
    path: input.previewPath,
  };

  for (const target of [original, translation]) {
    const segments = target.path.split("/").filter(Boolean);
    if ((target.bucket as string) === FINALS_BUCKET || segments.includes(FINALS_BUCKET)) {
      throw new Error("Preview URLs must not point at finals");
    }
    if (!target.path) {
      throw new Error("Preview URLs must not point at finals");
    }
  }

  return { original, translation };
}
