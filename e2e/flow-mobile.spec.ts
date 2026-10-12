import { test } from "@playwright/test";
import { walkCustomerFlow } from "./flow-walkthrough";

test("customer flow fits a 390px phone", async ({ page }) => {
  await walkCustomerFlow(page, { checkOverflow: true });
});
