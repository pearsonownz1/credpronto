import type { ClioRegion } from "./regions";

export type OauthStateRecord = {
  state: string;
  userId: string;
  region: ClioRegion;
  redirectUri: string;
  expiresAt: string;
};

export type ClioConnectionRecord = {
  userId: string;
  region: ClioRegion;
  clioUserId: string;
  clioAccountId: string | null;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  customActionId: string | null;
};

export type ClioDocumentRef = {
  id: string;
  name: string;
  filename: string;
  contentType: string | null;
};

export type ClioHandoffRecord = {
  id: string;
  userId: string;
  region: ClioRegion;
  matterId: string;
  documents: ClioDocumentRef[];
  expiresAt: string;
};

export type ClioUploadStatus = "pending" | "uploaded" | "failed";

export type ClioMatterOrderRecord = {
  orderId: string;
  userId: string;
  region: ClioRegion;
  matterId: string;
  documentIds: string[];
  uploadStatus: ClioUploadStatus;
  uploadError: string | null;
  clioDocumentId: string | null;
  uploadedAt: string | null;
};

export type MatterOrderPatch = Partial<
  Pick<ClioMatterOrderRecord, "uploadStatus" | "uploadError" | "clioDocumentId" | "uploadedAt">
>;

export type ClioStore = {
  putState(row: OauthStateRecord): Promise<void>;
  takeState(state: string, now: number): Promise<OauthStateRecord | null>;
  saveConnection(row: ClioConnectionRecord): Promise<void>;
  connectionForUser(userId: string): Promise<ClioConnectionRecord | null>;
  connectionsForClioUser(clioUserId: string): Promise<ClioConnectionRecord[]>;
  status(userId: string): Promise<{ connected: boolean; region: ClioRegion | null }>;
  deleteConnection(userId: string): Promise<void>;
  deleteStatesForUser(userId: string): Promise<void>;
  putHandoff(row: ClioHandoffRecord): Promise<void>;
  readHandoff(id: string, now: number): Promise<ClioHandoffRecord | null>;
  deleteHandoff(id: string): Promise<void>;
  putMatterOrder(row: ClioMatterOrderRecord): Promise<void>;
  matterOrder(orderId: string): Promise<ClioMatterOrderRecord | null>;
  updateMatterOrder(orderId: string, patch: MatterOrderPatch): Promise<void>;
};
