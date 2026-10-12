import { FINALS_BUCKET, PREVIEWS_BUCKET } from "./constants";
import { languageLabel } from "./languages";

/** Stripe Checkout sessions last about a day. The image URL outlives the session. */
export const CHECKOUT_IMAGE_SECONDS = 25 * 60 * 60;

export const CHECKOUT_PREVIEW_EDGE_PX = 1000;

/**
 * Page 1 of the watermarked preview in the private `previews` bucket.
 * The clean file in `finals` is never a checkout image.
 */
export function watermarkedPreviewObject(previewPath: string): {
  bucket: typeof PREVIEWS_BUCKET;
  path: string;
} {
  const path = previewPath.trim();
  const segments = path.split("/").filter(Boolean);
  const name = segments[segments.length - 1] ?? "";
  if (
    !path ||
    segments.includes(FINALS_BUCKET) ||
    segments.length !== path.split("/").length ||
    !isWatermarkedPreviewName(name)
  ) {
    throw new Error("Checkout images must use the watermarked preview");
  }
  return { bucket: PREVIEWS_BUCKET, path };
}

/** Watermarked objects in `previews`. Clean `translation-v` and `evaluation-v` files are not previews. */
function isWatermarkedPreviewName(name: string): boolean {
  if (!name.endsWith(".pdf")) return false;
  if (name.startsWith("preview-")) return true;
  return /^report-v\d+\.pdf$/.test(name) || /^translation-preview-v\d+\.pdf$/.test(name);
}

export function checkoutPreviewFolder(orderId: string): string {
  return `checkout-previews/${orderId}`;
}

/** Reuse a PNG already stored for this order. Names are the objects inside the order folder. */
export function existingCheckoutPreviewPath(orderId: string, names: readonly string[]): string | null {
  const png = names
    .map((name) => name.trim())
    .filter((name) => /^[A-Za-z0-9._-]+\.png$/i.test(name))
    .sort()[0];
  if (!png) return null;
  return `${checkoutPreviewFolder(orderId)}/${png}`;
}

export function newCheckoutPreviewPath(orderId: string, randomId: string): string {
  return `${checkoutPreviewFolder(orderId)}/${randomId}.png`;
}

export function checkoutProductDescription(input: {
  sourceLanguage: string | null;
  targetLanguage: string;
  documentNames: readonly string[];
  pages: number;
}): string {
  const source = languageLabel((input.sourceLanguage ?? "").trim()) || "Unknown";
  const target = languageLabel(input.targetLanguage.trim()) || "English";
  const names = input.documentNames.map((name) => name.trim()).filter(Boolean);
  const pages = pageLabel(input.pages);
  if (names.length === 0) return `${source} → ${target} · ${pages}`;
  const extra = names.length > 1 ? ` +${names.length - 1} more` : "";
  return `${source} → ${target} · ${names[0]}${extra} · ${pages}`;
}

export function checkoutLineProduct(input: {
  billablePages: number;
  description: string;
  imageUrl: string | null;
}): { name: string; description: string; images?: string[] } {
  const product: { name: string; description: string; images?: string[] } = {
    name: `CredPronto certified translation (${pageLabel(input.billablePages)})`,
    description: input.description,
  };
  if (input.imageUrl) product.images = [input.imageUrl];
  return product;
}

function pageLabel(pages: number): string {
  const count = Number.isFinite(pages) ? Math.max(0, Math.round(pages)) : 0;
  return count === 1 ? "1 page" : `${count} pages`;
}
