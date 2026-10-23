import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { readJson } from "@/lib/auth/body";
import { PRE_EVALUATIONS_BUCKET } from "@/lib/orders/constants";
import { appOrigin, sendPreEvaluationResult } from "@/lib/orders/email";
import { HttpError } from "@/lib/orders/errors";
import { extractPrintedCredentials } from "@/lib/orders/evaluation";
import { assertEmail } from "@/lib/orders/files";
import { pdfPageTexts } from "@/lib/orders/pdf-text";
import { downloadObject, uploadObject, type Db } from "@/lib/orders/storage";
import { generateOrderToken, hashOrderToken, isOrderToken } from "@/lib/orders/token";
import { PRE_EVAL_STALE_MS, type PreEvalMime } from "./constants";
import {
  claimPreEvaluation,
  claimResultEmail,
  clearResultEmailClaim,
  countPreEvaluationEmailsByIp,
  countPreEvaluationsByIp,
  failPreEvaluation,
  finishPreEvaluation,
  insertPreEvaluation,
  preEvaluationById,
  preEvaluationByTokenHash,
  savePreEvaluationEmail,
  type PreEvaluationRecord,
} from "./db";
import { assertPreEvalFile, readPreEvalMultipart } from "./files";
import { assertDailyAllowance, assertPreEvalBurst, requestIpHash, utcDayStart } from "./rate-limit";
import { suggestPrintedCredentials } from "./suggest";
import {
  absoluteAppUrl,
  confidenceLabel,
  orderPrefill,
  preEvaluationPreviewPath,
  preEvaluationResultPath,
  preEvaluationSignupPath,
  prefillService,
  publicPreEvaluation,
  shownEquivalent,
  type PreEvalPrefill,
  type PreEvalPublic,
} from "./view";

type Hooks = {
  schedule?: (internalId: string) => void;
  now?: Date;
  origin?: string;
};

function assertPublicId(id: string): string {
  const token = id.trim();
  if (!isOrderToken(token)) throw new HttpError("Pre-evaluation not found", 404);
  return token;
}

async function load(db: Db, publicId: string): Promise<{ token: string; record: PreEvaluationRecord }> {
  const token = assertPublicId(publicId);
  const record = await preEvaluationByTokenHash(db, hashOrderToken(token));
  if (!record) throw new HttpError("Pre-evaluation not found", 404);
  return { token, record };
}

function enqueue(db: Db, internalId: string, schedule?: (internalId: string) => void): void {
  if (schedule) {
    schedule(internalId);
    return;
  }
  after(() => completePreEvaluation(db, internalId));
}

function resume(db: Db, record: PreEvaluationRecord, schedule?: (internalId: string) => void): void {
  if (record.status !== "processing") return;
  if (record.suggestionStartedAt) {
    const started = Date.parse(record.suggestionStartedAt);
    if (Number.isFinite(started) && Date.now() - started < PRE_EVAL_STALE_MS) return;
  }
  enqueue(db, record.id, schedule);
}

async function documentText(bytes: Uint8Array, mime: string): Promise<string> {
  if (mime !== "application/pdf") return "";
  try {
    const pages = await pdfPageTexts(bytes);
    return pages.slice(0, 8).join("\n");
  } catch {
    return "";
  }
}

async function deliverResultEmail(db: Db, record: PreEvaluationRecord, now: Date): Promise<void> {
  if (!record.email || record.status !== "ready" || record.resultEmailSentAt) return;
  if (!record.usEquivalency || !record.confidence) return;
  const nowIso = now.toISOString();
  const claimed = await claimResultEmail(db, record.id, nowIso);
  if (!claimed) return;
  const service = prefillService(record.documentKind);
  const sent = await sendPreEvaluationResult(record.email, {
    equivalent: shownEquivalent(record.usEquivalency),
    confidenceLabel: confidenceLabel(record.confidence),
    rationale: record.rationale ?? "This is a free suggestion, not an official evaluation.",
    resultUrl: absoluteAppUrl(preEvaluationResultPath(record.accessToken)),
    officialUrl: absoluteAppUrl(preEvaluationSignupPath(record.accessToken, record.email, service)),
  });
  if (!sent.sent) {
    try {
      await clearResultEmailClaim(db, record.id, nowIso);
    } catch {
      console.error("pre-evaluation email failed");
    }
  }
}

export async function completePreEvaluation(db: Db, internalId: string, now = new Date()): Promise<void> {
  let claimed: PreEvaluationRecord | null = null;
  try {
    claimed = await claimPreEvaluation(db, internalId, now.toISOString());
  } catch {
    console.error("pre-evaluation suggestion failed");
    return;
  }
  if (!claimed) return;
  try {
    const bytes = await downloadObject(db, PRE_EVALUATIONS_BUCKET, claimed.storagePath);
    const text = await documentText(bytes, claimed.mime);
    const printed = await extractPrintedCredentials({ text, file: { bytes, mime: claimed.mime } });
    const suggestion = await suggestPrintedCredentials(db, printed);
    await finishPreEvaluation(db, claimed.id, suggestion, new Date().toISOString());
  } catch {
    console.error("pre-evaluation suggestion failed");
    try {
      await failPreEvaluation(db, claimed.id, new Date().toISOString());
    } catch {
      console.error("pre-evaluation suggestion failed");
    }
    return;
  }
  try {
    const fresh = await preEvaluationById(db, claimed.id);
    if (fresh) await deliverResultEmail(db, fresh, new Date());
  } catch {
    console.error("pre-evaluation email failed");
  }
}

