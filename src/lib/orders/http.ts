import { NextResponse } from "next/server";
import { HttpError } from "./errors";

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

export async function run(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.message }, error.status);
    }
    const message = error instanceof Error ? error.message : "request failed";
    console.error(message);
    return json({ error: "Something went wrong" }, 500);
  }
}
