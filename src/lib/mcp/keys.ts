import { randomBytes } from "node:crypto";
import { hashApiKey, type ApiKeyPrefix, type GeneratedApiKey } from "@/lib/orders/api-key";

export const MCP_KEY_PREFIX = "cpk_live_" as const satisfies ApiKeyPrefix;

/** Full key is shown once. Only the sha256 is stored. */
export function generateMcpApiKey(): GeneratedApiKey {
  const secret = `${MCP_KEY_PREFIX}${randomBytes(32).toString("hex")}`;
  return { secret, prefix: MCP_KEY_PREFIX, last4: secret.slice(-4), hash: hashApiKey(secret) };
}

export function bearerMcpApiKey(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(cpk_live_[0-9a-f]{64})$/i.exec(header.trim());
  if (!match?.[1]) return null;
  return match[1].toLowerCase();
}

export function partitionApiKeys<T extends { prefix: string }>(keys: readonly T[]): { partner: T[]; mcp: T[] } {
  return {
    partner: keys.filter((key) => key.prefix === "cp_live_" || key.prefix === "cp_test_"),
    mcp: keys.filter((key) => key.prefix === MCP_KEY_PREFIX),
  };
}
