/** Anonymous diploma and transcript uploads. Matches the pre-evaluation API. */
export const PRE_EVALUATION_MAX_BYTES = 10 * 1024 * 1024;

export const PRE_EVALUATION_FILE_LIMIT = "Each file must be 10MB or smaller";

export const PRE_EVALUATION_TYPE_MESSAGE = "Upload a PDF, JPG, or PNG";

export const PRE_EVALUATION_ACCEPT = "application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png";

type PreviewMime = "application/pdf" | "image/jpeg" | "image/png";

function extensionMime(filename: string): PreviewMime | null {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "pdf") return "application/pdf";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  return null;
}

function declaredMime(value: string): PreviewMime | null {
  const normalized = value.toLowerCase().split(";")[0]?.trim() ?? "";
  if (!normalized) return null;
  if (normalized === "application/pdf") return "application/pdf";
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "image/jpeg";
  if (normalized === "image/png") return "image/png";
  return null;
}

export function preEvaluationFileError(file: { name: string; type: string; size: number } | null): string | null {
  if (!file) return "Upload a diploma or transcript.";
  if (file.size <= 0) return "Empty files are not accepted";
  if (file.size > PRE_EVALUATION_MAX_BYTES) return PRE_EVALUATION_FILE_LIMIT;
  const fromName = extensionMime(file.name);
  if (!fromName) return PRE_EVALUATION_TYPE_MESSAGE;
  const declared = file.type.trim();
  if (declared && declaredMime(declared) !== fromName) return PRE_EVALUATION_TYPE_MESSAGE;
  return null;
}
