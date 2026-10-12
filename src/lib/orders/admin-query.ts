import { HttpError } from "./errors";

export const ADMIN_PAGE_DEFAULT = 50;
export const ADMIN_PAGE_MAX = 100;

export function parseAdminListQuery(params: URLSearchParams): {
  status: string | null;
  reviewReason: string | null;
  queue: "evaluation" | null;
  limit: number;
  offset: number;
} {
  const reviewReason = params.get("reviewReason")?.trim() ?? "";
  const queue = params.get("queue");
  if (queue && queue !== "evaluation") throw new HttpError("Unknown queue", 400);
  return {
    status: params.get("status"),
    reviewReason: reviewReason ? reviewReason.slice(0, 200) : null,
    queue: queue === "evaluation" ? "evaluation" : null,
    limit: parseBound(params.get("limit"), "limit", ADMIN_PAGE_DEFAULT, 1, ADMIN_PAGE_MAX),
    offset: parseBound(params.get("offset"), "offset", 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

function parseBound(
  raw: string | null,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw == null || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new HttpError(`${name} must be an integer`, 400);
  const value = Number(raw);
  if (value < min || value > max) {
    throw new HttpError(`${name} must be between ${min} and ${max === Number.MAX_SAFE_INTEGER ? "a safe integer" : max}`, 400);
  }
  return value;
}
