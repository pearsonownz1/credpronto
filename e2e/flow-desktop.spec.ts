import { expect, test } from "@playwright/test";
import { CJK_PAGE_RULE } from "../src/lib/orders/billing";
import { QUOTE_BILLING_NOTE } from "../src/lib/flow/present";
import { MOCK_TOKEN } from "../src/lib/flow/session";
import { signIn } from "./account";
import { walkCustomerFlow } from "./flow-walkthrough";

test("customer walks from landing through download", async ({ page }) => {
  await walkCustomerFlow(page);
});

test("a quote file shows a large page viewer and opens it full size", async ({ page }) => {
  await page.goto(`/order/${MOCK_TOKEN}`);
  await expect(page.getByRole("heading", { name: /exact price/ }).filter({ visible: true })).toBeVisible();
  const list = page.getByTestId("file-list").filter({ visible: true });
  await expect(page.getByTestId("file-turnaround")).toHaveCount(0);
  const turnaround = page.getByTestId("quote-turnaround").filter({ visible: true });
  await expect(turnaround).toContainText(/turnaround time/i);
  await expect(turnaround).toContainText("3 minutes");
  await expect(turnaround).toContainText("Fast");
  const time = turnaround.getByText("3 minutes");
  const pill = turnaround.getByText("Fast", { exact: true });
  const timeBox = await time.boundingBox();
  const pillBox = await pill.boundingBox();
  expect(timeBox).toBeTruthy();
  expect(pillBox).toBeTruthy();
  expect(pillBox!.x).toBeGreaterThan(timeBox!.x + timeBox!.width - 4);

  const row = list.getByTestId("file-row").filter({ hasText: "acta-nacimiento.pdf" });
  await expect(row.getByTestId("file-billable")).toBeVisible();
  await expect(page.getByTestId("page-details")).toHaveCount(0);
  await expect(page.getByTestId("file-thumb-button")).toHaveCount(0);
  await expect(page.getByTestId("page-thumb")).toHaveCount(0);

  const viewer = row.getByTestId("page-viewer");
  await expect(viewer.getByTestId("page-viewer-label")).toHaveText("Page 1");
  await expect(viewer).not.toContainText(/\bof \d+/);
  const frame = viewer.getByTestId("page-viewer-frame");
  const frameBox = await frame.boundingBox();
  expect(frameBox).toBeTruthy();
  expect(Math.round(frameBox!.width)).toBe(420);
  await viewer.getByTestId("page-viewer-next").click();
  await expect(viewer.getByTestId("page-viewer-label")).toHaveText("Page 2");
  await expect(viewer.getByTestId("page-viewer-page").locator("img")).toBeVisible();
  await viewer.getByTestId("page-viewer-prev").click();
  await expect(viewer.getByTestId("page-viewer-label")).toHaveText("Page 1");

  await viewer.getByTestId("page-viewer-page").click();
  const preview = page.getByTestId("file-preview");
  await expect(preview).toBeVisible();
  await expect(preview.getByTestId("file-preview-page")).toHaveCount(1);
  await expect(preview).toContainText("Page 1");
  await expect(preview).not.toContainText(/\bof \d+/);
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();

  await viewer.getByTestId("page-viewer-page").click();
  await expect(preview).toBeVisible();
  await page.mouse.click(8, 8);
  await expect(preview).toBeHidden();
});

test("a missing source file hides the page viewer", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("credpronto-mock-source-missing", "1");
  });
  await page.goto(`/order/${MOCK_TOKEN}`);
  await expect(page.getByRole("heading", { name: /exact price/ }).filter({ visible: true })).toBeVisible();
  await expect(page.getByTestId("page-viewer")).toHaveCount(0);
  await expect(page.getByTestId("file-thumb-fallback")).toHaveCount(0);
  await expect(page.getByTestId("file-thumb-skeleton")).toHaveCount(0);
  await expect(page.getByTestId("file-turnaround")).toHaveCount(0);
  await expect(page.getByTestId("quote-turnaround").filter({ visible: true })).toContainText("3 minutes");
});

