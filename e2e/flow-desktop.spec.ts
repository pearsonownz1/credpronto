import { expect, test } from "@playwright/test";
import { CJK_PAGE_RULE } from "../src/lib/orders/billing";
import { signIn } from "./account";
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

test("page order and a blurry photo are shown before a quote", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "credpronto-mock-order",
      JSON.stringify({
        status: "needs_review",
        sourceLanguage: "fr",
        reviewReason: "image_quality",
        totalCents: 1990,
        billablePages: 2,
        pageOrder: {
          basis: "logical",
          pages: [
            {
              documentId: "page1",
              filename: "scan-page-1.jpg",
              uploadPosition: 2,
              appliedPosition: 1,
              uploadPage: 1,
              appliedPage: 1,
              logicalPage: 1,
              hint: "page 1/2",
              confidence: 0.93,
            },
            {
              documentId: "page2",
              filename: "scan-page-2.jpg",
              uploadPosition: 1,
              appliedPosition: 2,
              uploadPage: 1,
              appliedPage: 1,
              logicalPage: 2,
              hint: "page 2/2",
              confidence: 0.91,
            },
          ],
        },
        pages: [
          {
            documentId: "page2",
            pageNumber: 1,
            uploadPage: 1,
            logicalPage: 2,
            orderHint: "page 2/2",
            qualityScore: 0.31,
            qualityFlags: ["blurry"],
            qualityMessage:
              "It looks blurry. Retake it in even light, with the whole page in the frame and the text sharp, then upload a replacement.",
          },
        ],
      }),
    );
  });

  await page.goto("/quote");
  const order = page.getByTestId("page-order").filter({ visible: true });
  await expect(order).toContainText("printed page numbers");
  await expect(order).toContainText("scan-page-1.jpg");
  await expect(order).toContainText("printed page 1");
  const quality = page.getByTestId("image-quality").filter({ visible: true });
  await expect(quality).toContainText("blurry");
  await expect(quality).toContainText("Upload a replacement");
  await expect(page.getByTestId("continue")).toHaveCount(0);
  await expect(page.getByTestId("quote-total").filter({ visible: true })).toContainText("Not quoted yet");
  await expect(page.getByRole("heading", { name: "We need a clearer photo." }).filter({ visible: true })).toBeVisible();

  await page.getByTestId("replace-page2").setInputFiles({
    name: "retake.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("replacement-photo"),
  });
  await expect(page.getByRole("heading", { name: "Reading your files…" }).filter({ visible: true })).toBeVisible();
});

test("an English quote can pick a target language and continue", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "credpronto-mock-order",
      JSON.stringify({
        status: "needs_review",
        sourceLanguage: "en",
        targetLanguage: "en",
        reviewReason:
          "The document appears to already be in English. A reviewer will confirm whether a translation is needed.",
        totalCents: 2985,
        billablePages: 3,
        unitPriceCents: 995,
        documents: [
          {
            id: "cv",
            filename: "GuyPearsonCV_under2MB.pdf",
            pageCount: 3,
            detectedLanguage: "en",
            confidence: 0.99,
            uploadPosition: 1,
            appliedPosition: 1,
          },
        ],
        pageOrder: {
          basis: "upload",
          pages: [1, 2, 3].map((page) => ({
            documentId: "cv",
            filename: "GuyPearsonCV_under2MB.pdf",
            uploadPosition: 1,
            appliedPosition: 1,
            uploadPage: page,
            appliedPage: page,
            logicalPage: null,
            hint: null,
            confidence: null,
          })),
        },
      }),
    );
  });

  await page.goto("/quote");
  const language = page.getByTestId("detected-language").filter({ visible: true });
  await expect(language).toContainText("English → English");
  await expect(page.getByTestId("target-language").filter({ visible: true })).toBeVisible();
  await expect(page.getByTestId("file-list").filter({ visible: true })).toContainText(
    "GuyPearsonCV_under2MB.pdf",
  );
  await expect(page.getByTestId("file-list").filter({ visible: true }).getByText("GuyPearsonCV_under2MB.pdf")).toHaveCount(1);
  await expect(page.getByTestId("page-order-basis").filter({ visible: true })).toHaveText(
    "We kept the pages in the order you uploaded them.",
  );
  await expect(page.getByTestId("page-order").filter({ visible: true })).toContainText("page 1");
  await expect(page.getByTestId("quote-total").filter({ visible: true })).toContainText("$29.85");
  await expect(page.locator("[data-testid=logo] img").first()).toHaveAttribute(
    "src",
    "/brand/credpronto-logo.svg",
  );

  await page.getByTestId("target-language").filter({ visible: true }).selectOption("es");
  await expect(language).toContainText("English → Spanish");
  await page.getByTestId("continue").filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/confirm\?/);
  await expect(page.getByRole("heading", { name: "Confirm the important details." })).toBeVisible();
  await expect(page.getByText("English → Spanish").filter({ visible: true })).toBeVisible();
});

test("the homepage sample opens larger, and a signed-in header shows Dashboard", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("see-sample").click();
  await expect(page.getByTestId("sample-dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("sample-dialog")).toHaveCount(0);

  await page.goto("/evaluations");
  await expect(page.getByTestId("nav-log-in")).toBeVisible();
  await expect(page.getByTestId("nav-get-started")).toBeVisible();
  await expect(page.getByText("Find my order")).toHaveCount(0);

  await signIn(page, "maria.ruiz@email.com");
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/");
  await expect(page.getByTestId("nav-dashboard")).toBeVisible();
  await expect(page.getByTestId("nav-log-in")).toHaveCount(0);
  await page.goto("/faq");
  await expect(page.getByTestId("nav-dashboard")).toBeVisible();
});
