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
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "Your orders" })).toBeVisible();
});

test("the account lists every order once and signs out", async ({ page }) => {
  await signIn(page, "maria.ruiz@email.com", "/account");
  await expect(page.getByRole("heading", { name: "Your orders" })).toBeVisible();
  await expect(page.getByTestId("account-sign-out")).toBeVisible();

  const list = page.getByTestId("account-orders");
  await expect(list.locator("li")).toHaveCount(6);
  await expect(page.getByTestId("account-order-CP-24817")).toContainText("Birth certificate");
  await expect(page.getByTestId("account-number-CP-24817")).toHaveText("CP-24817");
  await expect(page.getByTestId("account-price-CP-24790")).toHaveText("$9.95");
  await expect(page.getByTestId("account-status-CP-24817")).toHaveText("ready");
  await expect(page.getByTestId("download-CP-24817")).toHaveCount(0);
  await expect(page.getByTestId("account-order-CP-24815")).toContainText("Diploma, transcript");
  await expect(page.getByTestId("account-status-CP-24815")).toHaveText("in review");
  await expect(page.getByTestId("account-order-CP-24790")).toContainText("paid");
  await expect(page.getByTestId("account-order-CP-24702")).toContainText("in review");
  await expect(page.getByTestId("account-order-CP-24611")).toContainText("Oct 2, 2026");
  await expect(page.getByTestId("download-CP-24611")).toHaveText("Download");
  await expect(page.getByTestId("download-CP-24588")).toBeVisible();

  await page.getByTestId("account-sign-out").click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  expect(new URL(page.url()).searchParams.get("next")).toBe("/account");
});
