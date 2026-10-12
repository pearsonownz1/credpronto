import { expect, test } from "@playwright/test";
import { CJK_PAGE_RULE } from "../src/lib/orders/billing";
import { QUOTE_BILLING_NOTE } from "../src/lib/flow/present";
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
  await expect(page.getByTestId("page-rule").filter({ visible: true })).toHaveText(QUOTE_BILLING_NOTE);
  await expect(page.getByTestId("quote-counts").filter({ visible: true })).toHaveText(
    "2 files, 2 pages, 2 billable",
  );
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

  await expect(page.getByTestId("continue")).toHaveCount(0);
  await expect(page.getByTestId("update-language").filter({ visible: true })).toBeDisabled();

  await page.getByTestId("target-language").filter({ visible: true }).selectOption("es");
  await expect(language).toContainText("English → Spanish");
  await expect(page.getByTestId("quote-counts").filter({ visible: true })).toHaveText(
    "1 file, 3 pages, 3 billable",
  );
  await expect(page.getByText("3 billable pages × $9.95").filter({ visible: true })).toBeVisible();
  await page.getByTestId("update-language").filter({ visible: true }).click();
  await expect(page.getByTestId("continue").filter({ visible: true })).toBeVisible();
  await expect(page.getByTestId("language-update-note")).toHaveCount(0);
  await page.getByTestId("continue").filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/confirm\?/);
  await expect(page.getByRole("heading", { name: "Confirm the important details." })).toBeVisible();
  await expect(page.getByText("English → Spanish").filter({ visible: true })).toBeVisible();
});

test("a quote shows billable pages and can skip one", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "credpronto-mock-order",
      JSON.stringify({
        status: "quoted",
        sourceLanguage: "es",
        targetLanguage: "en",
        billablePages: 3,
        unitPriceCents: 995,
        totalCents: 2985,
        documents: [
          {
            id: "cv",
            filename: "diploma.pdf",
            pageCount: 3,
            detectedLanguage: "es",
            confidence: 0.95,
            uploadPosition: 1,
            appliedPosition: 1,
          },
        ],
        pages: [
          {
            id: "p1",
            documentId: "cv",
            pageNumber: 1,
            uploadPage: 1,
            logicalPage: null,
            orderHint: null,
            qualityScore: null,
            qualityFlags: [],
            qualityMessage: null,
            billableUnits: 1,
          },
          {
            id: "p2",
            documentId: "cv",
            pageNumber: 2,
            uploadPage: 2,
            logicalPage: null,
            orderHint: null,
            qualityScore: null,
            qualityFlags: [],
            qualityMessage: null,
            billableUnits: 2,
          },
          {
            id: "p3",
            documentId: "cv",
            pageNumber: 3,
            uploadPage: 3,
            logicalPage: null,
            orderHint: null,
            qualityScore: null,
            qualityFlags: [],
            qualityMessage: null,
            billableUnits: 1,
            skip: true,
            skipReason: "not a document",
          },
        ],
      }),
    );
  });

  await page.goto("/quote");
  const counts = page.getByTestId("quote-counts").filter({ visible: true });
  await expect(counts).toHaveText("1 file, 3 pages, 3 billable");
  await expect(page.getByText("3 billable pages × $9.95").filter({ visible: true })).toBeVisible();
  await expect(page.getByTestId("quote-total").filter({ visible: true })).toContainText("$29.85");
  await expect(page.getByTestId("billed-as").filter({ visible: true })).toHaveText("billed as 2");
  const skipped = page.getByTestId("page-row").filter({ hasText: "Skipped: not a document" });
  await expect(skipped).toBeVisible();
  await expect(skipped.locator("span.line-through")).toBeVisible();
  await expect(page.getByTestId("page-rule").filter({ visible: true })).toHaveText(QUOTE_BILLING_NOTE);

  await page.getByTestId("page-skip-1").getByRole("button", { name: "Skip" }).click();
  await expect(counts).toHaveText("1 file, 3 pages, 1 billable");
  await expect(page.getByText("1 billable page × $9.95").filter({ visible: true })).toBeVisible();
  await expect(page.getByTestId("quote-total").filter({ visible: true })).toContainText("$9.95");
  const dense = page.getByTestId("page-row").filter({ hasText: "page 2" });
  await expect(dense.locator("span.line-through")).toBeVisible();
  await expect(dense).toContainText("Skipped");
  await expect(page.getByTestId("page-skip-1").getByRole("button", { name: "Skip" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByTestId("page-skip-1").getByRole("button", { name: "Translate" }).click();
  await expect(counts).toHaveText("1 file, 3 pages, 3 billable");
  await expect(page.getByTestId("quote-total").filter({ visible: true })).toContainText("$29.85");
  await expect(page.getByTestId("billed-as").filter({ visible: true })).toHaveText("billed as 2");

  await page.evaluate(() => sessionStorage.setItem("credpronto-mock-quote-error", "400"));
  await page.getByTestId("page-skip-1").getByRole("button", { name: "Skip" }).click();
  await expect(page.getByTestId("skip-error").filter({ visible: true })).toHaveText(
    "We couldn't update that page.",
  );
  await expect(page.getByTestId("page-skip-1").getByRole("button", { name: "Skip" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(counts).toHaveText("1 file, 3 pages, 3 billable");
  await expect(page.getByTestId("quote-total").filter({ visible: true })).toContainText("$29.85");
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
