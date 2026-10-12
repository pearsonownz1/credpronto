import { expect, type Page } from "@playwright/test";

export async function signIn(page: Page, email: string, next?: string) {
  const path = next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in";
  await page.goto(path);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password1");
  await page.getByRole("button", { name: "Sign in" }).click();
}

export async function expectRedirectToSignIn(page: Page, path: string) {
  await page.goto(path);
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  const next = new URL(page.url()).searchParams.get("next");
  expect(next).toBe(path);
}
