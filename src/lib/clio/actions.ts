import { randomUUID } from "node:crypto";
import { HttpError } from "@/lib/orders/errors";
import { clioRequest, dataArray, dataObject, type ClioFetch } from "./api";
import type { ClioCredentials } from "./config";
import { downloadClioDocument, listMatterDocuments, matterSubject } from "./documents";
import { ensureFreshConnection } from "./oauth";
import { CLIO_ACTION_PATH, CLIO_TRANSLATE_PATH, regionOrigin, type ClioRegion } from "./regions";
import { safeClioMessage } from "./redact";
import type { ClioConnectionRecord, ClioDocumentRef, ClioHandoffRecord, ClioStore } from "./types";

export const ORDER_TRANSLATION_LABEL = "Order Translation";
export const ORDER_TRANSLATION_UI = "matters/show";

const HANDOFF_TTL_MS = 15 * 60 * 1000;

export type CreatedTranslation = {
  orderId: string;
  orderToken: string;
};

export type ActionRedirect = {
  redirectTo: string;
  process: CreatedTranslation | null;
};

type ActionDeps = {
  origin: string;
  store: ClioStore;
  fetchImpl: ClioFetch;
  credentials: ClioCredentials;
  now?: number;
  getEmail: (userId: string) => Promise<string>;
  createOrder: (input: {
    userId: string;
    email: string;
    region: ClioRegion;
    matterId: string;
    documentIds: string[];
    files: Array<{ filename: string; mime: string; bytes: Uint8Array }>;
  }) => Promise<CreatedTranslation>;
};

