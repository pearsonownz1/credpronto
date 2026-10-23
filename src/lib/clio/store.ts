import { HttpError } from "@/lib/orders/errors";
import type { Db } from "@/lib/orders/storage";
import { decryptToken, encryptToken } from "./crypto";
import { isClioRegion, type ClioRegion } from "./regions";
import type {
  ClioConnectionRecord,
  ClioDocumentRef,
  ClioHandoffRecord,
  ClioMatterOrderRecord,
  ClioStore,
  ClioUploadStatus,
  MatterOrderPatch,
  OauthStateRecord,
} from "./types";

type Row = Record<string, unknown>;
type DbError = { message: string; code?: string } | null;

function asError(error: unknown): DbError {
  if (!error || typeof error !== "object") return null;
  const row = error as { message?: unknown; code?: unknown };
  return {
    message: typeof row.message === "string" ? row.message : "Database error",
    code: typeof row.code === "string" ? row.code : undefined,
  };
}

function missingTable(error: DbError): boolean {
  if (!error) return false;
  return error.code === "42P01" || /clio_/i.test(error.message);
}

function raise(error: unknown): void {
  const parsed = asError(error);
  if (!parsed) return;
  if (missingTable(parsed)) throw new HttpError("Clio storage is not ready", 503);
  if (parsed.code === "23505") {
    throw new HttpError("This Clio user is already connected to another CredPronto account", 409);
  }
  throw new Error(parsed.message);
}

function regionOf(value: unknown): ClioRegion {
  return typeof value === "string" && isClioRegion(value) ? value : "us";
}

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function documentsOf(value: unknown): ClioDocumentRef[] {
  if (!Array.isArray(value)) return [];
  const documents: ClioDocumentRef[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Row;
    const id = text(row.id);
    const name = text(row.name);
    const filename = text(row.filename) ?? name;
    if (!id || !filename) continue;
    documents.push({
      id,
      name: name ?? filename,
      filename,
      contentType: text(row.contentType) ?? text(row.content_type),
    });
  }
  return documents;
}

function mapConnection(row: Row): ClioConnectionRecord {
  const access = text(row.access_token);
  const refresh = text(row.refresh_token);
  if (!access || !refresh) throw new Error("Clio token could not be read");
  return {
    userId: String(row.user_id),
    region: regionOf(row.region),
    clioUserId: String(row.clio_user_id),
    clioAccountId: text(row.clio_account_id),
    accessToken: decryptToken(access),
    refreshToken: decryptToken(refresh),
    accessExpiresAt: String(row.access_expires_at),
    customActionId: text(row.custom_action_id),
  };
}

function mapState(row: Row): OauthStateRecord {
  return {
    state: String(row.state),
    userId: String(row.user_id),
    region: regionOf(row.region),
    redirectUri: String(row.redirect_uri),
    expiresAt: String(row.expires_at),
  };
}

function mapHandoff(row: Row): ClioHandoffRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    region: regionOf(row.region),
    matterId: String(row.matter_id),
    documents: documentsOf(row.documents),
    expiresAt: String(row.expires_at),
  };
}

function uploadStatus(value: unknown): ClioUploadStatus {
  return value === "uploaded" || value === "failed" ? value : "pending";
}

function mapMatter(row: Row): ClioMatterOrderRecord {
  const ids = Array.isArray(row.document_ids) ? row.document_ids.filter((id): id is string => typeof id === "string") : [];
  return {
    orderId: String(row.order_id),
    userId: String(row.user_id),
    region: regionOf(row.region),
    matterId: String(row.matter_id),
    documentIds: ids,
    uploadStatus: uploadStatus(row.upload_status),
    uploadError: text(row.upload_error),
    clioDocumentId: text(row.clio_document_id),
    uploadedAt: text(row.uploaded_at),
  };
}

function queryable(db: Db): boolean {
  return typeof (db as { from?: unknown }).from === "function";
}

