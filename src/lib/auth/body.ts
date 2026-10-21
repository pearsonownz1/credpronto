import { HttpError } from "@/lib/orders/errors";

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError("Expected a JSON body", 400);
  }
}

export function readEmail(body: unknown): string {
  if (!body || typeof body !== "object") throw new HttpError("Expected a JSON body", 400);
  const email = (body as { email?: unknown }).email;
  if (typeof email !== "string") throw new HttpError("email is required", 400);
  const trimmed = email.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) throw new HttpError("email is required", 400);
  return trimmed;
}

export function readNext(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const next = (body as { next?: unknown }).next;
  return typeof next === "string" ? next : null;
}

export function readOrderToken(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const token = (body as { orderToken?: unknown }).orderToken;
  if (typeof token !== "string") return null;
  const trimmed = token.trim();
  return trimmed ? trimmed : null;
}
