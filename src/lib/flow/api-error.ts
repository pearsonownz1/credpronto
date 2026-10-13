export class FlowApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "FlowApiError";
    this.status = status;
  }
}

/** Pull the server's message out of a JSON or text error body. */
export function readApiError(body: unknown): string | null {
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (!trimmed || trimmed === "Request failed" || trimmed.startsWith("<")) return null;
    return trimmed.slice(0, 300);
  }
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const error = record.error;
  if (typeof error === "string") {
    const trimmed = error.trim();
    if (trimmed && trimmed !== "Request failed") return trimmed.slice(0, 300);
  } else if (error && typeof error === "object") {
    const nested = error as Record<string, unknown>;
    if (typeof nested.message === "string" && nested.message.trim() && nested.message.trim() !== "Request failed") {
      return nested.message.trim().slice(0, 300);
    }
    if (typeof nested.code === "string" && nested.code.trim()) return nested.code.trim().slice(0, 300);
  }
  if (typeof record.message === "string" && record.message.trim() && record.message.trim() !== "Request failed") {
    return record.message.trim().slice(0, 300);
  }
  return null;
}

/** A message safe to show. Never the bare fallback "Request failed". */
export function requestFailedMessage(body: unknown, status: number, statusText = ""): string {
  const parsed = readApiError(body);
  if (parsed) return parsed;
  const text = statusText.trim();
  if (text && text !== "Request failed") return text.slice(0, 300);
  if (status === 413) return "FUNCTION_PAYLOAD_TOO_LARGE";
  if (status === 0) return "The upload connection failed.";
  return `The request failed (${status}).`;
}
