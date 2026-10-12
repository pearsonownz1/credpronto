import { HttpError } from "./errors";

export const ADMIN_PAGE_DEFAULT = 50;
export const ADMIN_PAGE_MAX = 100;

export function parseAdminListQuery(params: URLSearchParams): {
  status: string | null;
  limit: number;
  offset: number;
} {
  return {
    status: params.get("status"),
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
