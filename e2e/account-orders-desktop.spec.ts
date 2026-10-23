import { expect, test } from "@playwright/test";
import { signIn } from "./account";

test("a guest quote offers an account and keeps Continue", async ({ page }) => {
  await page.goto("/quote");
  const card = page.getByTestId("account-card").filter({ visible: true });
  await expect(card.getByRole("heading", { name: "Create your account to track your order" })).toBeVisible();
  await expect(card.getByTestId("account-email")).toBeVisible();
  await expect(card.getByTestId("account-password")).toBeVisible();
  await expect(card.getByTestId("account-magic-link")).toBeVisible();
  await expect(page.getByTestId("continue").filter({ visible: true })).toBeVisible();
  await card.getByTestId("account-email").fill("maria.ruiz@email.com");
  await card.getByTestId("account-magic-link").click();
  await expect(card.getByRole("status")).toContainText("Check your email for a sign-in link.");
});

test("a signed-in quote keeps Continue and hides the account card", async ({ page }) => {
  await signIn(page, "maria.ruiz@email.com", "/quote");
  await expect(page).toHaveURL(/\/quote$/);
  await expect(page.getByTestId("continue").filter({ visible: true })).toBeVisible();
  await expect(page.getByTestId("account-card")).toHaveCount(0);
});

test("creating an account from the quote opens the order list", async ({ page }) => {
  await page.goto("/quote");
  const card = page.getByTestId("account-card").filter({ visible: true });
  await card.getByTestId("account-email").fill("maria.ruiz@email.com");
  await card.getByTestId("account-password").fill("password1");
  await card.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Your orders" })).toBeVisible();
});

test("a signed-in /account visit opens the dashboard and signs out", async ({ page }) => {
  await signIn(page, "maria.ruiz@email.com", "/account");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Your orders" })).toBeVisible();
  await expect(page.getByTestId("order-CP-24817")).toContainText("Birth certificate");

  await page.getByTestId("sidebar-account").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  expect(new URL(page.url()).searchParams.get("next")).toBe("/account");
});
