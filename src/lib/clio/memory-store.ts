import type {
  ClioConnectionRecord,
  ClioHandoffRecord,
  ClioMatterOrderRecord,
  ClioStore,
  OauthStateRecord,
} from "./types";

export function createMemoryClioStore(): ClioStore {
  const states = new Map<string, OauthStateRecord>();
  const connections = new Map<string, ClioConnectionRecord>();
  const handoffs = new Map<string, ClioHandoffRecord>();
  const matters = new Map<string, ClioMatterOrderRecord>();

  return {
    async putState(row) {
      states.set(row.state, row);
    },
    async takeState(state, now) {
      const row = states.get(state) ?? null;
      states.delete(state);
      if (!row || Date.parse(row.expiresAt) <= now) return null;
      return row;
    },
    async saveConnection(row) {
      for (const existing of connections.values()) {
        if (existing.userId !== row.userId && existing.region === row.region && existing.clioUserId === row.clioUserId) {
          throw new Error("This Clio user is already connected to another CredPronto account");
        }
      }
      connections.set(row.userId, row);
    },
    async connectionForUser(userId) {
      return connections.get(userId) ?? null;
    },
    async connectionsForClioUser(clioUserId) {
      return [...connections.values()].filter((row) => row.clioUserId === clioUserId);
    },
    async status(userId) {
      const row = connections.get(userId);
      return row ? { connected: true, region: row.region } : { connected: false, region: null };
    },
    async deleteConnection(userId) {
      connections.delete(userId);
    },
    async deleteStatesForUser(userId) {
      for (const [state, row] of states) {
        if (row.userId === userId) states.delete(state);
      }
    },
    async putHandoff(row) {
      handoffs.set(row.id, row);
    },
    async readHandoff(id, now) {
      const row = handoffs.get(id);
      if (!row || Date.parse(row.expiresAt) <= now) return null;
      return row;
    },
    async deleteHandoff(id) {
      handoffs.delete(id);
    },
    async putMatterOrder(row) {
      matters.set(row.orderId, row);
    },
    async matterOrder(orderId) {
      return matters.get(orderId) ?? null;
    },
    async updateMatterOrder(orderId, patch) {
      const row = matters.get(orderId);
      if (!row) return;
      matters.set(orderId, { ...row, ...patch });
    },
  };
}
