import { DIRECT_FILE_LIMIT_MESSAGE, MAX_DIRECT_FILE_BYTES } from "@/lib/orders/constants";
import { resolveUploadMime } from "@/lib/orders/file-type";
import { readPublicSupabaseEnv } from "@/lib/supabase/env";
import { FlowApiError, requestFailedMessage } from "./api-error";
import { choiceFields, type UploadChoice } from "./order-choice";
import { dedupeUploads } from "./uploads";

export type FileUploadProgress = {
  name: string;
  ratio: number;
};

export type SignedUpload = {
  path: string;
  token: string;
  signedUrl: string;
  filename: string;
  mime: string;
  size: number;
};

type UploadSession = {
  sessionId: string;
  uploads: SignedUpload[];
};

function parseJson(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = parseJson(await response.text());
  if (!response.ok) {
    throw new FlowApiError(requestFailedMessage(parsed, response.status, response.statusText), response.status);
  }
  return parsed as T;
}

function storageHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "x-upsert": "false" };
  try {
    const { key } = readPublicSupabaseEnv();
    headers.apikey = key;
    headers.authorization = `Bearer ${key}`;
  } catch {
    // The signed URL token authorizes the upload. The public key is added when it is configured.
  }
  return headers;
}

function signedTarget(upload: SignedUpload): string {
  const signedUrl = upload.signedUrl.trim();
  const url = new URL(signedUrl, "https://upload.invalid");
  if (!url.searchParams.get("token") && upload.token) url.searchParams.set("token", upload.token);
  if (signedUrl.startsWith("http://") || signedUrl.startsWith("https://")) return url.toString();
  try {
    const base = readPublicSupabaseEnv().url.replace(/\/$/, "");
    const path = signedUrl.startsWith("/") ? signedUrl : `/${signedUrl}`;
    const absolute = path.startsWith("/storage/v1") ? `${base}${path}` : `${base}/storage/v1${path}`;
    const resolved = new URL(absolute);
    if (!resolved.searchParams.get("token") && upload.token) resolved.searchParams.set("token", upload.token);
    return resolved.toString();
  } catch (cause) {
    const message = cause instanceof Error && cause.message.trim() ? cause.message : "Could not start the upload";
    throw new FlowApiError(message, 0);
  }
}

export function putSignedFile(
  upload: SignedUpload,
  file: File,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedTarget(upload));
    const headers = storageHeaders();
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (!onProgress || !event.lengthComputable || event.total <= 0) return;
      onProgress(event.loaded, event.total);
    };
    xhr.onerror = () => reject(new FlowApiError(`${file.name}: The upload connection failed.`, 0));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(file.size, file.size || 1);
        resolve();
        return;
      }
      const message = requestFailedMessage(parseJson(xhr.responseText), xhr.status, xhr.statusText);
      const named = message.includes(file.name) ? message : `${file.name}: ${message}`;
      reject(new FlowApiError(named, xhr.status));
    };
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file, file.name);
    xhr.send(body);
  });
}

async function sha256(file: File): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

async function filesToUpload(files: File[]): Promise<File[]> {
  const unique: File[] = [];
  const seen = new Set<string>();
  for (const file of dedupeUploads(files)) {
    if (file.size <= 0) throw new FlowApiError("Empty files are not accepted", 400);
    if (file.size > MAX_DIRECT_FILE_BYTES) throw new FlowApiError(DIRECT_FILE_LIMIT_MESSAGE, 400);
    if (!resolveUploadMime(file.name, file.type || "")) {
      throw new FlowApiError(`Unsupported file type: ${file.name}`, 415);
    }
    const hash = await sha256(file);
    if (hash) {
      if (seen.has(hash)) continue;
      seen.add(hash);
    }
    unique.push(file);
  }
  if (unique.length < 1) throw new FlowApiError("Upload at least one file", 400);
  return unique;
}

function choicePayload(choice: UploadChoice): Record<string, unknown> {
  const fields = choiceFields(choice);
  return {
    orderType: choice.orderType,
    ...fields,
    ...(choice.orderType === "evaluation" ? { includeTranslation: choice.includeTranslation } : {}),
  };
}

export async function uploadOrderFiles(input: {
  email: string;
  files: File[];
  choice?: UploadChoice;
  onProgress?: (ratio: number) => void;
  onFileProgress?: (files: FileUploadProgress[]) => void;
  putFile?: typeof putSignedFile;
}): Promise<{ orderToken: string; orderId: string }> {
  const choice = input.choice ?? { orderType: "translation" as const };
  const files = await filesToUpload(input.files);
  const ratios = files.map(() => 0);
  const report = () => {
    const listed = files.map((file, index) => ({ name: file.name, ratio: ratios[index] ?? 0 }));
    input.onFileProgress?.(listed);
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (total <= 0) return;
    const loaded = files.reduce((sum, file, index) => sum + file.size * (ratios[index] ?? 0), 0);
    input.onProgress?.(loaded / total);
  };
  report();

  const session = await postJson<UploadSession>("/api/uploads", {
    files: files.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type || resolveUploadMime(file.name, "") || "",
    })),
  });
  if (!session.sessionId || !Array.isArray(session.uploads) || session.uploads.length !== files.length) {
    throw new FlowApiError("Could not start the upload", 502);
  }

  const put = input.putFile ?? putSignedFile;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const upload = session.uploads[index];
    if (!file || !upload?.signedUrl || !upload.path) {
      throw new FlowApiError("Could not start the upload", 502);
    }
    await put(upload, file, (loaded, total) => {
      ratios[index] = total > 0 ? Math.min(1, loaded / total) : 0;
      report();
    });
    ratios[index] = 1;
    report();
  }

  return postJson("/api/orders", {
    email: input.email,
    sessionId: session.sessionId,
    files: session.uploads.map((upload) => ({
      path: upload.path,
      filename: upload.filename,
      mime: upload.mime,
      size: upload.size,
    })),
    ...choicePayload(choice),
  });
}
