import { browserForm, browserJson, publicMockMode } from "@/lib/api/browser";
import type { ApiResult } from "@/lib/api/types";
import { MAX_FILE_BYTES } from "@/lib/orders/constants";
import { parseShippingAddress } from "@/lib/orders/addons";

const CORRECTION_STATUSES = ["open", "in_progress", "fixed"] as const;
const NOTARIZATION_STATUSES = ["pending", "notarized", "done"] as const;

export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number];
export type NotarizationStatus = (typeof NOTARIZATION_STATUSES)[number];

export type FinalCorrection = {
  id: string;
  orderId: string;
  text: string;
  status: CorrectionStatus;
  finalPath: string | null;
  finalVersion: number | null;
  claimedAt: string | null;
  fixedAt: string | null;
  createdAt: string;
};

export type CorrectionView = { correction: FinalCorrection | null };

export type CorrectionClaim = {
  id: string;
  orderId: string;
  status: "in_progress";
  claimedAt: string;
};

export type CorrectionUpload = {
  id: string;
  orderId: string;
  status: "fixed";
  bucket: string;
  finalPath: string;
  finalVersion: number;
  fixedAt: string;
};

export type NotarizationView = {
  needed: boolean;
  status: NotarizationStatus | null;
};

export type MailingAddress = {
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: "US";
};

export type MailingView = {
  needed: boolean;
  address: MailingAddress | null;
  carrier: string | null;
  trackingNumber: string | null;
  shipped: boolean;
  shippedAt: string | null;
};

export type MailingDraft = {
  name: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  carrier: string;
  trackingNumber: string;
  shipped: boolean;
};

export type MailingPatch = {
  address: MailingAddress;
  carrier: string | null;
  trackingNumber: string | null;
  shipped: boolean;
};

type ClaimClient = (orderId: string) => Promise<ApiResult<CorrectionClaim>>;
type UploadClient = (orderId: string, file: File) => Promise<ApiResult<CorrectionUpload>>;

export type SubmitFixedPdfDeps = {
  claim: ClaimClient;
  upload: UploadClient;
};

export type CorrectionUploadOutcome = {
  correction: FinalCorrection;
  error: string | null;
  message: string | null;
};

const SHAPE_ERROR = "The response was not in the expected shape.";