function translatePage(origin: string, params: Record<string, string>): string {
  const url = new URL(CLIO_TRANSLATE_PATH, origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function orderPage(origin: string, token: string): string {
  return new URL(`/order/${token}`, origin).toString();
}

function pickConnection(rows: ClioConnectionRecord[], customActionId: string): ClioConnectionRecord | null {
  const match = rows.find((row) => row.customActionId === customActionId);
  if (match) return match;
  return rows.length === 1 ? rows[0] ?? null : null;
}

async function fresh(deps: ActionDeps, connection: ClioConnectionRecord): Promise<ClioConnectionRecord> {
  return ensureFreshConnection({
    fetchImpl: deps.fetchImpl,
    store: deps.store,
    connection,
    credentials: deps.credentials,
    now: deps.now,
  });
}

export async function registerOrderTranslationAction(input: {
  fetchImpl: ClioFetch;
  connection: ClioConnectionRecord;
  targetUrl: string;
}): Promise<string | null> {
  try {
    const origin = regionOrigin(input.connection.region);
    const listed = await clioRequest({
      fetchImpl: input.fetchImpl,
      origin,
      path: "/api/v4/custom_actions",
      token: input.connection.accessToken,
      search: { fields: "id,label,target_url,ui_reference" },
    });
    if (listed.status < 200 || listed.status >= 300) return null;
    const existing = dataArray(listed.json).find((row) => {
      return row.label === ORDER_TRANSLATION_LABEL && row.ui_reference === ORDER_TRANSLATION_UI;
    });
    const existingId = typeof existing?.id === "number" || typeof existing?.id === "string" ? String(existing.id) : "";
    if (existing && existing.target_url === input.targetUrl && existingId) return existingId;
    if (existingId) {
      await clioRequest({
        fetchImpl: input.fetchImpl,
        origin,
        path: `/api/v4/custom_actions/${existingId}`,
        token: input.connection.accessToken,
        method: "DELETE",
      });
    }
    const created = await clioRequest({
      fetchImpl: input.fetchImpl,
      origin,
      path: "/api/v4/custom_actions",
      token: input.connection.accessToken,
      body: {
        data: {
          label: ORDER_TRANSLATION_LABEL,
          target_url: input.targetUrl,
          ui_reference: ORDER_TRANSLATION_UI,
        },
      },
    });
    if (created.status < 200 || created.status >= 300) return null;
    const id = dataObject(created.json)?.id;
    return typeof id === "number" || typeof id === "string" ? String(id) : null;
  } catch (error) {
    console.error(safeClioMessage(error));
    return null;
  }
}

export async function deleteOrderTranslationAction(input: {
  fetchImpl: ClioFetch;
  connection: ClioConnectionRecord;
}): Promise<void> {
  if (!input.connection.customActionId) return;
  const response = await clioRequest({
    fetchImpl: input.fetchImpl,
    origin: regionOrigin(input.connection.region),
    path: `/api/v4/custom_actions/${input.connection.customActionId}`,
    token: input.connection.accessToken,
    method: "DELETE",
  });
  if (response.status !== 404 && (response.status < 200 || response.status >= 300)) {
    throw new HttpError("Clio custom action could not be removed", 502);
  }
}

async function verifyMatter(deps: ActionDeps, connection: ClioConnectionRecord, subjectUrl: string, nonce: string) {
  const subject = matterSubject(connection.region, subjectUrl);
  if (!subject) throw new HttpError("Clio matter was not recognized", 400);
  const ready = await fresh(deps, connection);
  const response = await clioRequest({
    fetchImpl: deps.fetchImpl,
    origin: regionOrigin(ready.region),
    path: subject.path,
    token: ready.accessToken,
    nonce,
    search: { fields: "id,display_number" },
  });
  if (response.status === 403) throw new HttpError("Clio could not confirm this action", 403);
  if (response.status === 401) throw new HttpError("Clio connection expired", 401);
  if (response.status < 200 || response.status >= 300) throw new HttpError("Clio matter could not be opened", 502);
  return { matterId: subject.matterId, connection: ready };
}

async function startOrder(
  deps: ActionDeps,
  connection: ClioConnectionRecord,
  matterId: string,
  documents: ClioDocumentRef[],
): Promise<ActionRedirect> {
  const files = [];
  for (const document of documents) {
    files.push(
      await downloadClioDocument({
        fetchImpl: deps.fetchImpl,
        region: connection.region,
        token: connection.accessToken,
        document,
      }),
    );
  }
  const email = await deps.getEmail(connection.userId);
  const created = await deps.createOrder({
    userId: connection.userId,
    email,
    region: connection.region,
    matterId,
    documentIds: documents.map((document) => document.id),
    files,
  });
  return { redirectTo: orderPage(deps.origin, created.orderToken), process: created };
}

export async function handleOrderTranslationGet(requestUrl: string, deps: ActionDeps): Promise<ActionRedirect> {
  const url = new URL(requestUrl);
  const nonce = url.searchParams.get("custom_action_nonce") ?? "";
  const subjectUrl = url.searchParams.get("subject_url") ?? "";
  const clioUserId = url.searchParams.get("user_id") ?? "";
  const customActionId = url.searchParams.get("custom_action_id") ?? "";
  if (!nonce || nonce.length > 500 || !subjectUrl || !/^[0-9]+$/.test(clioUserId)) {
    return { redirectTo: translatePage(deps.origin, { error: "verify" }), process: null };
  }
  const connection = pickConnection(await deps.store.connectionsForClioUser(clioUserId), customActionId);
  if (!connection || connection.clioUserId !== clioUserId) {
    return { redirectTo: translatePage(deps.origin, { error: "verify" }), process: null };
  }
  try {
    const verified = await verifyMatter(deps, connection, subjectUrl, nonce);
    const documents = await listMatterDocuments({
      fetchImpl: deps.fetchImpl,
      region: verified.connection.region,
      token: verified.connection.accessToken,
      matterId: verified.matterId,
    });
    if (documents.length === 1 && documents[0]) {
      return startOrder(deps, verified.connection, verified.matterId, documents);
    }
    const now = deps.now ?? Date.now();
    const handoff: ClioHandoffRecord = {
      id: randomUUID(),
      userId: verified.connection.userId,
      region: verified.connection.region,
      matterId: verified.matterId,
      documents,
      expiresAt: new Date(now + HANDOFF_TTL_MS).toISOString(),
    };
    await deps.store.putHandoff(handoff);
    return { redirectTo: translatePage(deps.origin, { handoff: handoff.id }), process: null };
  } catch (error) {
    console.error(safeClioMessage(error));
    const code = error instanceof HttpError && error.status >= 400 && error.status < 500 ? "verify" : "download";
    return { redirectTo: translatePage(deps.origin, { error: code }), process: null };
  }
}

export async function handleOrderTranslationPost(
  input: { handoffId: string; documentIds: string[] },
  deps: ActionDeps,
): Promise<ActionRedirect> {
  const now = deps.now ?? Date.now();
  const handoff = await deps.store.readHandoff(input.handoffId, now);
  if (!handoff) return { redirectTo: translatePage(deps.origin, { error: "expired" }), process: null };
  const chosen = new Set(input.documentIds);
  const documents = handoff.documents.filter((document) => chosen.has(document.id));
  if (documents.length < 1) {
    return { redirectTo: translatePage(deps.origin, { handoff: handoff.id, error: "choose" }), process: null };
  }
  const connection = await deps.store.connectionForUser(handoff.userId);
  if (!connection) return { redirectTo: translatePage(deps.origin, { error: "verify" }), process: null };
  try {
    const ready = await fresh(deps, connection);
    const created = await startOrder(deps, ready, handoff.matterId, documents);
    await deps.store.deleteHandoff(handoff.id);
    return created;
  } catch (error) {
    console.error(safeClioMessage(error));
    return { redirectTo: translatePage(deps.origin, { handoff: handoff.id, error: "download" }), process: null };
  }
}

export function actionTarget(origin: string): string {
  return new URL(CLIO_ACTION_PATH, origin).toString();
}

export async function disconnectClio(input: {
  userId: string;
  store: ClioStore;
  fetchImpl: ClioFetch;
  credentials: ClioCredentials;
}): Promise<void> {
  const connection = await input.store.connectionForUser(input.userId);
  if (connection) {
    try {
      const ready = await ensureFreshConnection({
        fetchImpl: input.fetchImpl,
        store: input.store,
        connection,
        credentials: input.credentials,
      });
      await deleteOrderTranslationAction({ fetchImpl: input.fetchImpl, connection: ready });
    } catch (error) {
      console.error(safeClioMessage(error));
    }
  }
  await input.store.deleteConnection(input.userId);
  await input.store.deleteStatesForUser(input.userId);
}
