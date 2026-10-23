import { after } from "next/server";
import { requestOrigin } from "@/lib/auth/redirect";
import { handleOrderTranslationGet, handleOrderTranslationPost } from "@/lib/clio/actions";
import { clioCredentials } from "@/lib/clio/config";
import { accountEmail, createLinkedTranslationOrder } from "@/lib/clio/orders";
import { safeClioMessage } from "@/lib/clio/redact";
import { redirectPrivate } from "@/lib/clio/response";
import { clioStore } from "@/lib/clio/store";
import { processOrderInBackground } from "@/lib/orders/pipeline";
import { serviceDb } from "@/lib/orders/storage";
import type { ClioFetch } from "@/lib/clio/api";

function actionDeps(origin: string) {
  const db = serviceDb();
  const store = clioStore(db);
  return {
    origin,
    store,
    fetchImpl: fetch as ClioFetch,
    credentials: clioCredentials(),
    getEmail: (userId: string) => accountEmail(db, userId),
    createOrder: (
      input: Parameters<typeof createLinkedTranslationOrder>[2],
    ) => createLinkedTranslationOrder(db, store, input),
  };
}

function continueOrder(process: { orderId: string; orderToken: string } | null) {
  if (!process) return;
  const pending = process;
  after(() => processOrderInBackground(pending.orderId, pending.orderToken));
}

export async function GET(request: Request) {
  const origin = requestOrigin(request);
  try {
    const outcome = await handleOrderTranslationGet(request.url, actionDeps(origin));
    continueOrder(outcome.process);
    return redirectPrivate(outcome.redirectTo);
  } catch (error) {
    console.error(safeClioMessage(error));
    return redirectPrivate(`${origin}/integrations/clio/translate?error=unavailable`);
  }
}

async function selectedDocuments(request: Request): Promise<{ handoffId: string; documentIds: string[] }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { handoff?: unknown; documentIds?: unknown } | null;
    const handoffId = typeof body?.handoff === "string" ? body.handoff : "";
    const documentIds = Array.isArray(body?.documentIds)
      ? body.documentIds.filter((id): id is string => typeof id === "string")
      : [];
    return { handoffId, documentIds };
  }
  const form = await request.formData();
  return {
    handoffId: String(form.get("handoff") ?? ""),
    documentIds: form.getAll("documentId").filter((id): id is string => typeof id === "string"),
  };
}

export async function POST(request: Request) {
  const origin = requestOrigin(request);
  try {
    const selection = await selectedDocuments(request);
    const outcome = await handleOrderTranslationPost(selection, actionDeps(origin));
    continueOrder(outcome.process);
    return redirectPrivate(outcome.redirectTo);
  } catch (error) {
    console.error(safeClioMessage(error));
    return redirectPrivate(`${origin}/integrations/clio/translate?error=unavailable`);
  }
}