function orderPath(orderId: string, suffix: string): string {
  return `/api/admin/orders/${encodeURIComponent(orderId)}/${suffix}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => key in record);
}

function nullableString(value: unknown): string | null | undefined {
  if (value == null) return null;
  if (typeof value === "string") return value;
  return undefined;
}

function correctionStatus(value: unknown): CorrectionStatus | null {
  return typeof value === "string" && (CORRECTION_STATUSES as readonly string[]).includes(value)
    ? (value as CorrectionStatus)
    : null;
}

export function isNotarizationStatus(value: string): value is NotarizationStatus {
  return (NOTARIZATION_STATUSES as readonly string[]).includes(value);
}

export function parseFinalCorrection(value: unknown): FinalCorrection | null {
  if (!isRecord(value)) return null;
  if (
    !hasKeys(value, [
      "id",
      "orderId",
      "text",
      "status",
      "finalPath",
      "finalVersion",
      "claimedAt",
      "fixedAt",
      "createdAt",
    ])
  ) {
    return null;
  }
  const status = correctionStatus(value.status);
  const finalPath = nullableString(value.finalPath);
  const claimedAt = nullableString(value.claimedAt);
  const fixedAt = nullableString(value.fixedAt);
  const finalVersion = value.finalVersion == null ? null : value.finalVersion;
  if (
    typeof value.id !== "string" ||
    typeof value.orderId !== "string" ||
    typeof value.text !== "string" ||
    typeof value.createdAt !== "string" ||
    !status ||
    finalPath === undefined ||
    claimedAt === undefined ||
    fixedAt === undefined ||
    !(finalVersion == null || typeof finalVersion === "number")
  ) {
    return null;
  }
  return {
    id: value.id,
    orderId: value.orderId,
    text: value.text,
    status,
    finalPath,
    finalVersion,
    claimedAt,
    fixedAt,
    createdAt: value.createdAt,
  };
}

export function parseCorrectionView(value: unknown): CorrectionView | null {
  if (!isRecord(value) || !("correction" in value)) return null;
  if (value.correction == null) return { correction: null };
  const correction = parseFinalCorrection(value.correction);
  return correction ? { correction } : null;
}

export function parseCorrectionClaim(value: unknown): CorrectionClaim | null {
  if (!isRecord(value) || !hasKeys(value, ["id", "orderId", "status", "claimedAt"])) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.orderId !== "string" ||
    value.status !== "in_progress" ||
    typeof value.claimedAt !== "string"
  ) {
    return null;
  }
  return { id: value.id, orderId: value.orderId, status: "in_progress", claimedAt: value.claimedAt };
}

export function parseCorrectionUpload(value: unknown): CorrectionUpload | null {
  if (!isRecord(value)) return null;
  if (!hasKeys(value, ["id", "orderId", "status", "bucket", "finalPath", "finalVersion", "fixedAt"])) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.orderId !== "string" ||
    value.status !== "fixed" ||
    typeof value.bucket !== "string" ||
    typeof value.finalPath !== "string" ||
    typeof value.finalVersion !== "number" ||
    typeof value.fixedAt !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    orderId: value.orderId,
    status: "fixed",
    bucket: value.bucket,
    finalPath: value.finalPath,
    finalVersion: value.finalVersion,
    fixedAt: value.fixedAt,
  };
}

function parseAddress(value: unknown): MailingAddress | null | undefined {
  if (value == null) return null;
  if (!isRecord(value)) return undefined;
  if (!hasKeys(value, ["name", "line1", "line2", "city", "state", "postalCode", "country"])) return undefined;
  const line2 = nullableString(value.line2);
  if (
    typeof value.name !== "string" ||
    typeof value.line1 !== "string" ||
    typeof value.city !== "string" ||
    typeof value.state !== "string" ||
    typeof value.postalCode !== "string" ||
    value.country !== "US" ||
    line2 === undefined
  ) {
    return undefined;
  }
  return {
    name: value.name,
    line1: value.line1,
    line2,
    city: value.city,
    state: value.state,
    postalCode: value.postalCode,
    country: "US",
  };
}

export function parseNotarizationView(value: unknown): NotarizationView | null {
  if (!isRecord(value) || typeof value.needed !== "boolean" || !("status" in value)) return null;
  if (value.status == null) return { needed: value.needed, status: null };
  if (typeof value.status !== "string" || !isNotarizationStatus(value.status)) return null;
  return { needed: value.needed, status: value.status };
}

export function parseMailingView(value: unknown): MailingView | null {
  if (!isRecord(value)) return null;
  if (!hasKeys(value, ["needed", "address", "carrier", "trackingNumber", "shipped", "shippedAt"])) return null;
  const address = parseAddress(value.address);
  const carrier = nullableString(value.carrier);
  const trackingNumber = nullableString(value.trackingNumber);
  const shippedAt = nullableString(value.shippedAt);
  if (
    typeof value.needed !== "boolean" ||
    typeof value.shipped !== "boolean" ||
    address === undefined ||
    carrier === undefined ||
    trackingNumber === undefined ||
    shippedAt === undefined
  ) {
    return null;
  }
  return { needed: value.needed, address, carrier, trackingNumber, shipped: value.shipped, shippedAt };
}

function parsedResult<T>(result: ApiResult<unknown>, parse: (value: unknown) => T | null): ApiResult<T> {
  if (!result.ok) return result;
  const data = parse(result.data);
  if (!data) return { ok: false, status: 502, error: SHAPE_ERROR };
  return { ok: true, status: result.status, data };
}

export function fixedPdfFileError(file: File | null): string | null {
  if (!file || file.name.trim() === "") return "Choose a PDF.";
  if (file.size === 0) return "Empty files are not accepted";
  if (file.size > MAX_FILE_BYTES) return "Each file must be 25MB or smaller";
  const pdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!pdf) return "Upload a PDF";
  return null;
}

export function correctionAfterClaim(correction: FinalCorrection, claim: CorrectionClaim): FinalCorrection {
  return { ...correction, id: claim.id, orderId: claim.orderId, status: "in_progress", claimedAt: claim.claimedAt };
}

export function correctionAfterUpload(correction: FinalCorrection, upload: CorrectionUpload): FinalCorrection {
  return {
    ...correction,
    id: upload.id,
    orderId: upload.orderId,
    status: "fixed",
    finalPath: upload.finalPath,
    finalVersion: upload.finalVersion,
    fixedAt: upload.fixedAt,
  };
}

export function mailingDraftFrom(mailing: MailingView): MailingDraft {
  return {
    name: mailing.address?.name ?? "",
    line1: mailing.address?.line1 ?? "",
    line2: mailing.address?.line2 ?? "",
    city: mailing.address?.city ?? "",
    state: mailing.address?.state ?? "",
    postalCode: mailing.address?.postalCode ?? "",
    country: mailing.address?.country ?? "US",
    carrier: mailing.carrier ?? "",
    trackingNumber: mailing.trackingNumber ?? "",
    shipped: mailing.shipped,
  };
}

export function mailingPatchFrom(draft: MailingDraft): { ok: true; body: MailingPatch } | { ok: false; error: string } {
  const carrier = draft.carrier.trim();
  const trackingNumber = draft.trackingNumber.trim();
  if (carrier.length > 40) return { ok: false, error: "carrier must be 40 characters or fewer" };
  if (trackingNumber.length > 80) return { ok: false, error: "trackingNumber must be 80 characters or fewer" };
  try {
    const address = parseShippingAddress({
      name: draft.name,
      line1: draft.line1,
      line2: draft.line2.trim() ? draft.line2 : null,
      city: draft.city,
      state: draft.state,
      postalCode: draft.postalCode,
      country: draft.country,
    });
    return {
      ok: true,
      body: {
        address,
        carrier: carrier || null,
        trackingNumber: trackingNumber || null,
        shipped: draft.shipped,
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error && error.message ? error.message : "Mail requires a US shipping address" };
  }
}

export async function submitFixedPdf(
  input: { orderId: string; status: CorrectionStatus; file: File },
  deps: SubmitFixedPdfDeps = { claim: claimOrderCorrection, upload: uploadOrderCorrectionFinal },
): Promise<
  | { ok: true; claim: CorrectionClaim | null; upload: CorrectionUpload }
  | { ok: false; error: string; status: number; claimed: CorrectionClaim | null }
> {
  if (input.status === "fixed") {
    return { ok: false, error: "This correction is already fixed", status: 409, claimed: null };
  }
  let claimed: CorrectionClaim | null = null;
  if (input.status === "open") {
    const claim = await deps.claim(input.orderId);
    if (!claim.ok) return { ok: false, error: claim.error, status: claim.status, claimed: null };
    claimed = claim.data;
  }
  const uploaded = await deps.upload(input.orderId, input.file);
  if (!uploaded.ok) return { ok: false, error: uploaded.error, status: uploaded.status, claimed };
  return { ok: true, claim: claimed, upload: uploaded.data };
}

/** Claim an open request, then store the PDF. A 409 on claim does not upload. */
export async function runCorrectionUpload(
  input: { orderId: string; correction: FinalCorrection; file: File | null },
  deps?: SubmitFixedPdfDeps,
): Promise<CorrectionUploadOutcome> {
  const problem = fixedPdfFileError(input.file);
  if (problem || !input.file) {
    return { correction: input.correction, error: problem ?? "Choose a PDF.", message: null };
  }
  const result = await submitFixedPdf(
    { orderId: input.orderId, status: input.correction.status, file: input.file },
    deps,
  );
  if (!result.ok) {
    return {
      correction: result.claimed ? correctionAfterClaim(input.correction, result.claimed) : input.correction,
      error: result.error,
      message: null,
    };
  }
  const claimed = result.claim ? correctionAfterClaim(input.correction, result.claim) : input.correction;
  return {
    correction: correctionAfterUpload(claimed, result.upload),
    error: null,
    message: "Fixed PDF uploaded.",
  };
}

export async function getOrderCorrection(orderId: string): Promise<ApiResult<CorrectionView>> {
  if (publicMockMode()) return { ok: true, status: 200, data: { correction: mockState(orderId).correction } };
  const result = await browserJson<unknown>(orderPath(orderId, "correction"), { method: "GET", cache: "no-store" });
  return parsedResult(result, parseCorrectionView);
}

export async function claimOrderCorrection(orderId: string): Promise<ApiResult<CorrectionClaim>> {
  if (publicMockMode()) return mockClaim(orderId);
  const result = await browserJson<unknown>(orderPath(orderId, "correction/claim"), { method: "POST" });
  return parsedResult(result, parseCorrectionClaim);
}

export async function uploadOrderCorrectionFinal(orderId: string, file: File): Promise<ApiResult<CorrectionUpload>> {
  if (publicMockMode()) return mockUpload(orderId);
  const body = new FormData();
  body.set("file", file);
  const result = await browserForm<unknown>(orderPath(orderId, "correction/final"), body);
  return parsedResult(result, parseCorrectionUpload);
}

export async function getOrderNotarization(orderId: string): Promise<ApiResult<NotarizationView>> {
  if (publicMockMode()) return { ok: true, status: 200, data: mockState(orderId).notarization };
  const result = await browserJson<unknown>(orderPath(orderId, "notarization"), { method: "GET", cache: "no-store" });
  return parsedResult(result, parseNotarizationView);
}

export async function patchOrderNotarization(
  orderId: string,
  body: { status: NotarizationStatus },
): Promise<ApiResult<NotarizationView>> {
  if (publicMockMode()) return mockPatchNotarization(orderId, body.status);
  const result = await browserJson<unknown>(orderPath(orderId, "notarization"), {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return parsedResult(result, parseNotarizationView);
}

export async function getOrderMailing(orderId: string): Promise<ApiResult<MailingView>> {
  if (publicMockMode()) return { ok: true, status: 200, data: mockState(orderId).mailing };
  const result = await browserJson<unknown>(orderPath(orderId, "mailing"), { method: "GET", cache: "no-store" });
  return parsedResult(result, parseMailingView);
}

export async function patchOrderMailing(orderId: string, body: MailingPatch): Promise<ApiResult<MailingView>> {
  if (publicMockMode()) return mockPatchMailing(orderId, body);
  const result = await browserJson<unknown>(orderPath(orderId, "mailing"), {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return parsedResult(result, parseMailingView);
}

export async function saveOrderMailing(orderId: string, draft: MailingDraft): Promise<ApiResult<MailingView>> {
  const patch = mailingPatchFrom(draft);
  if (!patch.ok) return { ok: false, status: 400, error: patch.error };
  return patchOrderMailing(orderId, patch.body);
}

type MockBundle = {
  correction: FinalCorrection | null;
  /** Read still says open, but claim loses. Mirrors a second sweep. */
  claimConflict: boolean;
  notarization: NotarizationView;
  mailing: MailingView;
};

const mockBundles = new Map<string, MockBundle>();

function emptyMailing(): MailingView {
  return { needed: false, address: null, carrier: null, trackingNumber: null, shipped: false, shippedAt: null };
}

function populatedBundle(orderId: string): MockBundle {
  return {
    claimConflict: false,
    correction: {
      id: `corr-${orderId}`,
      orderId,
      text: "The date on the diploma is wrong.",
      status: "open",
      finalPath: null,
      finalVersion: null,
      claimedAt: null,
      fixedAt: null,
      createdAt: "2026-10-23T15:00:00.000Z",
    },
    notarization: { needed: true, status: "pending" },
    mailing: {
      needed: true,
      address: {
        name: "Ada Lovelace",
        line1: "2520 Venture Oaks Way",
        line2: "Suite 120",
        city: "Sacramento",
        state: "CA",
        postalCode: "95833",
        country: "US",
      },
      carrier: null,
      trackingNumber: null,
      shipped: false,
      shippedAt: null,
    },
  };
}

function mockState(orderId: string): MockBundle {
  const existing = mockBundles.get(orderId);
  if (existing) return existing;
  let bundle: MockBundle;
  if (orderId === "CP-24790") bundle = populatedBundle(orderId);
  else if (orderId === "CP-24902") {
    bundle = populatedBundle(orderId);
    bundle.claimConflict = true;
    if (bundle.correction) bundle.correction = { ...bundle.correction, text: "The seal on page 2 is cut off." };
    bundle.notarization = { needed: false, status: null };
    bundle.mailing = emptyMailing();
  } else {
    bundle = {
      correction: null,
      claimConflict: false,
      notarization: { needed: false, status: null },
      mailing: emptyMailing(),
    };
  }
  mockBundles.set(orderId, bundle);
  return bundle;
}

function mockClaim(orderId: string): ApiResult<CorrectionClaim> {
  const bundle = mockState(orderId);
  if (!bundle.correction) return { ok: false, status: 404, error: "This order has no correction request" };
  if (bundle.claimConflict || bundle.correction.status !== "open") {
    return { ok: false, status: 409, error: "This correction is not open" };
  }
  const claimedAt = new Date().toISOString();
  bundle.correction = { ...bundle.correction, status: "in_progress", claimedAt };
  return {
    ok: true,
    status: 200,
    data: { id: bundle.correction.id, orderId, status: "in_progress", claimedAt },
  };
}

function mockUpload(orderId: string): ApiResult<CorrectionUpload> {
  const bundle = mockState(orderId);
  if (!bundle.correction) return { ok: false, status: 404, error: "This order has no correction request" };
  if (bundle.correction.status === "open") {
    return { ok: false, status: 409, error: "Claim the correction before uploading a fix" };
  }
  if (bundle.correction.status === "fixed") {
    return { ok: false, status: 409, error: "This correction is already fixed" };
  }
  const fixedAt = new Date().toISOString();
  const finalPath = `${orderId}/corrected-final-v2.pdf`;
  bundle.correction = {
    ...bundle.correction,
    status: "fixed",
    finalPath,
    finalVersion: 2,
    fixedAt,
  };
  return {
    ok: true,
    status: 200,
    data: {
      id: bundle.correction.id,
      orderId,
      status: "fixed",
      bucket: "finals",
      finalPath,
      finalVersion: 2,
      fixedAt,
    },
  };
}

function mockPatchNotarization(orderId: string, status: NotarizationStatus): ApiResult<NotarizationView> {
  const bundle = mockState(orderId);
  if (!bundle.notarization.needed) return { ok: false, status: 409, error: "This order has no notarization add-on" };
  bundle.notarization = { needed: true, status };
  return { ok: true, status: 200, data: bundle.notarization };
}

function mockPatchMailing(orderId: string, patch: MailingPatch): ApiResult<MailingView> {
  const bundle = mockState(orderId);
  if (!bundle.mailing.needed) return { ok: false, status: 409, error: "This order has no mail add-on" };
  const shippedAt = patch.shipped ? bundle.mailing.shippedAt ?? new Date().toISOString() : null;
  bundle.mailing = {
    needed: true,
    address: patch.address,
    carrier: patch.carrier,
    trackingNumber: patch.trackingNumber,
    shipped: patch.shipped,
    shippedAt,
  };
  return { ok: true, status: 200, data: bundle.mailing };
}

export function resetMockOrderFulfillment(): void {
  mockBundles.clear();
}
