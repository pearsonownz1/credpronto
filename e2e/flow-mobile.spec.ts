import { expect, test } from "@playwright/test";
import { walkCustomerFlow } from "./flow-walkthrough";
import { expectRetakeCard, openImageQualityOrder } from "./retake-order";

test("customer flow fits a 390px phone", async ({ page }) => {
  await walkCustomerFlow(page, { checkOverflow: true });
});

test("image quality retake fits a 390px phone", async ({ page }) => {
  await openImageQualityOrder(page);
  await expectRetakeCard(page);
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflows).toBe(false);
  await page.screenshot({ path: "artifacts/retake-phone.png", fullPage: true });
});
