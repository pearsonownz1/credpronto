import { expect, test } from "@playwright/test";
import { signIn } from "./account";

test("phone dashboard keeps one next step and opens the menu", async ({ page }) => {
  await signIn(page, "maria.ruiz@email.com");
  await expect(page.getByTestId("order-card-CP-24817")).toBeVisible();
  await expect(page.getByRole("link", { name: "Review & buy" })).toHaveAttribute("href", "/preview/tok-preview-24817");
  await expect(page.locator("[data-emphasis='primary']:visible")).toHaveCount(1);
  await page.screenshot({ path: "artifacts/dashboard-phone.png", fullPage: true });
  await page.getByTestId("open-menu").click();
  await expect(page.getByTestId("nav-evaluation")).toContainText("Soon");
  await expect(page.getByTestId("nav-integrations")).toHaveAttribute("href", "/dashboard/integrations");
  await expect(page.getByText("Expert letter")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-account")).toContainText("María Ruiz");
});
