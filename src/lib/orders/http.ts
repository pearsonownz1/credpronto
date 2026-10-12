import { NextResponse } from "next/server";
import { HttpError } from "./errors";

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

/** Staff see this string on the order page. Keep the filename, drop the server path. */
export function reportedError(error: unknown): string {
  if (!(error instanceof Error)) return "Something went wrong";
  const message = error.message
    .replace(/(?:\/|\w:\\)\S+/g, (match) => match.split(/[/\\]/).pop() ?? match)
    .replace(/\s+/g, " ")
    .trim();
  if (!message || message.length > 300) return "Something went wrong";
  return message;
}

export async function run(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpError) {
      const response = json(
        {
          error: error.message,
          ...(error.code ? { code: error.code } : {}),
          ...error.details,
        },
        error.status,
      );
      const retry = error.details.retryAfterSeconds;
      if (typeof retry === "number" && Number.isInteger(retry) && retry > 0) {
        response.headers.set("Retry-After", String(retry));
      }
      return response;
    }
    const message = reportedError(error);
    console.error(error instanceof Error ? error.message : message);
    return json({ error: message }, 500);
  }
}