test("a loaded quote replaces the loading announcement", async ({ page }) => {
  await page.goto(`/order/${MOCK_TOKEN}`);
  await expect(page.getByRole("heading", { name: /exact price/ }).filter({ visible: true })).toBeVisible();
  await expect(page.getByTestId("order-announcement")).toHaveText("Quote ready: 2 pages, $19.90");
  const routeAnnouncement = await page.evaluate(() => {
    const host = document.getElementsByTagName("next-route-announcer")[0];
    return host?.shadowRoot?.querySelector("#__next-route-announcer__")?.textContent ?? "";
  });
  expect(routeAnnouncement).not.toContain("Loading your order");
});

test("upload shows the reading progress immediately, with no loading screen", async ({ page }) => {
  await page.goto("/translate");
  const email = page.getByTestId("email").filter({ visible: true });
  await expect(email).toHaveValue("maria.ruiz@email.com");
  await page.evaluate(() => {
    sessionStorage.setItem("credpronto-mock-upload-ms", "1200");
    sessionStorage.setItem("credpronto-mock-order-route", "1");
  });
  await page.getByTestId("get-quote").filter({ visible: true }).click();

  const label = page.getByTestId("reading-label").filter({ visible: true });
  await expect(label).toHaveText("Uploading");
  await expect(
    page.getByRole("heading", { name: "Reading your files…" }).filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByTestId("reading-step-uploaded").filter({ visible: true })).toHaveAttribute(
    "data-state",
    "current",
  );
  expect(await page.getByText("Loading your order").count()).toBe(0);
  expect(await page.getByText("The price will show here in a moment.").count()).toBe(0);
  await expect(page.getByRole("button", { name: "Uploading…" })).toHaveCount(0);

  await expect(page).toHaveURL(new RegExp(`/order/${MOCK_TOKEN}$`));
  await expect(
    page.getByRole("heading", { name: /exact price/ }).filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByTestId("reading-handoff")).toHaveCount(0);
  expect(await page.getByText("Loading your order").count()).toBe(0);
  expect(await page.getByText("The price will show here in a moment.").count()).toBe(0);
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
  await expect(page.getByTestId("quote-counts")).toHaveCount(0);
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
  const files = page.getByTestId("file-list").filter({ visible: true });
  await expect(files).toContainText("scan-page-1.jpg");
  await expect(files).toContainText("scan-page-2.jpg");
  await expect(files).not.toContainText("printed page");
  await expect(files).not.toContainText("We kept the pages in the order you uploaded them.");
  await expect(page.getByTestId("page-row").filter({ visible: true })).toHaveCount(0);
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
  await expect(page.getByTestId("file-billable").filter({ visible: true })).toHaveText(
    "3 billable pages",
  );
  await expect(page.getByTestId("page-details")).toHaveCount(0);
  await expect(page.getByTestId("page-row")).toHaveCount(0);
  await expect(page.getByText("We kept the pages in the order you uploaded them.")).toHaveCount(0);
  await expect(page.getByTestId("quote-total").filter({ visible: true })).toContainText("$29.85");
  await expect(page.locator("[data-testid=logo] img").first()).toHaveAttribute(
    "src",
    "/brand/credpronto-logo.svg",
  );

  await expect(page.getByTestId("continue")).toHaveCount(0);
  await expect(page.getByTestId("update-language").filter({ visible: true })).toBeDisabled();

  await page.getByTestId("target-language").filter({ visible: true }).selectOption("es");
  await expect(language).toContainText("English → Spanish");
  await expect(page.getByTestId("quote-counts")).toHaveCount(0);
  await expect(page.getByText("3 pages × $9.95").filter({ visible: true })).toBeVisible();
  await page.getByTestId("update-language").filter({ visible: true }).click();
  await expect(page.getByTestId("continue").filter({ visible: true })).toBeVisible();
  await expect(page.getByTestId("language-update-note")).toHaveCount(0);
  await page.getByTestId("continue").filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/confirm\?/);
  await expect(page.getByRole("heading", { name: "Confirm the important details." })).toBeVisible();
  await expect(page.getByText("English → Spanish").filter({ visible: true })).toBeVisible();
});

