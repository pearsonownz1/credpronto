import { appOrigin } from "./email";
import { cronAuthorized } from "./translation-watch";

export const TRANSLATION_PAGE_PATH = "/api/internal/translation/page";
export const TRANSLATION_ASSEMBLE_PATH = "/api/internal/translation/assemble";

export type TranslationPageRequest = {
  orderId: string;
  version: number;
  jobId: string;
};

export type TranslationAssembleRequest = {
  orderId: string;
  version: number;
};

/** The deployment calls itself. Preview deployments use VERCEL_URL rather than the production APP_URL. */
export function internalOrigin(): string {
  if (process.env.VERCEL_ENV === "production") return appOrigin(); // production must call its public domain; *.vercel.app sits behind Deployment Protection
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    const host = vercel.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return `https://${host}`;
  }
  return appOrigin();
}

export function internalTranslationAuthorized(authorization: string | null): boolean {
  return cronAuthorized(authorization, process.env.CRON_SECRET);
}

export function parseTranslationPageRequest(body: unknown): TranslationPageRequest | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  if (typeof row.orderId !== "string" || typeof row.jobId !== "string") return null;
  if (typeof row.version !== "number" || !Number.isInteger(row.version) || row.version < 1) return null;
  return { orderId: row.orderId, version: row.version, jobId: row.jobId };
}

export function parseTranslationAssembleRequest(body: unknown): TranslationAssembleRequest | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  if (typeof row.orderId !== "string") return null;
  if (typeof row.version !== "number" || !Number.isInteger(row.version) || row.version < 1) return null;
  return { orderId: row.orderId, version: row.version };
}

/** Starts another function and returns when that function accepts the work. */
export async function dispatchTranslation(path: string, body: TranslationPageRequest | TranslationAssembleRequest): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not set");
  const headers: Record<string, string> = {
    authorization: `Bearer ${secret}`,
    "content-type": "application/json",
  };
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  }
  const response = await fetch(`${internalOrigin()}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Translation dispatch failed (${response.status}): ${text.slice(0, 200)}`);
  }
}
