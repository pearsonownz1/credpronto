import { expect, test } from "@playwright/test";
import { expectRedirectToSignIn, signIn } from "./account";

test("signed-out admin redirects to sign-in", async ({ page }) => {
  await expectRedirectToSignIn(page, "/admin");
});

test("a customer sees the admin 403 page", async ({ page }) => {
  await signIn(page, "maria.ruiz@email.com", "/admin");
  await expect(page.getByTestId("forbidden")).toBeVisible();
  await expect(page.getByRole("heading", { name: "You don't have access to admin" })).toBeVisible();
  await expect(page.getByTestId("admin-orders")).toHaveCount(0);
  await page.screenshot({ path: "artifacts/admin-forbidden-desktop.png", fullPage: true });
});

test("staff can review, edit, note, and refund an order", async ({ page }) => {
  await signIn(page, "admin@credpronto.com", "/admin");
  await expect(page.getByTestId("admin-orders")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Incoming" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active" })).toBeVisible();
  await expect(page.getByTestId("admin-order-CP-24802")).toContainText("Low confidence on page 2");

  await page.getByRole("link", { name: "CP-24802" }).click();
  await expect(page.getByTestId("resolve-review")).toBeVisible();
  await expect(page.getByText("Low confidence on page 2")).toBeVisible();

  await page.goto("/admin/orders/CP-24790");
  await expect(page.getByLabel("Translation page 1 segment 1")).toHaveValue("Birth certificate of María Ruiz.");
  await expect(page.getByTestId("notes-thread")).toContainText("Checked the name against the original scan.");
  await expect(page.getByTestId("activity-log")).toContainText("Payment received");
  await page.getByLabel("Translation page 1 segment 1").fill("Birth certificate of Maria Ruiz.");
  await page.getByTestId("save-translation").click();
  await expect(page.getByTestId("studio-status")).toContainText("Translation saved");

  await page.getByTestId("note-body").fill("Called the customer.");
  await page.getByTestId("note-submit").click();
  await expect(page.getByTestId("notes-thread")).toContainText("Called the customer.");

  await page.getByTestId("refund-open").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByTestId("refund-confirm").click();
  await expect(page.getByTestId("studio-status")).toContainText("Payment marked refunded.");
  await page.screenshot({ path: "artifacts/admin-order-desktop.png", fullPage: true });

  await page.goto("/admin/review");
  await expect(page.getByTestId("admin-order-CP-24802")).toBeVisible();
  await expect(page.getByTestId("admin-order-CP-24740")).toBeVisible();
  await page.goto("/admin/refunds");
  await expect(page.getByTestId("admin-order-CP-24790")).toBeVisible();
  await page.screenshot({ path: "artifacts/admin-orders-desktop.png", fullPage: false });
});
