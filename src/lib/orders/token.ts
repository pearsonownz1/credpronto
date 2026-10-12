import { createHash, randomBytes } from "node:crypto";
import { HttpError } from "./errors";

/** Raw token for the email link. At least 32 bytes from a CSPRNG, base64url. */
export function generateOrderToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Lowercase hex SHA-256 of the exact token string. This is what orders stores. */
export function hashOrderToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Raw email-link tokens are 32+ CSPRNG bytes, base64url, and nothing else. */
export function isOrderToken(token: string): boolean {
  return token.length >= 43 && token.length <= 128 && /^[A-Za-z0-9_-]+$/.test(token);
}

/** Order primary keys are UUIDs. The customer list has these, not the raw email token. */
export function isOrderId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function assertOrderTokenShape(token: string): void {
  if (!isOrderToken(token)) {
    throw new HttpError("Order not found", 404);
  }
}
