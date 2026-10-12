import { browserJson, publicMockMode } from "@/lib/api/browser";
import type { ApiResult, StaffNote } from "@/lib/api/types";

export type PageEdit = { documentId: string; pageNumber: number; paragraphs: string[] };

export async function patchOrderTranslation(id: string, pages: PageEdit[]): Promise<ApiResult<unknown>> {
  if (publicMockMode()) return { ok: true, status: 200, data: { status: "saved" } };
  return browserJson(`/api/admin/orders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ pages }),
  });
}

export async function regenerateOrder(id: string): Promise<ApiResult<unknown>> {
  if (publicMockMode()) return { ok: true, status: 200, data: { status: "preview_ready" } };
  return browserJson(`/api/admin/orders/${encodeURIComponent(id)}/resolve-corrections`, {
    method: "POST",
    body: JSON.stringify({ action: "regenerate" }),
  });
}

export async function resolveReview(id: string, sourceLanguage: string): Promise<ApiResult<unknown>> {
  if (publicMockMode()) return { ok: true, status: 200, data: { status: "quoted" } };
  return browserJson(`/api/admin/orders/${encodeURIComponent(id)}/resolve-review`, {
    method: "POST",
    body: JSON.stringify(sourceLanguage ? { sourceLanguage } : {}),
  });
}

export async function approveOrder(id: string): Promise<ApiResult<unknown>> {
  if (publicMockMode()) {
    return { ok: true, status: 200, data: { status: "delivered", email: "skipped" } };
  }
  return browserJson(`/api/admin/orders/${encodeURIComponent(id)}/approve`, { method: "POST" });
}

export async function refundOrder(
  id: string,
): Promise<ApiResult<{ paymentStatus?: string; duplicate?: boolean; mode?: string; refundId?: string }>> {
  if (publicMockMode()) {
    return { ok: true, status: 200, data: { paymentStatus: "refunded", duplicate: false, mode: "paid_test" } };
  }
  return browserJson(`/api/admin/orders/${encodeURIComponent(id)}/refund`, { method: "POST" });
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
