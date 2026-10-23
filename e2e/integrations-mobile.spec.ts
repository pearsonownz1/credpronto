import { expect, test } from "@playwright/test";
import { signIn } from "./account";
import { stubIntegrations } from "./integrations-routes";

test("phone integrations opens from the account menu", async ({ page }) => {
  await stubIntegrations(page);
  await signIn(page, "maria.ruiz@email.com");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("nav-integrations").click();
  await expect(page).toHaveURL(/\/dashboard\/integrations$/);
  await expect(page.getByRole("button", { name: "Close menu" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();
  await expect(page.getByTestId("integration-clio")).toContainText(
    "Send evaluation and translation orders from a Clio matter and save finished reports back to it.",
  );
  await expect(page.getByTestId("integration-clio")).not.toContainText("Coming soon");
  await expect(page.getByTestId("clio-connect")).toHaveAttribute("href", "/api/integrations/clio/connect");
  await expect(page.getByTestId("clio-connect")).toHaveText("Connect");
  await expect(page.getByTestId("create-key")).toBeVisible();
  await expect(page.getByTestId("event-order.quoted")).toBeVisible();
  await expect(page.getByTestId("event-order.preview_ready")).toBeVisible();
  await expect(page.getByTestId("event-evaluation.paid")).toBeVisible();
  await expect(page.getByTestId("quick-start")).toContainText("Authorization: Bearer <key>");
  await expect(page.getByTestId("quick-start")).toContainText("-F files=@acta.pdf");
  await expect(page.getByTestId("quick-start")).toContainText("POST /api/me/api-keys");
  await expect(page.getByTestId("billing-note")).toContainText("Dashboard orders still check out normally.");
  await expect(page.getByTestId("api-orders-soon")).toBeVisible();
  await expect(page.getByText("Expert letter")).toHaveCount(0);
  const blueButtons = await page.locator("button:visible").evaluateAll((buttons) =>
    buttons
      .filter((button) => getComputedStyle(button).backgroundColor === "rgb(31, 94, 255)")
      .map((button) => (button.textContent ?? "").replace(/\s+/g, " ").trim()),
  );
  expect(blueButtons).toEqual(["Create key", "Send test", "Export CSV"]);
  await page.screenshot({ path: "artifacts/integrations-phone.png", fullPage: true });
});
