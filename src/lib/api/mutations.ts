import { browserForm, browserJson, publicMockMode } from "@/lib/api/browser";
import { type ApiResult, type StaffNote } from "@/lib/api/types";

export type PageEdit = { documentId: string; pageNumber: number; paragraphs: string[] };

export async function patchOrderTranslation(id: string, pages: PageEdit[]): Promise<ApiResult<unknown>> {
  if (publicMockMode()) return { ok: true, status: 200, data: { status: "saved" } };
  return browserJson(`/api/admin/orders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ pages }),
  });
}

export async function regenerateEvaluations(id: string): Promise<ApiResult<unknown>> {
  if (publicMockMode()) return { ok: true, status: 200, data: { status: "unchanged", generated: [], pending: [] } };
  return browserJson(`/api/admin/orders/${encodeURIComponent(id)}/evaluations`, { method: "POST" });
}

export async function regenerateOrder(id: string): Promise<ApiResult<unknown>> {
  if (publicMockMode()) return { ok: true, status: 200, data: { status: "preview_ready" } };
  return browserJson(`/api/admin/orders/${encodeURIComponent(id)}/resolve-corrections`, {
    method: "POST",
    body: JSON.stringify({ action: "regenerate" }),
  });
}

export async function assignEquivalency(
  id: string,
  body: { equivalencies: string[]; countries?: string[]; fields?: string[]; dates?: string[] },
): Promise<ApiResult<unknown>> {
  if (publicMockMode()) return { ok: true, status: 200, data: { reviewReason: null } };
  return browserJson(`/api/admin/orders/${encodeURIComponent(id)}/resolve-review`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function resolveReview(id: string, sourceLanguage: string): Promise<ApiResult<unknown>> {
  if (publicMockMode()) return { ok: true, status: 200, data: { status: "quoted" } };
  return browserJson(`/api/admin/orders/${encodeURIComponent(id)}/resolve-review`, {
    method: "POST",
    body: JSON.stringify(sourceLanguage ? { sourceLanguage } : {}),
  });
}

export async function uploadEvaluationReport(
  id: string,
  service: "diploma" | "course_by_course",
  file: File,
): Promise<ApiResult<unknown>> {
  if (publicMockMode()) {
    return { ok: true, status: 200, data: { status: "delivered", email: "skipped" } };
  }
  const body = new FormData();
  body.set("file", file);
  body.set("service", service);
  return browserForm(`/api/admin/orders/${encodeURIComponent(id)}/evaluation`, body);
}

export async function setEvaluationStatus(id: string, status: string): Promise<ApiResult<unknown>> {
  if (publicMockMode()) return { ok: true, status: 200, data: { evaluationStatus: status, emailed: false } };
  return browserJson(`/api/admin/orders/${encodeURIComponent(id)}/evaluation-status`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

export async function approveOrder(id: string): Promise<ApiResult<unknown>> {
  if (publicMockMode()) {
    return { ok: true, status: 200, data: { status: "delivered", email: "skipped" } };
  }
  return browserJson(`/api/admin/orders/${encodeURIComponent(id)}/approve`, { method: "POST" });
}

export type StaffOrderFile = { kind: string; path: string; filename: string };

export async function listOrderFiles(id: string): Promise<ApiResult<{ files: StaffOrderFile[] }>> {
  if (publicMockMode()) return { ok: true, status: 200, data: { files: [] } };
  return browserJson(`/api/admin/orders/${encodeURIComponent(id)}/files`, { method: "GET" });
}

export async function downloadOrderFile(
  id: string,
  path: string,
): Promise<ApiResult<{ url: string; filename: string; expiresInSeconds: number }>> {
  if (publicMockMode()) return { ok: false, status: 503, error: "Downloads are off in mock mode" };
  return browserJson(`/api/admin/orders/${encodeURIComponent(id)}/files`, {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export async function refundOrder(
  id: string,
): Promise<ApiResult<{ paymentStatus?: string; duplicate?: boolean; mode?: string; refundId?: string }>> {
  if (publicMockMode()) {
    return { ok: true, status: 200, data: { paymentStatus: "refunded", duplicate: false, mode: "paid_test" } };
  }
  return browserJson(`/api/admin/orders/${encodeURIComponent(id)}/refund`, { method: "POST" });
}

export async function shipOrder(
  id: string,
  trackingNumber: string,
): Promise<ApiResult<{ task: string; status: string; trackingNumber: string }>> {
  if (publicMockMode()) {
    return { ok: true, status: 200, data: { task: "mail", status: "shipped", trackingNumber } };
  }
  return browserJson(`/api/admin/orders/${encodeURIComponent(id)}/ship`, {
    method: "POST",
    body: JSON.stringify({ trackingNumber }),
  });
}

export async function notarizeOrder(
  id: string,
): Promise<ApiResult<{ task: string; status: string; duplicate?: boolean }>> {
  if (publicMockMode()) {
    return { ok: true, status: 200, data: { task: "notarization", status: "done" } };
  }
  return browserJson(`/api/admin/orders/${encodeURIComponent(id)}/notarize`, { method: "POST" });
}

export async function addNote(id: string, body: string): Promise<ApiResult<StaffNote>> {
  if (publicMockMode()) {
    return {
      ok: true,
      status: 201,
      data: { id: `note-${Date.now()}`, authorId: "you", body, createdAt: new Date().toISOString() },
    };
  }
  return browserJson(`/api/admin/orders/${encodeURIComponent(id)}/notes`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}