export async function startPreEvaluation(
  db: Db,
  request: Request,
  hooks?: Hooks,
): Promise<{ id: string }> {
  const now = hooks?.now ?? new Date();
  const ipHash = requestIpHash(request);
  assertPreEvalBurst(ipHash, "upload", now.getTime());
  const uploads = await countPreEvaluationsByIp(db, ipHash, utcDayStart(now));
  assertDailyAllowance(uploads, "upload", now);
  const uploaded = await readPreEvalMultipart(request);
  const file = assertPreEvalFile(uploaded);
  const internalId = randomUUID();
  const accessToken = generateOrderToken();
  const storagePath = `${internalId}/${file.filename}`;
  try {
    await uploadObject(db, PRE_EVALUATIONS_BUCKET, storagePath, file.bytes, file.mime);
  } catch {
    console.error("pre-evaluation upload failed");
    throw new HttpError("Could not store the upload", 503);
  }
  await insertPreEvaluation(db, {
    id: internalId,
    tokenHash: hashOrderToken(accessToken),
    accessToken,
    storagePath,
    filename: file.filename,
    mime: file.mime,
    sizeBytes: file.bytes.byteLength,
    ipHash,
  });
  enqueue(db, internalId, hooks?.schedule);
  return { id: accessToken };
}

export async function readPreEvaluation(
  db: Db,
  publicId: string,
  request: Request,
  hooks?: Hooks,
): Promise<PreEvalPublic> {
  const now = hooks?.now ?? new Date();
  assertPreEvalBurst(requestIpHash(request), "read", now.getTime());
  const { token, record } = await load(db, publicId);
  resume(db, record, hooks?.schedule);
  if (record.email && record.status === "ready") await deliverResultEmail(db, record, now);
  const origin = hooks?.origin ?? appOrigin();
  const previewUrl =
    record.email && record.status === "ready" ? absoluteAppUrl(preEvaluationPreviewPath(token), origin) : null;
  return publicPreEvaluation(record, previewUrl);
}

function emailFromBody(body: unknown): string {
  if (!body || typeof body !== "object") throw new HttpError("Expected a JSON body", 400);
  const email = (body as { email?: unknown }).email;
  if (typeof email !== "string") throw new HttpError("Enter a valid email address", 400);
  return email;
}

export async function submitPreEvaluationEmail(
  db: Db,
  publicId: string,
  request: Request,
  hooks?: Hooks,
): Promise<{ ok: true }> {
  const now = hooks?.now ?? new Date();
  const token = assertPublicId(publicId);
  const tokenHash = hashOrderToken(token);
  const ipHash = requestIpHash(request);
  assertPreEvalBurst(ipHash, "email", now.getTime());
  assertPreEvalBurst(tokenHash, "email", now.getTime());
  const email = assertEmail(emailFromBody(await readJson(request)));
  const existing = await preEvaluationByTokenHash(db, tokenHash);
  if (!existing) throw new HttpError("Pre-evaluation not found", 404);
  if (existing.email && existing.email.toLowerCase() === email.toLowerCase()) {
    await deliverResultEmail(db, existing, now);
    return { ok: true };
  }
  if (existing.email) throw new HttpError("This suggestion is already tied to an email", 409);
  const sentToday = await countPreEvaluationEmailsByIp(db, ipHash, utcDayStart(now));
  assertDailyAllowance(sentToday, "email", now);
  const saved = await savePreEvaluationEmail(db, tokenHash, email, now.toISOString());
  if (saved === "missing") throw new HttpError("Pre-evaluation not found", 404);
  const fresh = await preEvaluationByTokenHash(db, tokenHash);
  if (!fresh?.email || fresh.email.toLowerCase() !== email.toLowerCase()) {
    throw new HttpError("This suggestion is already tied to an email", 409);
  }
  resume(db, fresh, hooks?.schedule);
  await deliverResultEmail(db, fresh, now);
  return { ok: true };
}

export async function readPreEvaluationPreview(
  db: Db,
  publicId: string,
  request: Request,
  now = new Date(),
): Promise<{ bytes: Uint8Array; mime: PreEvalMime }> {
  assertPreEvalBurst(requestIpHash(request), "read", now.getTime());
  const { record } = await load(db, publicId);
  if (!record.email || record.status !== "ready") throw new HttpError("Pre-evaluation not found", 404);
  try {
    const bytes = await downloadObject(db, PRE_EVALUATIONS_BUCKET, record.storagePath);
    return { bytes, mime: record.mime };
  } catch {
    console.error("pre-evaluation preview failed");
    throw new HttpError("Pre-evaluation not found", 404);
  }
}

export async function readPreEvaluationPrefill(
  db: Db,
  publicId: string,
  request: Request,
  now = new Date(),
): Promise<PreEvalPrefill> {
  assertPreEvalBurst(requestIpHash(request), "read", now.getTime());
  const { token, record } = await load(db, publicId);
  const prefill = orderPrefill(record, token);
  if (!prefill) throw new HttpError("Enter your email to see this suggestion", 409, "email_required");
  return prefill;
}

export function previewDownloadName(mime: PreEvalMime): string {
  if (mime === "image/jpeg") return "document.jpg";
  if (mime === "image/png") return "document.png";
  return "document.pdf";
}
