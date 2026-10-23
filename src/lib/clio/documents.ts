import { MAX_DIRECT_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES, DIRECT_FILE_LIMIT_MESSAGE } from "@/lib/orders/constants";
import { HttpError } from "@/lib/orders/errors";
import { resolveUploadMime, safeFilename } from "@/lib/orders/file-type";
import { clioRequest, dataArray, dataObject, type ClioFetch } from "./api";
import { regionOrigin, type ClioRegion } from "./regions";
import type { ClioDocumentRef } from "./types";

const MATTER_PATH = /^\/api\/v4\/matters\/([0-9]{1,15})(?:\.json)?$/;
const EXTENSIONS: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
};

export function matterSubject(region: ClioRegion, subjectUrl: string): { matterId: string; path: string } | null {
  const origin = regionOrigin(region);
  let path = subjectUrl.trim();
  if (path.startsWith("https://") || path.startsWith("http://")) {
    let url: URL;
    try {
      url = new URL(path);
    } catch {
      return null;
    }
    if (url.origin !== origin) return null;
    path = url.pathname;
  }
  if (!path.startsWith("/")) path = `/${path}`;
  const match = MATTER_PATH.exec(path.split("?")[0] ?? "");
  if (!match?.[1]) return null;
  return { matterId: match[1], path: `/api/v4/matters/${match[1]}` };
}

export function matterNumber(matterId: string): number {
  if (!/^[0-9]{1,15}$/.test(matterId)) throw new HttpError("Clio matter was not recognized", 400);
  const value = Number(matterId);
  if (!Number.isSafeInteger(value)) throw new HttpError("Clio matter was not recognized", 400);
  return value;
}

function ensureExtension(filename: string, mime: string): string {
  const safe = safeFilename(filename);
  if (safe.includes(".") && resolveUploadMime(safe, mime)) return safe;
  const extension = EXTENSIONS[mime];
  return extension ? safeFilename(`${safe}${extension}`) : safe;
}

export function translatableDocument(row: Record<string, unknown>): ClioDocumentRef | null {
  const id = typeof row.id === "number" || typeof row.id === "string" ? String(row.id) : "";
  if (!/^[0-9]{1,15}$/.test(id)) return null;
  const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : "";
  const filename = typeof row.filename === "string" && row.filename.trim() ? row.filename.trim() : name;
  if (!filename) return null;
  const contentType = typeof row.content_type === "string" ? row.content_type : null;
  const mime = resolveUploadMime(filename, contentType ?? "");
  if (!mime) return null;
  if (typeof row.size === "number" && (row.size <= 0 || row.size > MAX_DIRECT_FILE_BYTES)) return null;
  return { id, name: name || filename, filename, contentType };
}

