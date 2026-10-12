import { expect, test } from "@playwright/test";
import { CJK_PAGE_RULE } from "../src/lib/orders/billing";
import { walkCustomerFlow } from "./flow-walkthrough";
import { expectRetakeCard, openImageQualityOrder } from "./retake-order";

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
  await expect(page.getByTestId("review-note").filter({ visible: true })).toContainText(
    "Language detection was unavailable.",
  );
  await expect(page.getByTestId("quote-total").filter({ visible: true })).toContainText("$19.90");
  await expect(page.getByTestId("page-rule").filter({ visible: true })).toHaveText(CJK_PAGE_RULE);
  await expect(page.getByTestId("language-picker")).toHaveCount(0);
});

test("page order and a blurry photo are shown before a quote", async ({ page }) => {
  await openImageQualityOrder(page);
  await expectRetakeCard(page);
  await page.screenshot({ path: "artifacts/retake-desktop.png", fullPage: true });

  await page.getByTestId("replace-page2").setInputFiles({
    name: "retake.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("replacement-photo"),
  });
  await expect(page.getByRole("heading", { name: "Reading your files…" }).filter({ visible: true })).toBeVisible();
});
