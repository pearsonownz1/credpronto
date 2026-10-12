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
  await expect(page.getByTestId("order-CP-24817").locator('a[href="/preview/tok-preview-24817"]')).toHaveCount(2);
  await expect(page.getByTestId("order-CP-24702").locator('a[href="/confirm?token=tok-quoted-24702"]')).toHaveCount(2);
  await expect(page.getByTestId("order-CP-24815").locator('a[href="/order/tok-progress-24815"]')).toHaveCount(1);
  await expect(page.getByTestId("order-CP-24790").locator('a[href="/order/tok-paid-24790"]')).toHaveCount(1);
  await expect(page.getByTestId("order-CP-24611").locator('a[href="/order/tok-ready-24611"]')).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Buy now" })).toHaveAttribute("href", "/preview/tok-preview-24817");
  await expect(page.getByRole("link", { name: "Buy now" })).toHaveClass(/whitespace-nowrap/);
  await expect(page.getByRole("link", { name: "Confirm details" })).toHaveClass(/whitespace-nowrap/);
  await expect(page.getByRole("link", { name: "Download", exact: true }).first()).toHaveClass(/whitespace-nowrap/);
  await expect(page.locator("[data-emphasis='primary']:visible")).toHaveCount(1);
  await expect(page.getByText("1 preview waiting")).toBeVisible();
  await expect(page.getByTestId("nav-evaluation")).toHaveAttribute("href", "/evaluations");
  await expect(page.getByTestId("nav-evaluation")).toContainText("Credential evaluation");
  await expect(page.getByTestId("dashboard-evaluation")).toHaveAttribute("href", "/evaluations");
  await expect(page.getByTestId("dashboard-evaluation")).toContainText("Credential evaluation");
  await expect(page.getByTestId("nav-integrations")).toHaveAttribute("href", "/dashboard/integrations");
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