function nextPage(json: unknown, origin: string): { path: string; search: Record<string, string> } | null {
  if (!json || typeof json !== "object") return null;
  const meta = (json as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object") return null;
  const paging = (meta as { paging?: unknown }).paging;
  if (!paging || typeof paging !== "object") return null;
  const next = (paging as { next?: unknown }).next;
  if (typeof next !== "string" || !next) return null;
  let url: URL;
  try {
    url = new URL(next, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin || !url.pathname.startsWith("/api/v4/")) return null;
  return { path: url.pathname, search: Object.fromEntries(url.searchParams) };
}

export async function listMatterDocuments(input: {
  fetchImpl: ClioFetch;
  region: ClioRegion;
  token: string;
  matterId: string;
}): Promise<ClioDocumentRef[]> {
  const origin = regionOrigin(input.region);
  const documents: ClioDocumentRef[] = [];
  let path = "/api/v4/documents";
  let search: Record<string, string> | null = {
    matter_id: input.matterId,
    fields: "id,name,filename,content_type,size",
    limit: "200",
    order: "name(asc)",
  };
  for (let page = 0; page < 5 && search; page += 1) {
    const response = await clioRequest({
      fetchImpl: input.fetchImpl,
      origin,
      path,
      token: input.token,
      search,
    });
    if (response.status === 401 || response.status === 403) {
      throw new HttpError("Clio did not allow these documents", response.status);
    }
    if (response.status < 200 || response.status >= 300) throw new HttpError("Clio documents could not be loaded", 502);
    for (const row of dataArray(response.json)) {
      const document = translatableDocument(row);
      if (document) documents.push(document);
    }
    const next = nextPage(response.json, origin);
    path = next?.path ?? path;
    search = next?.search ?? null;
  }
  return documents;
}

export async function downloadClioDocument(input: {
  fetchImpl: ClioFetch;
  region: ClioRegion;
  token: string;
  document: ClioDocumentRef;
}): Promise<{ filename: string; mime: string; bytes: Uint8Array }> {
  const url = new URL(`/api/v4/documents/${input.document.id}/download`, regionOrigin(input.region));
  const response = await input.fetchImpl(url, {
    headers: { authorization: `Bearer ${input.token}`, accept: "*/*" },
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  let bytes: Uint8Array;
  let contentType = "";
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) throw new HttpError("Clio document could not be downloaded", 502);
    const fileUrl = new URL(location, url);
    if (fileUrl.protocol !== "https:") throw new HttpError("Clio document could not be downloaded", 502);
    const file = await input.fetchImpl(fileUrl, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
    if (!file.ok) throw new HttpError("Clio document could not be downloaded", 502);
    contentType = file.headers.get("content-type") ?? "";
    bytes = new Uint8Array(await file.arrayBuffer());
  } else if (response.ok) {
    contentType = response.headers.get("content-type") ?? "";
    bytes = new Uint8Array(await response.arrayBuffer());
  } else {
    throw new HttpError("Clio document could not be downloaded", 502);
  }
  if (contentType.includes("text/html") || contentType.includes("application/json")) {
    throw new HttpError("Clio document could not be downloaded", 502);
  }
  const mime = resolveUploadMime(input.document.filename, input.document.contentType ?? contentType);
  if (!mime) throw new HttpError(`Unsupported file type: ${input.document.filename}`, 415);
  if (bytes.byteLength <= 0) throw new HttpError("Empty files are not accepted", 400);
  if (bytes.byteLength > MAX_DIRECT_FILE_BYTES) throw new HttpError(DIRECT_FILE_LIMIT_MESSAGE, 400);
  return { filename: ensureExtension(input.document.filename, mime), mime, bytes };
}

export function assertClioFileBudget(files: Array<{ bytes: Uint8Array }>): void {
  if (files.length < 1) throw new HttpError("Choose at least one document", 400);
  if (files.length > MAX_FILES) throw new HttpError(`Choose at most ${MAX_FILES} documents`, 400);
  let total = 0;
  for (const file of files) {
    total += file.bytes.byteLength;
  }
  if (total > MAX_TOTAL_BYTES) throw new HttpError("The upload is larger than 100MB", 400);
}

type PutHeader = { name: string; value: string };

export async function uploadMatterPdf(input: {
  fetchImpl: ClioFetch;
  region: ClioRegion;
  token: string;
  matterId: string;
  filename: string;
  bytes: Uint8Array;
}): Promise<string> {
  const origin = regionOrigin(input.region);
  const created = await clioRequest({
    fetchImpl: input.fetchImpl,
    origin,
    path: "/api/v4/documents",
    token: input.token,
    search: { fields: "id,latest_document_version{uuid,put_url,put_headers}" },
    body: {
      data: {
        name: input.filename,
        parent: { id: matterNumber(input.matterId), type: "Matter" },
      },
    },
  });
  if (created.status < 200 || created.status >= 300) throw new HttpError("Clio document could not be created", 502);
  const data = dataObject(created.json);
  const version =
    data?.latest_document_version && typeof data.latest_document_version === "object"
      ? (data.latest_document_version as Record<string, unknown>)
      : null;
  const id = typeof data?.id === "number" || typeof data?.id === "string" ? String(data.id) : "";
  const uuid = typeof version?.uuid === "string" ? version.uuid : "";
  const putUrl = typeof version?.put_url === "string" ? version.put_url : "";
  const putHeaders = Array.isArray(version?.put_headers) ? version.put_headers : [];
  if (!id || !uuid || !putUrl.startsWith("https://")) throw new HttpError("Clio document could not be created", 502);
  const headers = new Headers();
  for (const header of putHeaders) {
    if (!header || typeof header !== "object") continue;
    const row = header as Partial<PutHeader>;
    if (typeof row.name === "string" && row.name && typeof row.value === "string") headers.set(row.name, row.value);
  }
  const put = await input.fetchImpl(putUrl, {
    method: "PUT",
    headers,
    body: Buffer.from(input.bytes),
    signal: AbortSignal.timeout(60_000),
  });
  if (!put.ok) throw new HttpError(`Clio file upload failed (${put.status})`, 502);
  const marked = await clioRequest({
    fetchImpl: input.fetchImpl,
    origin,
    path: `/api/v4/documents/${id}`,
    token: input.token,
    method: "PATCH",
    search: { fields: "id,latest_document_version{fully_uploaded}" },
    body: { data: { uuid, fully_uploaded: "true" } },
  });
  if (marked.status < 200 || marked.status >= 300) throw new HttpError("Clio did not finish the upload", 502);
  return id;
}
