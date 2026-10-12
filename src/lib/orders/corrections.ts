import { HttpError } from "./errors";

export type CorrectionRequest = {
  documentId: string;
  page: number;
  passage: string | null;
  note: string;
};

function optionalText(value: unknown, name: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new HttpError(`${name} must be a string or null`, 400);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Page and note are required. A highlighted passage is optional and may be null. */
export function parseCorrectionBody(body: unknown): CorrectionRequest {
  if (!body || typeof body !== "object") throw new HttpError("Expected a JSON body", 400);
  const record = body as Record<string, unknown>;
  if (typeof record.documentId !== "string" || record.documentId.trim() === "") {
    throw new HttpError("documentId is required", 400);
  }
  const page = typeof record.page === "number" ? record.page : Number(record.page);
  if (!Number.isInteger(page) || page < 1) throw new HttpError("page must be a combined page number", 400);

  let passage: string | null = null;
  if ("passage" in record) passage = optionalText(record.passage, "passage");
  else if ("quote" in record) passage = optionalText(record.quote, "quote");

  const note = typeof record.note === "string" ? record.note.trim() : "";
  if (!note) throw new HttpError("note is required", 400);

  return { documentId: record.documentId, page, passage, note };
}
