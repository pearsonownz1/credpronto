import { cookies } from "next/headers";
import { connection } from "next/server";
import { parseAdminList, parseCustomerOrders, parseEvaluationQueue, parseNotes, parseStaffDetail } from "@/lib/api/parse";
import { errorMessage, type AdminList, type ApiResult, type CustomerOrder, type StaffDetail, type StaffNote } from "@/lib/api/types";
import { mockAdminList, mockEvaluationSources, mockNotes, mockOrdersFor, mockStaffDetail } from "@/lib/account/mock-data";
import { evaluationQueueRows } from "@/lib/orders/evaluation-queue";
import type { EvaluationQueueOrder } from "@/lib/orders/evaluation-review";
import { currentOrigin, getAccount, isMockMode } from "@/lib/account/session";

export function adminOrdersPath(query: {
  status?: string | null;
  reviewReason?: string | null;
  limit?: number;
  offset?: number;
} = {}): string {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.reviewReason) params.set("reviewReason", query.reviewReason);
  if (query.limit != null) params.set("limit", String(query.limit));
  if (query.offset != null) params.set("offset", String(query.offset));
  const qs = params.toString();
  return qs ? `/api/admin/orders?${qs}` : "/api/admin/orders";
}

async function serverResult(path: string, init?: RequestInit): Promise<ApiResult<unknown>> {
  try {
    const origin = await currentOrigin();
    const cookie = (await cookies()).toString();
    const response = await fetch(new URL(path, origin), {
      ...init,
      headers: {
        accept: "application/json",
        cookie,
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
      cache: "no-store",
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, status: response.status, error: errorMessage(body, response.status) };
    return { ok: true, status: response.status, data: body };
  } catch {
    return { ok: false, status: 503, error: "Request failed" };
  }
}

export async function listMyOrders(): Promise<ApiResult<{ orders: CustomerOrder[] }>> {
  if (isMockMode()) {
    await connection();
    const account = await getAccount();
    if (!account) return { ok: false, status: 401, error: "Sign in required" };
    return { ok: true, status: 200, data: { orders: mockOrdersFor(account.email, Date.now()) } };
  }
  const result = await serverResult("/api/me/orders");
  if (!result.ok) return result;
  const orders = parseCustomerOrders(result.data);
  if (!orders) return { ok: false, status: 502, error: "The orders response was not in the expected shape." };
  return { ok: true, status: result.status, data: { orders } };
}

export async function listAdminOrders(query: {
  status?: string | null;
  reviewReason?: string | null;
  limit?: number;
  offset?: number;
} = {}): Promise<ApiResult<AdminList>> {
  if (isMockMode()) {
    const account = await getAccount();
    if (!account) return { ok: false, status: 401, error: "Sign in required" };
    if (!account.isAdmin) return { ok: false, status: 403, error: "Staff access required" };
    return { ok: true, status: 200, data: mockAdminList(query) };
  }
  const result = await serverResult(adminOrdersPath(query));
  if (!result.ok) return result;
  const list = parseAdminList(result.data);
  if (!list) return { ok: false, status: 502, error: "The admin orders response was not in the expected shape." };
  return { ok: true, status: result.status, data: list };
}

export async function listEvaluationQueue(): Promise<
  ApiResult<{ orders: EvaluationQueueOrder[]; page: { limit: number; offset: number; total: number } }>
> {
  if (isMockMode()) {
    const account = await getAccount();
    if (!account) return { ok: false, status: 401, error: "Sign in required" };
    if (!account.isAdmin) return { ok: false, status: 403, error: "Staff access required" };
    const now = Date.now();
    const orders = evaluationQueueRows(mockEvaluationSources(now), now);
    return {
      ok: true,
      status: 200,
      data: { orders, page: { limit: 100, offset: 0, total: orders.length } },
    };
  }
  const result = await serverResult("/api/admin/orders?queue=evaluation&limit=100");
  if (!result.ok) return result;
  const list = parseEvaluationQueue(result.data);
  if (!list) return { ok: false, status: 502, error: "The admin orders response was not in the expected shape." };
  return { ok: true, status: result.status, data: list };
}

export async function getAdminOrder(id: string): Promise<ApiResult<StaffDetail>> {
  if (isMockMode()) {
    const account = await getAccount();
    if (!account) return { ok: false, status: 401, error: "Sign in required" };
    if (!account.isAdmin) return { ok: false, status: 403, error: "Staff access required" };
    const detail = mockStaffDetail(id);
    if (!detail) return { ok: false, status: 404, error: "Order not found" };
    return { ok: true, status: 200, data: detail };
  }
  const result = await serverResult(`/api/admin/orders/${encodeURIComponent(id)}`);
  if (!result.ok) return result;
  const detail = parseStaffDetail(result.data);
  if (!detail) return { ok: false, status: 502, error: "The order response was not in the expected shape." };
  return { ok: true, status: result.status, data: detail };
}

export async function getAdminNotes(id: string): Promise<ApiResult<{ notes: StaffNote[] }>> {
  if (isMockMode()) {
    const account = await getAccount();
    if (!account) return { ok: false, status: 401, error: "Sign in required" };
    if (!account.isAdmin) return { ok: false, status: 403, error: "Staff access required" };
    return { ok: true, status: 200, data: { notes: mockNotes(id) } };
  }
  const result = await serverResult(`/api/admin/orders/${encodeURIComponent(id)}/notes`);
  if (!result.ok) return result;
  const notes = parseNotes(result.data);
  if (!notes) return { ok: false, status: 502, error: "The notes response was not in the expected shape." };
  return { ok: true, status: result.status, data: { notes } };
}