test("a quote shows billable pages and dims a free page in the large viewer", async ({ page }) => {
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
  await expect(page.getByTestId("quote-counts")).toHaveCount(0);
  await expect(page.getByTestId("file-billable").filter({ visible: true })).toHaveText(
    "3 billable pages",
  );
  await expect(page.getByText("3 pages × $9.95").filter({ visible: true })).toBeVisible();
  await expect(page.getByTestId("quote-total").filter({ visible: true })).toContainText("$29.85");
  await expect(page.getByTestId("page-details")).toHaveCount(0);
  await expect(page.getByTestId("page-row")).toHaveCount(0);
  await expect(page.getByTestId("page-status")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Translate" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Skip" })).toHaveCount(0);
  await expect(page.getByTestId("page-rule").filter({ visible: true })).toHaveText(QUOTE_BILLING_NOTE);
  await expect(page.getByTestId("billing-info")).toHaveAttribute("title", QUOTE_BILLING_NOTE);

  const viewer = page.getByTestId("page-viewer").filter({ visible: true });
  await expect(viewer.getByTestId("page-viewer-label")).toHaveText("Page 1");
  await expect(viewer).not.toContainText(/\bof \d+/);
  await expect(viewer.getByTestId("page-viewer-status")).toHaveCount(0);
  await viewer.getByTestId("page-viewer-next").click();
  await viewer.getByTestId("page-viewer-next").click();
  await expect(viewer.getByTestId("page-viewer-label")).toHaveText("Page 3");
  await expect(viewer.getByTestId("page-viewer-status")).toHaveText("Free (not a document)");
  await expect(viewer.getByTestId("page-viewer-page").locator("img")).toHaveClass(/opacity-40/);
});

test("a finished translation in review waits without a stuck progress bar", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "credpronto-mock-order",
      JSON.stringify({
        status: "needs_review",
        delayed: true,
        reviewReason: "translation_timeout",
        orderType: "translation",
        progress: {
          step: "done",
          pagesRead: 2,
          pagesTotal: 2,
          pagesDone: 9,
          pagesTranslateTotal: 9,
        },
      }),
    );
  });

  await page.goto(`/order/${MOCK_TOKEN}`);
  await expect(page.getByTestId("preview-held").filter({ visible: true })).toHaveText(
    "A translator is reviewing your document. We'll email you when it's ready.",
  );
  await expect(page.getByTestId("order-announcement")).toHaveText(
    "A translator is reviewing your document. We'll email you when it's ready.",
  );
  await expect(page.getByTestId("progress-bar")).toHaveCount(0);
  await expect(page.getByTestId("preview-percent")).toHaveCount(0);
  await expect(page.locator(".reading-spinner")).toHaveCount(0);
  await expect(page.getByText("98%")).toHaveCount(0);
  await expect(page.getByText(/Usually ready in 3 minutes/)).toHaveCount(0);
  await expect(page.getByText("María Fernanda Ruiz Delgado")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/order/${MOCK_TOKEN}$`));

  await page.evaluate(() => {
    const key = "credpronto-mock-order";
    const order = JSON.parse(sessionStorage.getItem(key) || "{}");
    order.status = "preview_ready";
    sessionStorage.setItem(key, JSON.stringify(order));
  });
  await expect(page).toHaveURL(new RegExp(`/preview/${MOCK_TOKEN}$`));
  await expect(page.getByRole("heading", { name: "Your preview is ready" })).toHaveCount(0);
  await expect(page.getByTestId("view-preview")).toHaveCount(0);
});

test("the homepage preview is on the page, and a signed-in header shows Dashboard", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("translation-preview")).toBeVisible();
  await expect(page.getByText("8 CFR 103.2(b)(3)")).toBeVisible();
  await page.getByText("Does USCIS accept CredPronto translations?").click();
  await expect(page.getByText(/Read our USCIS translation guide/)).toBeVisible();

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
