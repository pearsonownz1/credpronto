import { DIRECT_FILE_LIMIT_MESSAGE, MAX_DIRECT_FILE_BYTES } from "@/lib/orders/constants";
import { resolveUploadMime } from "@/lib/orders/file-type";

/** Same byte cap the customer upload path enforces before a document is stored. */
export const PRE_EVALUATION_MAX_BYTES = MAX_DIRECT_FILE_BYTES;

export const PRE_EVALUATION_FILE_LIMIT = DIRECT_FILE_LIMIT_MESSAGE;

export const PRE_EVALUATION_ACCEPT = "application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png";

const PREVIEW_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

export function preEvaluationFileError(file: { name: string; type: string; size: number } | null): string | null {
  if (!file) return "Upload a diploma or transcript.";
  if (file.size <= 0) return "Empty files are not accepted";
  if (file.size > PRE_EVALUATION_MAX_BYTES) return PRE_EVALUATION_FILE_LIMIT;
  const mime = resolveUploadMime(file.name, file.type || "");
  if (!mime || !PREVIEW_TYPES.has(mime)) return "Upload a PDF, JPG, or PNG.";
  return null;
}
