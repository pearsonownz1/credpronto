import { createServiceClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FINALS_BUCKET, ORIGINALS_BUCKET, PRE_EVALUATIONS_BUCKET, PREVIEWS_BUCKET } from "./constants";
import { HttpError } from "./errors";

export type Db = SupabaseClient;

export type ObjectBucket =
  | typeof ORIGINALS_BUCKET
  | typeof PREVIEWS_BUCKET
  | typeof FINALS_BUCKET
  | typeof PRE_EVALUATIONS_BUCKET;

export function serviceDb(): Db {
  try {
    return createServiceClient();
  } catch {
    throw new HttpError("Storage is not configured", 503);
  }
}

export async function createSignedUpload(
  db: Db,
  path: string,
): Promise<{ signedUrl: string; token: string; path: string }> {
  const { data, error } = await db.storage.from(ORIGINALS_BUCKET).createSignedUploadUrl(path);
  if (error || !data?.signedUrl || !data.token) {
    throw new HttpError(error?.message || "Could not start the upload", 503);
  }
  return { signedUrl: data.signedUrl, token: data.token, path: data.path || path };
}

export async function originalObjectInfo(
  db: Db,
  path: string,
): Promise<{ size: number; contentType: string | null }> {
  const { data, error } = await db.storage.from(ORIGINALS_BUCKET).info(path);
  if (error || !data) throw new HttpError(error?.message || "That file is not uploaded yet", 400);
  const reported = typeof data.size === "number" && Number.isFinite(data.size) ? data.size : null;
  if (reported == null) {
    const bytes = await downloadObject(db, ORIGINALS_BUCKET, path);
    return { size: bytes.byteLength, contentType: data.contentType ?? null };
  }
  return { size: reported, contentType: data.contentType ?? null };
}

export async function uploadObject(
  db: Db,
  bucket: ObjectBucket,
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const { error } = await db.storage.from(bucket).upload(path, Buffer.from(bytes), {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(error.message);
}

export async function listObjectNames(db: Db, bucket: ObjectBucket, prefix: string): Promise<string[]> {
  const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 100 });
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap((item) => (item.id && item.name ? [item.name] : []));
}

export async function downloadObject(db: Db, bucket: ObjectBucket, path: string): Promise<Uint8Array> {
  const { data, error } = await db.storage.from(bucket).download(path);
  if (error || !data) throw new Error(error?.message ?? "Download failed");
  return new Uint8Array(await data.arrayBuffer());
}

/** One storage round trip for every path in a bucket. An empty list does not call storage. */
export async function signedObjectUrls(
  db: Db,
  bucket: ObjectBucket,
  paths: readonly string[],
  expiresIn: number,
): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((path) => path.length > 0))];
  if (unique.length === 0) return new Map();
  const { data, error } = await db.storage.from(bucket).createSignedUrls(unique, expiresIn);
  if (error || !data) throw new Error(error?.message ?? "Could not sign URL");
  const urls = new Map<string, string>();
  unique.forEach((path, index) => {
    const item = data[index];
    if (!item || item.error || !item.signedUrl) throw new Error(item?.error ?? "Could not sign URL");
    urls.set(path, item.signedUrl);
  });
  return urls;
}

export async function signedObjectUrl(
  db: Db,
  bucket: ObjectBucket,
  path: string,
  expiresIn: number,
  options?: { download?: string },
): Promise<string> {
  const download = options?.download?.trim();
  const { data, error } = await db.storage.from(bucket).createSignedUrl(
    path,
    expiresIn,
    download ? { download } : undefined,
  );
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "Could not sign URL");
  return data.signedUrl;
}
