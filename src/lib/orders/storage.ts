import { createServiceClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FINALS_BUCKET, ORIGINALS_BUCKET, PREVIEWS_BUCKET } from "./constants";
import { HttpError } from "./errors";

export type Db = SupabaseClient;

export type ObjectBucket = typeof ORIGINALS_BUCKET | typeof PREVIEWS_BUCKET | typeof FINALS_BUCKET;

export function serviceDb(): Db {
  try {
    return createServiceClient();
  } catch {
    throw new HttpError("Storage is not configured", 503);
  }
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