export function clioStore(db: Db): ClioStore {
  return {
    async putState(row) {
      const { error } = await db.from("clio_oauth_states").insert({
        state: row.state,
        user_id: row.userId,
        region: row.region,
        redirect_uri: row.redirectUri,
        expires_at: row.expiresAt,
      });
      raise(error);
    },
    async takeState(state, now) {
      const existing = await db.from("clio_oauth_states").select("*").eq("state", state).maybeSingle();
      raise(existing.error);
      const removed = await db.from("clio_oauth_states").delete().eq("state", state);
      raise(removed.error);
      if (!existing.data) return null;
      const row = mapState(existing.data as Row);
      if (Date.parse(row.expiresAt) <= now) return null;
      return row;
    },
    async saveConnection(row) {
      const { error } = await db.from("clio_connections").upsert(
        {
          user_id: row.userId,
          region: row.region,
          clio_user_id: row.clioUserId,
          clio_account_id: row.clioAccountId,
          access_token: encryptToken(row.accessToken),
          refresh_token: encryptToken(row.refreshToken),
          access_expires_at: row.accessExpiresAt,
          custom_action_id: row.customActionId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      raise(error);
    },
    async connectionForUser(userId) {
      const { data, error } = await db.from("clio_connections").select("*").eq("user_id", userId).maybeSingle();
      raise(error);
      return data ? mapConnection(data as Row) : null;
    },
    async connectionsForClioUser(clioUserId) {
      const { data, error } = await db.from("clio_connections").select("*").eq("clio_user_id", clioUserId);
      raise(error);
      return ((data ?? []) as Row[]).map(mapConnection);
    },
    async status(userId) {
      const { data, error } = await db.from("clio_connections").select("region").eq("user_id", userId).maybeSingle();
      raise(error);
      if (!data) return { connected: false, region: null };
      return { connected: true, region: regionOf((data as Row).region) };
    },
    async deleteConnection(userId) {
      const { error } = await db.from("clio_connections").delete().eq("user_id", userId);
      raise(error);
    },
    async deleteStatesForUser(userId) {
      const { error } = await db.from("clio_oauth_states").delete().eq("user_id", userId);
      raise(error);
    },
    async putHandoff(row) {
      const { error } = await db.from("clio_translation_handoffs").insert({
        id: row.id,
        user_id: row.userId,
        region: row.region,
        matter_id: row.matterId,
        documents: row.documents,
        expires_at: row.expiresAt,
      });
      raise(error);
    },
    async readHandoff(id, now) {
      const { data, error } = await db.from("clio_translation_handoffs").select("*").eq("id", id).maybeSingle();
      raise(error);
      if (!data) return null;
      const row = mapHandoff(data as Row);
      if (Date.parse(row.expiresAt) <= now) return null;
      return row;
    },
    async deleteHandoff(id) {
      const { error } = await db.from("clio_translation_handoffs").delete().eq("id", id);
      raise(error);
    },
    async putMatterOrder(row) {
      const { error } = await db.from("clio_matter_orders").insert({
        order_id: row.orderId,
        user_id: row.userId,
        region: row.region,
        matter_id: row.matterId,
        document_ids: row.documentIds,
        upload_status: row.uploadStatus,
        upload_error: row.uploadError,
        clio_document_id: row.clioDocumentId,
        uploaded_at: row.uploadedAt,
      });
      raise(error);
    },
    async matterOrder(orderId) {
      if (!queryable(db)) return null;
      const { data, error } = await db.from("clio_matter_orders").select("*").eq("order_id", orderId).maybeSingle();
      if (missingTable(asError(error))) return null;
      raise(error);
      return data ? mapMatter(data as Row) : null;
    },
    async updateMatterOrder(orderId, patch: MatterOrderPatch) {
      const { error } = await db
        .from("clio_matter_orders")
        .update({
          ...(patch.uploadStatus ? { upload_status: patch.uploadStatus } : {}),
          ...(patch.uploadError !== undefined ? { upload_error: patch.uploadError } : {}),
          ...(patch.clioDocumentId !== undefined ? { clio_document_id: patch.clioDocumentId } : {}),
          ...(patch.uploadedAt !== undefined ? { uploaded_at: patch.uploadedAt } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("order_id", orderId);
      if (missingTable(asError(error))) return;
      raise(error);
    },
  };
}
