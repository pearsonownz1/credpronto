import { expect, test } from "@playwright/test";
import { CJK_PAGE_RULE } from "../src/lib/orders/billing";
import { walkCustomerFlow } from "./flow-walkthrough";

test("customer walks from landing through download", async ({ page }) => {
  await walkCustomerFlow(page);
});

test("needs_review quote keeps the total when language is unknown", async ({ page }) => {
  await page.addInitScript((pageRule) => {
    sessionStorage.setItem(
      "credpronto-mock-order",
      JSON.stringify({
        status: "needs_review",
        sourceLanguage: null,
        totalCents: 1990,
        pageRule,
        reviewReason: "Language detection was unavailable.",
      }),
    );
  }, CJK_PAGE_RULE);

  await page.goto("/quote");
  const language = page.getByTestId("detected-language").filter({ visible: true });
  await expect(language).toContainText("We'll confirm the language");
  await expect(page.getByTestId("quote-total").filter({ visible: true })).toContainText("$19.90");
  await expect(page.getByTestId("page-rule").filter({ visible: true })).toHaveText(CJK_PAGE_RULE);
  await expect(page.getByTestId("language-picker")).toHaveCount(0);
});
