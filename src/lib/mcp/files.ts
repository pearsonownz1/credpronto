import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { DIRECT_FILE_LIMIT_MESSAGE, MAX_DIRECT_FILE_BYTES } from "@/lib/orders/constants";
import { HttpError } from "@/lib/orders/errors";
import { resolveUploadMime, safeFilename } from "@/lib/orders/file-type";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function decodeBase64File(value: string): Uint8Array {
  const trimmed = value.trim();
  const payload =
    trimmed.startsWith("data:") && trimmed.includes(",") ? trimmed.slice(trimmed.indexOf(",") + 1) : trimmed;
  const compact = payload.replace(/\s/g, "");
  if (!compact || !/^[A-Za-z0-9+/=]+$/.test(compact)) {
    throw new HttpError("content must be base64", 400, "validation_error");
  }
  const bytes = Buffer.from(compact, "base64");
  assertFileSize(bytes.byteLength);
  return new Uint8Array(bytes);
}

export function assertFileSize(size: number): void {
  if (!Number.isFinite(size) || size <= 0) throw new HttpError("Empty files are not accepted", 400, "validation_error");
  if (size > MAX_DIRECT_FILE_BYTES) throw new HttpError(DIRECT_FILE_LIMIT_MESSAGE, 400, "validation_error");
}

export function fileMime(filename: string, mime: string): string {
  const resolved = resolveUploadMime(safeFilename(filename), mime);
  if (!resolved) throw new HttpError(`Unsupported file type: ${filename}`, 415, "unsupported_type");
  return resolved;
}

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "metadata.google.internal" || host === "metadata.google") return true;
  return false;
}

export function isBlockedAddress(address: string): boolean {
  const value = address.trim().toLowerCase();
  if (!value) return true;
  if (value.includes(".")) {
    const mapped = value.startsWith("::ffff:") ? value.slice("::ffff:".length) : value;
    const parts = mapped.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return value.includes(":");
    }
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 192 && b === 0 && parts[2] === 2) return true;
    if (a === 198 && (b === 18 || b === 19 || b === 51)) return true;
    if (a >= 224) return true;
    return false;
  }
  if (value === "::" || value === "::1") return true;
  if (value.startsWith("fe80:") || value.startsWith("fc") || value.startsWith("fd")) return true;
  return false;
}

export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new HttpError("file URL must be https", 400, "validation_error");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new HttpError("file URL must be https", 400, "validation_error");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isBlockedHostname(host) || (isIP(host) && isBlockedAddress(host))) {
    throw new HttpError("That file URL is not allowed", 400, "validation_error");
  }
  if (!isIP(host)) {
    let records: Array<{ address: string }> = [];
    try {
      records = await lookup(host, { all: true, verbatim: true });
    } catch {
      throw new HttpError("That file URL is not allowed", 400, "validation_error");
    }
    if (records.length === 0 || records.some((record) => isBlockedAddress(record.address))) {
      throw new HttpError("That file URL is not allowed", 400, "validation_error");
    }
  }
  return url;
}

export async function downloadPublicFile(raw: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const url = await assertPublicHttpsUrl(raw);
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
  if (response.status >= 300 && response.status < 400) {
    throw new HttpError("That file URL is not allowed", 400, "validation_error");
  }
  if (!response.ok) throw new HttpError("The file could not be downloaded", 400, "validation_error");
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_DIRECT_FILE_BYTES) throw new HttpError(DIRECT_FILE_LIMIT_MESSAGE, 400, "validation_error");
  const bytes = new Uint8Array(await response.arrayBuffer());
  assertFileSize(bytes.byteLength);
  return { bytes, mime: response.headers.get("content-type") ?? "" };
}
