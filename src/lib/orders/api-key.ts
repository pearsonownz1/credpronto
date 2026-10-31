import { createHash, randomBytes } from "node:crypto";
import { HttpError } from "./errors";

export type ApiKeyMode = "live" | "test";
export type ApiKeyPrefix = "cp_live_" | "cp_test_" | "cpk_live_";

export type GeneratedApiKey = {
  secret: string;
  prefix: ApiKeyPrefix;
  last4: string;
  hash: string;
};

export function apiKeyPrefix(mode: ApiKeyMode): ApiKeyPrefix {
  return mode === "live" ? "cp_live_" : "cp_test_";
}

export function hashApiKey(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** Full key is the prefix plus 32 bytes of hex. `last4` is the last 4 characters. */
export function generateApiKey(mode: ApiKeyMode): GeneratedApiKey {
  const prefix = apiKeyPrefix(mode);
  const secret = `${prefix}${randomBytes(32).toString("hex")}`;
  return { secret, prefix, last4: secret.slice(-4), hash: hashApiKey(secret) };
}

/** Fields returned by GET and POST `/api/me/api-keys`. `secret` is added only on create. */
export function publicApiKey(key: {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}) {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    last4: key.last4,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt,
    revokedAt: key.revokedAt,
  };
}

export function parseApiKeyMode(value: unknown): ApiKeyMode {
  if (value === "live" || value === "test") return value;
  throw new HttpError("mode must be live or test", 400, "validation_error");
}

export function parseApiKeyName(value: unknown): string {
  if (typeof value !== "string") throw new HttpError("name is required", 400, "validation_error");
  const name = value.trim();
  if (name.length < 1 || name.length > 80) throw new HttpError("name is required", 400, "validation_error");
  return name;
}

/** Stored prefix, including MCP keys. Anything else is treated as a test key. */
export function storedApiKeyPrefix(value: unknown): ApiKeyPrefix {
  if (value === "cp_live_" || value === "cp_test_" || value === "cpk_live_") return value;
  return "cp_test_";
}

export function bearerApiKey(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(cp_(?:live|test)_[0-9a-f]{64})$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/** Live keys cannot create orders while Stripe is in test mode. */
export function liveOrderPostBlocked(prefix: string, stripeKey: string | undefined): boolean {
  return prefix === "cp_live_" && (stripeKey ?? "").startsWith("sk_test_");
}
