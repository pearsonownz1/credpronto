import { expect, test } from "@playwright/test";
import { signIn } from "./account";

test("phone admin opens the staff menu and the order studio", async ({ page }) => {
  await signIn(page, "admin@credpronto.com", "/admin");
  await page.getByTestId("open-menu").click();
  await page.getByRole("link", { name: "Needs review" }).click();
  await expect(page).toHaveURL(/\/admin\/review/);
  await expect(page.getByTestId("admin-order-CP-24802")).toBeVisible();
  await page.screenshot({ path: "artifacts/admin-review-phone.png", fullPage: true });

  await page.goto("/admin/orders/CP-24740");
  await expect(page.getByText("Use the confirmed spelling of the surname.")).toBeVisible();
  await expect(page.getByTestId("page-editor")).toBeVisible();
  await page.screenshot({ path: "artifacts/admin-order-phone.png", fullPage: true });
});
