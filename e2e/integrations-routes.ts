import type { Page } from "@playwright/test";

export type ClioStub = {
  connected?: boolean;
  /** When set to 400 or higher, status returns this status and `statusError`. */
  statusStatus?: number;
  statusError?: string;
  disconnectStatus?: number;
  disconnectError?: string;
};

/** Browser stubs for the integrations page. Sample rows stay in the test, not the app. */
export async function stubIntegrations(page: Page, clio: ClioStub = {}) {
  let connected = clio.connected ?? false;
  await page.route("**/api/integrations/clio/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === "/api/integrations/clio/status" && method === "GET") {
      if (clio.statusStatus && clio.statusStatus >= 400) {
        await route.fulfill({
          status: clio.statusStatus,
          json: { error: clio.statusError ?? "Clio storage is not ready" },
        });
        return;
      }
      await route.fulfill({
        json: connected ? { connected: true, region: "us" } : { connected: false },
      });
      return;
    }
    if (url.pathname === "/api/integrations/clio/disconnect" && method === "POST") {
      if (clio.disconnectStatus && clio.disconnectStatus >= 400) {
        await route.fulfill({
          status: clio.disconnectStatus,
          json: { error: clio.disconnectError ?? "Clio could not be disconnected." },
        });
        return;
      }
      connected = false;
      await route.fulfill({ json: { connected: false } });
      return;
    }
    if (url.pathname === "/api/integrations/clio/connect" && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Clio connect</title>",
      });
      return;
    }
    await route.fallback();
  });

  await page.route("**/api/me/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();

    if (path === "/api/me/api-keys" && method === "GET") {
      await route.fulfill({
        json: {
          keys: [
            {
              id: "key_1",
              name: "Production",
              prefix: "cp_live_",
              last4: "ab12",
              createdAt: "2026-10-11T15:04:00.000Z",
              revokedAt: null,
            },
          ],
        },
      });
      return;
    }
    if (path === "/api/me/api-keys" && method === "POST") {
      const body = route.request().postDataJSON() as { name?: string; mode?: string };
      const prefix = body.mode === "live" ? "cp_live_" : "cp_test_";
      await route.fulfill({
        status: 201,
        json: {
          id: "key_2",
          name: body.name ?? "CI",
          prefix,
          last4: "c0de",
          secret: `${prefix}${"ab".repeat(32)}`,
          createdAt: "2026-10-12T00:00:00.000Z",
        },
      });
      return;
    }
    if (path.startsWith("/api/me/api-keys/") && method === "DELETE") {
      await route.fulfill({ json: { id: path.split("/").pop(), revokedAt: "2026-10-12T01:00:00.000Z" } });
      return;
    }
    if (path === "/api/me/billing" && method === "GET") {
      await route.fulfill({ json: { card: { brand: "visa", last4: "4242" } } });
      return;
    }
    if (path === "/api/me/billing" && method === "DELETE") {
      await route.fulfill({ json: { card: null } });
      return;
    }
    if (path === "/api/me/billing/setup-intent" && method === "POST") {
      await route.fulfill({ status: 503, json: { error: "Payments not configured" } });
      return;
    }
    if (path === "/api/me/webhook" && method === "GET") {
      await route.fulfill({ status: 405, json: { error: "Method not allowed" } });
      return;
    }
    if (path === "/api/me/webhook" && method === "PUT") {
      await route.fulfill({
        json: { url: "https://example.com/hooks", secret: `whsec_${"ab".repeat(32)}` },
      });
      return;
    }
    if (path === "/api/me/webhook/test") {
      await route.fulfill({ status: 404, json: { error: "Not found" } });
      return;
    }
    if (path === "/api/me/api-orders") {
      await route.fulfill({ status: 404, json: { error: "Not found" } });
      return;
    }
    await route.fallback();
  });
}
