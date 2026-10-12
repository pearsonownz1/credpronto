import { test } from "@playwright/test";
import { walkCustomerFlow } from "./flow-walkthrough";

test("customer walks from landing through download", async ({ page }) => {
  await walkCustomerFlow(page);
});
