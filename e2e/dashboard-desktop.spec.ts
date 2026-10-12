import { expect, test } from "@playwright/test";
import { expectRedirectToSignIn, signIn } from "./account";

test("signed-out dashboard redirects to sign-in", async ({ page }) => {
  await expectRedirectToSignIn(page, "/dashboard");
});

test("google sign-in explains that email still works", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByText("Google sign-in isn't available yet, use email")).toBeVisible();
  await page.screenshot({ path: "artifacts/sign-in-desktop.png", fullPage: true });
});

test("maria sees the order dashboard", async ({ page }) => {
  await signIn(page, "maria.ruiz@email.com");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Your orders" })).toBeVisible();
  await expect(page.getByTestId("order-CP-24817")).toContainText("Birth certificate");
  await expect(page.getByTestId("order-CP-24817")).toContainText("Spanish → English");
  await expect(page.getByTestId("order-CP-24817")).toContainText("Preview ready");
  await expect(page.getByRole("link", { name: "Review & buy" })).toHaveAttribute("href", "/preview/tok-preview-24817");
  await expect(page.locator("[data-emphasis='primary']:visible")).toHaveCount(1);
  await expect(page.getByText("1 preview waiting")).toBeVisible();
  await expect(page.getByTestId("nav-evaluation")).toContainText("Soon");
  await expect(page.getByText("Expert letter")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /Ready to download/ })).toBeVisible();
  await page.screenshot({ path: "artifacts/dashboard-desktop.png", fullPage: true });
});

test("a new customer sees the empty state", async ({ page }) => {
  await signIn(page, "new.customer@example.com");
  await expect(page.getByRole("link", { name: "Get your free preview" })).toBeVisible();
  await page.screenshot({ path: "artifacts/dashboard-empty-desktop.png", fullPage: true });
});

test("forgot password sends a sign-in link", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill("maria.ruiz@email.com");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("status")).toHaveText("Check your email for a sign-in link.");
});
