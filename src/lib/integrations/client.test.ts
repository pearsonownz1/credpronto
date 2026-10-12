import { describe, expect, it, vi } from "vitest";
import {
  FIXTURE_PRODUCTION_SECRET,
  FIXTURE_WEBHOOK_SECRET,
  createLiveIntegrationsClient,
  createMockIntegrationsClient,
  fixtureSnapshot,
} from "./client";
import { formatCardExpiry, formatKeyCreated, formatLastUsed, maskKey, maskWebhookSecret } from "./present";

const NOW = Date.parse("2026-10-12T12:00:00.000Z");

describe("integration fixtures", () => {
  it("matches the designer key, webhook, and card", () => {
    const snapshot = fixtureSnapshot(NOW);
    expect(snapshot.keys.map((key) => key.name)).toEqual(["Production", "Staging"]);
    expect(maskKey(snapshot.keys[0].prefix, snapshot.keys[0].last4)).toBe("cp_live_…a91f");
    expect(maskKey(snapshot.keys[1].prefix, snapshot.keys[1].last4)).toBe("cp_test_…3c07");
    expect(formatKeyCreated(snapshot.keys[0].createdAt)).toBe("Oct 11");
    expect(formatKeyCreated(snapshot.keys[1].createdAt)).toBe("Oct 9");
    expect(formatLastUsed(snapshot.keys[0].lastUsedAt, NOW)).toBe("2 min ago");
    expect(formatLastUsed(snapshot.keys[1].lastUsedAt, NOW)).toBe("Yesterday");
    expect(snapshot.revealed?.secret).toBe(FIXTURE_PRODUCTION_SECRET);
    expect(snapshot.revealed?.secret.startsWith("cp_live_")).toBe(true);
    expect(snapshot.revealed?.secret.endsWith("a91f")).toBe(true);
    expect(maskWebhookSecret(snapshot.webhook.secretLast4)).toBe("whsec_••••••••••••••••b21e");
    expect(snapshot.webhook.events).not.toContain("order.refunded");
    expect(snapshot.card && formatCardExpiry(snapshot.card.expMonth, snapshot.card.expYear)).toBe("Expires 08/29");
  });

  it("shows a new secret once, then drops it from the strip on the next create", async () => {
    const client = createMockIntegrationsClient();
    const created = await client.createKey(NOW);
    expect(created.ok).toBe(true);
    if (!created.ok || !created.data.revealed) return;
    const firstSecret = created.data.revealed.secret;
    expect(created.data.revealed.name).toBe("Development");
    expect(firstSecret).not.toBe(FIXTURE_PRODUCTION_SECRET);
    expect(JSON.stringify(created.data.keys)).not.toContain(firstSecret);
    const again = await client.createKey(NOW);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.data.revealed?.secret).not.toBe(firstSecret);
    expect(JSON.stringify(again.data)).not.toContain(firstSecret);
    expect(JSON.stringify(again.data)).not.toContain(FIXTURE_PRODUCTION_SECRET);
  });

  it("revokes a key, toggles events, and swaps the card", async () => {
    const client = createMockIntegrationsClient();
    const revoked = await client.revokeKey("key_staging", NOW);
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(revoked.data.keys.map((key) => key.id)).toEqual(["key_production"]);

    const cleared = await client.revokeKey("key_production", NOW);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.data.revealed).toBeNull();

    const toggled = await client.toggleEvent("order.refunded", NOW);
    expect(toggled.ok).toBe(true);
    if (!toggled.ok) return;
    expect(toggled.data.webhook.events).toContain("order.refunded");

    const removed = await client.removeCard(NOW);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.data.card).toBeNull();
    const replaced = await client.replaceCard(NOW);
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    expect(replaced.data.card?.brand).toBe("Visa");
    const swapped = await client.replaceCard(NOW);
    expect(swapped.ok).toBe(true);
    if (!swapped.ok) return;
    expect(swapped.data.card?.last4).toBe("4444");
  });

  it("does not call the network while the integrations contract is unpublished", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const live = createLiveIntegrationsClient();
    const result = await live.load(NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(501);
    const secret = await live.revealWebhookSecret(NOW);
    expect(secret.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("keeps the webhook secret behind reveal", async () => {
    const client = createMockIntegrationsClient();
    const loaded = await client.load(NOW);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(JSON.stringify(loaded.data.webhook)).not.toContain(FIXTURE_WEBHOOK_SECRET);
    const revealed = await client.revealWebhookSecret(NOW);
    expect(revealed.ok).toBe(true);
    if (!revealed.ok) return;
    expect(revealed.data.secret).toBe(FIXTURE_WEBHOOK_SECRET);
    const sent = await client.sendTest(NOW);
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect(sent.data.webhook.sentCount).toBe(1);
    expect(sent.data.webhook.lastLabel).toBe("200 OK");
  });
});
