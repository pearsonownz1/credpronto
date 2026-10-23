import { PRE_EVAL_MAX_BYTES, type PreEvalMime } from "./constants";
import { HttpError } from "@/lib/orders/errors";
import { safeFilename } from "@/lib/orders/file-type";

const PDF = [0x25, 0x50, 0x44, 0x46];
const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Extra room for the multipart boundary before the file bytes are measured. */
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.byteLength < prefix.length) return false;
  return prefix.every((value, index) => bytes[index] === value);
}

export function sniffPreEvalMime(bytes: Uint8Array): PreEvalMime | null {
  if (startsWith(bytes, PDF)) return "application/pdf";
  if (startsWith(bytes, JPEG)) return "image/jpeg";
  if (startsWith(bytes, PNG)) return "image/png";
  return null;
}

export function extensionMime(filename: string): PreEvalMime | null {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "pdf") return "application/pdf";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  return null;
}

export function declaredMime(value: string): PreEvalMime | null {
  const normalized = value.toLowerCase().split(";")[0]?.trim() ?? "";
  if (normalized === "application/pdf") return "application/pdf";
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "image/jpeg";
  if (normalized === "image/png") return "image/png";
  return null;
}

export function assertPreEvalFile(input: {
  filename: string;
  declaredType: string;
  bytes: Uint8Array;
}): { filename: string; mime: PreEvalMime; bytes: Uint8Array } {
  if (input.bytes.byteLength <= 0) throw new HttpError("Empty files are not accepted", 400);
  if (input.bytes.byteLength > PRE_EVAL_MAX_BYTES) {
    throw new HttpError("Each file must be 10MB or smaller", 400);
  }
  const sniffed = sniffPreEvalMime(input.bytes);
  const fromName = extensionMime(input.filename);
  if (!sniffed || !fromName || sniffed !== fromName) {
    throw new HttpError("Upload a PDF, JPG, or PNG", 415);
  }
  const declared = input.declaredType.trim();
  if (declared && declaredMime(declared) !== sniffed) {
    throw new HttpError("Upload a PDF, JPG, or PNG", 415);
  }
  return { filename: safeFilename(input.filename), mime: sniffed, bytes: input.bytes };
}

export async function readPreEvalMultipart(request: Request): Promise<{
  filename: string;
  declaredType: string;
  bytes: Uint8Array;
}> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    throw new HttpError("Expected a file upload", 400);
  }
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > PRE_EVAL_MAX_BYTES + MULTIPART_OVERHEAD_BYTES) {
    throw new HttpError("Each file must be 10MB or smaller", 400);
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError("Expected a file upload", 400);
  }
  const entry = form.get("file");
  if (!(entry instanceof File)) throw new HttpError("Upload a PDF, JPG, or PNG", 400);
  const bytes = new Uint8Array(await entry.arrayBuffer());
  return { filename: entry.name, declaredType: entry.type, bytes };
}
