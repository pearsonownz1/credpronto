import { expect, test } from "@playwright/test";
import { expectRedirectToSignIn, signIn } from "./account";
import { stubIntegrations } from "./integrations-routes";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("signed-out integrations redirects to sign-in", async ({ page }) => {
  await expectRedirectToSignIn(page, "/dashboard/integrations");
});

test("integrations shows keys, webhook, card, orders, and quick start", async ({ page }) => {
  await stubIntegrations(page);
  await signIn(page, "maria.ruiz@email.com", "/dashboard/integrations");
  await expect(page).toHaveURL(/\/dashboard\/integrations$/);
  await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();
  await expect(page.getByTestId("integration-clio")).toContainText("Clio");
  await expect(page.getByTestId("integration-clio")).toContainText(
    "Send evaluation and translation orders from a Clio matter and save finished reports back to it.",
  );
  await expect(page.getByTestId("integration-clio")).not.toContainText("Coming soon");
  await expect(page.getByTestId("clio-connect")).toHaveAttribute("href", "/api/integrations/clio/connect");
  await expect(page.getByTestId("clio-connect")).toHaveText("Connect");
  await expect(page.getByTestId("integration-clio-status")).toHaveCount(0);
  await expect(page.getByTestId("integration-clio").getByRole("button")).toHaveCount(0);
  await expect(page.getByTestId("nav-integrations")).toHaveAttribute("href", "/dashboard/integrations");
  await expect(page.getByText("Expert letter")).toHaveCount(0);

  await expect(page.getByTestId("event-order.quoted")).toBeVisible();
  await expect(page.getByTestId("event-order.quoted")).toHaveAttribute("data-available", "true");
  await expect(page.getByTestId("event-order.preview_ready")).toHaveAttribute("data-available", "true");
  await expect(page.getByTestId("event-order.paid")).toHaveAttribute("data-available", "true");
  await expect(page.getByTestId("event-evaluation.paid")).toHaveAttribute("data-available", "true");
  await expect(page.getByTestId("event-order.completed")).toHaveAttribute("data-available", "true");
  await expect(page.getByTestId("event-order.delivered")).toHaveCount(0);
  await expect(page.getByTestId("webhook-events-soon")).toHaveCount(0);
  await expect(page.getByTestId("quick-start")).toContainText("Authorization: Bearer <key>");
  await expect(page.getByTestId("quick-start")).toContainText("curl -X POST https://www.credpronto.com/api/v1/orders");
  await expect(page.getByTestId("quick-start")).toContainText("-F files=@acta.pdf");
  await expect(page.getByTestId("quick-start")).not.toContainText("-F file=");
  await expect(page.getByTestId("quick-start")).toContainText("-F source_language=es");
  await expect(page.getByTestId("quick-start")).toContainText("/api/v1/orders/{id}/files");
  await expect(page.getByTestId("quick-start")).toContainText("POST /api/me/api-keys");
  await expect(page.getByTestId("sample-create-response")).toContainText('"externalRef": "crm-1842"');
  await expect(page.getByTestId("sample-get-response")).toContainText('"reviewReason": null');
  await expect(page.getByTestId("quick-start")).toContainText("CredPronto-Signature");
  await expect(page.getByTestId("api-docs")).toHaveAttribute("href", "/docs/api");
  await expect(page.getByTestId("copy-quick-start")).toBeVisible();
  await expect(page.getByTestId("create-key")).toBeVisible();
  await expect(page.getByTestId("save-webhook")).toBeVisible();
  await expect(page.getByTestId("send-test")).toBeVisible();
  await expect(page.getByTestId("replace-card")).toBeVisible();
  await expect(page.getByTestId("remove-card")).toBeVisible();
  await expect(page.getByTestId("billing-note")).toHaveText(
    "API orders are charged to this card when placed. Dashboard orders still check out normally.",
  );
  await expect(page.getByTestId("key-prefix-key_1")).toHaveText("cp_live_ab12…");
  await expect(page.getByTestId("last-used-soon")).toHaveText("Last used is coming soon.");
  await expect(page.getByTestId("webhook-delivery")).toHaveText("Last delivery: Coming soon");
  await expect(page.getByTestId("card-exp")).toHaveText("Expiry coming soon");
  await expect(page.getByTestId("saved-card")).toContainText("4242");
  await expect(page.getByTestId("api-orders-soon")).toHaveText("API order history is coming soon.");
  await expect(page.getByTestId("export-csv")).toBeDisabled();

  const blueButtons = await page.locator("button:visible").evaluateAll((buttons) =>
    buttons
      .filter((button) => getComputedStyle(button).backgroundColor === "rgb(31, 94, 255)")
      .map((button) => (button.textContent ?? "").replace(/\s+/g, " ").trim()),
  );
  expect(blueButtons).toEqual(["Create key", "Send test", "Export CSV"]);

  await page.screenshot({ path: "artifacts/integrations-desktop.png", fullPage: true });

  await page.getByTestId("key-name").fill("CI");
  await page.getByTestId("create-key").click();
  await expect(page.getByTestId("new-key-note")).toContainText("won't see this again");
  await expect(page.getByTestId("new-key-secret")).toContainText("cp_test_");
  await expect(page.getByTestId("quick-start")).toContainText("Authorization: Bearer cp_test_");
  await page.getByTestId("copy-key").click();
  await expect(page.getByTestId("copy-key")).toHaveText("Copied");

  await page.getByTestId("revoke-key_1").click();
  await expect(page.getByTestId("revoke-confirm-key_1")).toBeVisible();
  await page.getByTestId("revoke-cancel-key_1").click();
  await expect(page.getByTestId("key-key_1")).toBeVisible();
  await page.getByTestId("revoke-key_1").click();
  await page.getByTestId("revoke-confirm-key_1").click();
  await expect(page.getByTestId("key-key_1")).toHaveCount(0);

  await page.getByTestId("webhook-url").fill("https://example.com/hooks");
  await page.getByTestId("save-webhook").click();
  await expect(page.getByTestId("webhook-secret")).toContainText("whsec_");
  await expect(page.getByTestId("webhook-secret")).not.toContainText("ab".repeat(16));
  await page.getByTestId("reveal-secret").click();
  await expect(page.getByTestId("webhook-secret")).toContainText("ab".repeat(16));
  await page.getByTestId("copy-secret").click();
  await expect(page.getByTestId("copy-secret")).toHaveText("Copied");

  await page.getByTestId("send-test").click();
  await expect(page.getByTestId("webhook-test-result")).toHaveText("Test deliveries are coming soon.");
  await page.getByTestId("copy-quick-start").click();
  await expect(page.getByTestId("copy-quick-start")).toHaveText("Copied");
});
