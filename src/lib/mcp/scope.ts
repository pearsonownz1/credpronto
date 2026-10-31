import { HttpError } from "@/lib/orders/errors";
import { isMcpHold } from "@/lib/orders/mcp-hold";

const IDENTITY = new Set(["ssn", "socialsecurity", "socialsecuritynumber", "dob", "dateofbirth", "birthdate"]);

function compactKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z]/g, "");
}

/** MCP tools do not accept or store SSN or date of birth. */
export function rejectIdentityFields(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) rejectIdentityFields(item);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (IDENTITY.has(compactKey(key))) {
      throw new HttpError("This field is not accepted", 400, "validation_error");
    }
    if (child && typeof child === "object") rejectIdentityFields(child);
  }
}

export function assertMcpOrder<T extends { userId: string | null; externalRef?: string | null }>(
  order: T | null,
  userId: string,
): T {
  if (!order || order.userId !== userId || isMcpHold(order.externalRef)) {
    throw new HttpError("Order not found", 404, "not_found");
  }
  return order;
}
