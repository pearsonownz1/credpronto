import { randomUUID } from "node:crypto";
import {
  CHECKOUT_IMAGE_SECONDS,
  existingCheckoutPreviewPath,
  newCheckoutPreviewPath,
  watermarkedPreviewObject,
  checkoutPreviewFolder,
} from "./checkout-preview";
import { downloadObject, listObjectNames, signedObjectUrl, uploadObject, type Db } from "./storage";
import { renderPdfPagePng } from "./pdf/raster";

/**
 * Signed URL for page 1 of the watermarked preview.
 * A PNG already stored for the order is reused. Rendering errors return null.
 */
export async function checkoutPreviewImageUrl(
  db: Db,
  orderId: string,
  previewPath: string,
): Promise<string | null> {
  try {
    const source = watermarkedPreviewObject(previewPath);
    const names = await listObjectNames(db, source.bucket, checkoutPreviewFolder(orderId));
    const path =
      existingCheckoutPreviewPath(orderId, names) ?? (await storeCheckoutPreview(db, orderId, source.path));
    return signedObjectUrl(db, source.bucket, path, CHECKOUT_IMAGE_SECONDS);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`checkout preview image failed for ${orderId}: ${message}`, error);
    return null;
  }
}

async function storeCheckoutPreview(db: Db, orderId: string, previewPath: string): Promise<string> {
  const source = watermarkedPreviewObject(previewPath);
  const pdf = await downloadObject(db, source.bucket, source.path);
  const png = await renderPdfPagePng(pdf, 0);
  const path = newCheckoutPreviewPath(orderId, randomUUID());
  await uploadObject(db, source.bucket, path, png, "image/png");
  return path;
}
