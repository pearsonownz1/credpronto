import { expect, test } from "@playwright/test";
import { expectRedirectToSignIn, signIn } from "./account";

const PRODUCTION_SECRET = "cp_live_7f2Kq9mN4pLx8VwR2cHdYa91f";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("signed-out integrations redirects to sign-in", async ({ page }) => {
  await expectRedirectToSignIn(page, "/dashboard/integrations");
});

test("integrations matches the key, webhook, and billing layout", async ({ page }) => {
  await signIn(page, "maria.ruiz@email.com", "/dashboard/integrations");
  await expect(page).toHaveURL(/\/dashboard\/integrations$/);
  await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();
  await expect(page.getByText("Send orders from your own system and get certified files back automatically.")).toBeVisible();
  await expect(page.getByTestId("nav-integrations")).toHaveAttribute("href", "/dashboard/integrations");
  await expect(page.getByText("Expert letter")).toHaveCount(0);

  await expect(page.getByTestId("new-key")).toContainText('New key "Production" created.');
  await expect(page.getByTestId("new-key-secret")).toHaveText(PRODUCTION_SECRET);
  await expect(page.getByTestId("key-mask-key_production")).toHaveText("cp_live_…a91f");
  await expect(page.getByTestId("key-mask-key_staging")).toHaveText("cp_test_…3c07");
  await expect(page.getByTestId("key-key_production")).toContainText("Oct 11");
  await expect(page.getByTestId("key-key_production")).toContainText("2 min ago");
  await expect(page.getByTestId("key-key_staging")).toContainText("Oct 9");
  await expect(page.getByTestId("key-key_staging")).toContainText("Yesterday");
  await expect(page.getByTestId("revoke-key_production")).toHaveCSS("color", "rgb(180, 35, 24)");

  await expect(page.getByTestId("webhook-url")).toHaveText("https://api.yourfirm.com/credpronto/hooks");
  await expect(page.getByTestId("webhook-result")).toContainText("200 OK");
  await expect(page.getByTestId("webhook-secret")).toHaveText("whsec_••••••••••••••••b21e");
  for (const event of ["order.preview_ready", "order.paid", "order.delivered", "order.needs_review"]) {
    await expect(page.getByTestId(`event-${event}`)).toHaveAttribute("aria-pressed", "true");
  }
  await expect(page.getByTestId("event-order.refunded")).toHaveAttribute("aria-pressed", "false");

  await expect(page.getByTestId("saved-card")).toContainText("Visa •••• 4242");
  await expect(page.getByTestId("saved-card")).toContainText("Expires 08/29");
  await expect(page.getByText("Receipts go to maria.ruiz@email.com. Orders placed in the dashboard still check out normally.")).toBeVisible();
  await expect(page.getByTestId("quick-start")).toContainText("curl https://www.credpronto.com/api/v1/orders");
  await expect(page.getByTestId("api-docs")).toHaveAttribute("href", "https://www.credpronto.com/docs/api");

  const blueButtons = await page.locator("button:visible").evaluateAll((buttons) =>
    buttons
      .filter((button) => getComputedStyle(button).backgroundColor === "rgb(31, 94, 255)")
      .map((button) => (button.textContent ?? "").replace(/\s+/g, " ").trim()),
  );
  expect(blueButtons).toEqual(["+ Create key"]);

  await page.screenshot({ path: "artifacts/integrations-desktop.png", fullPage: true });

  await page.getByTestId("copy-key").click();
  await expect(page.getByTestId("copy-key")).toHaveText("Copied");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(PRODUCTION_SECRET);

  await page.getByTestId("reveal-secret").click();
  await expect(page.getByTestId("webhook-secret")).toHaveText("whsec_9kQm2nLp7vXc4sWd8hRfb21e");
  await page.getByTestId("reveal-secret").click();
  await expect(page.getByTestId("webhook-secret")).toHaveText("whsec_••••••••••••••••b21e");

  await page.getByTestId("event-order.refunded").click();
  await expect(page.getByTestId("event-order.refunded")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("send-test").click();
  await expect(page.getByTestId("webhook-result")).toHaveAttribute("data-sent", "1");

  await page.getByRole("button", { name: "Revoke Staging" }).click();
  await expect(page.getByTestId("key-key_staging")).toHaveCount(0);
  await expect(page.getByTestId("key-key_production")).toBeVisible();

  await page.getByTestId("remove-card").click();
  await expect(page.getByTestId("saved-card")).toHaveCount(0);
  await expect(page.getByTestId("saved-card-empty")).toBeVisible();
  await page.getByTestId("replace-card").click();
  await expect(page.getByTestId("saved-card")).toContainText("Visa •••• 4242");

  await page.getByTestId("create-key").click();
  await expect(page.getByTestId("new-key")).toContainText('New key "Development" created.');
  await expect(page.getByTestId("new-key-secret")).not.toHaveText(PRODUCTION_SECRET);
  await expect(page.getByText(PRODUCTION_SECRET)).toHaveCount(0);
  await expect(page.getByTestId("key-mask-key_production")).toHaveText("cp_live_…a91f");
});
