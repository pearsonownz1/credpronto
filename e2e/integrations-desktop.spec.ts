import { expect, test } from "@playwright/test";
import { expectRedirectToSignIn, signIn } from "./account";

test("signed-out integrations redirects to sign-in", async ({ page }) => {
  await expectRedirectToSignIn(page, "/dashboard/integrations");
});

test("integrations shows the live key, webhook, and card controls", async ({ page }) => {
  await signIn(page, "maria.ruiz@email.com", "/dashboard/integrations");
  await expect(page).toHaveURL(/\/dashboard\/integrations$/);
  await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();
  await expect(page.getByTestId("nav-integrations")).toHaveAttribute("href", "/dashboard/integrations");
  await expect(page.getByText("Expert letter")).toHaveCount(0);

  await expect(page.getByTestId("event-order.quoted")).toBeVisible();
  await expect(page.getByTestId("event-order.delivered")).toBeVisible();
  await expect(page.getByTestId("event-order.failed")).toBeVisible();
  await expect(page.getByTestId("event-order.preview_ready")).toHaveCount(0);
  await expect(page.getByTestId("quick-start")).toContainText("CredPronto-Signature");
  await expect(page.getByTestId("quick-start")).toContainText("curl https://www.credpronto.com/api/v1/orders");
  await expect(page.getByTestId("create-key")).toBeVisible();
  await expect(page.getByTestId("save-webhook")).toBeVisible();
  await expect(page.getByTestId("replace-card")).toBeVisible();

  const blueButtons = await page.locator("button:visible").evaluateAll((buttons) =>
    buttons
      .filter((button) => getComputedStyle(button).backgroundColor === "rgb(31, 94, 255)")
      .map((button) => (button.textContent ?? "").replace(/\s+/g, " ").trim()),
  );
  expect(blueButtons).toEqual(["+ Create key"]);

  await page.screenshot({ path: "artifacts/integrations-desktop.png", fullPage: true });
});
