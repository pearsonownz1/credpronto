import { expect, test } from "@playwright/test";
import { signIn } from "./account";

test("phone integrations opens from the account menu", async ({ page }) => {
  await signIn(page, "maria.ruiz@email.com");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("nav-integrations").click();
  await expect(page).toHaveURL(/\/dashboard\/integrations$/);
  await expect(page.getByRole("button", { name: "Close menu" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();
  await expect(page.getByTestId("create-key")).toBeVisible();
  await expect(page.getByTestId("new-key-secret")).toBeVisible();
  await expect(page.getByText("Expert letter")).toHaveCount(0);
  const blueButtons = await page.locator("button:visible").evaluateAll((buttons) =>
    buttons
      .filter((button) => getComputedStyle(button).backgroundColor === "rgb(31, 94, 255)")
      .map((button) => (button.textContent ?? "").replace(/\s+/g, " ").trim()),
  );
  expect(blueButtons).toEqual(["+ Create key"]);
  await page.screenshot({ path: "artifacts/integrations-phone.png", fullPage: true });
});
