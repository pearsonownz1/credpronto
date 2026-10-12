import { expect, type Page } from "@playwright/test";

export const imageQualityOrder = {
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
      qualityFlags: ["too_dark", "blurry"],
      qualityMessage:
        "It looks blurry. It is too dark. Retake it in even light, with the whole page in the frame and the text sharp, then upload a replacement.",
    },
    {
      documentId: "page1",
      pageNumber: 1,
      uploadPage: 1,
      logicalPage: 1,
      orderHint: "page 1/2",
      qualityScore: 0.72,
      qualityFlags: ["glare", "cropped"],
      qualityMessage:
        "The crop cuts off the text. Glare covers the text. Retake it in even light, with the whole page in the frame and the text sharp, then upload a replacement.",
    },
  ],
};

export async function openImageQualityOrder(page: Page) {
  await page.addInitScript((order) => {
    sessionStorage.setItem("credpronto-mock-order", JSON.stringify(order));
  }, imageQualityOrder);
  await page.goto("/order/CP-24817");
}

export async function expectRetakeCard(page: Page) {
  await expect(page.getByTestId("review-note")).toHaveCount(0);
  await expect(page.getByTestId("file-list")).toHaveCount(0);
  const order = page.getByTestId("page-order").filter({ visible: true });
  await expect(order).toContainText("printed page numbers");
  const thumbs = page.getByTestId("retake-page").filter({ visible: true });
  await expect(thumbs).toHaveCount(2);
  await expect(thumbs.nth(0)).toContainText("scan-page-1.jpg");
  await expect(thumbs.nth(0)).toContainText("printed page 1");
  await expect(thumbs.nth(0).getByTestId("quality-flag-cropped")).toHaveText("Cropped");
  await expect(thumbs.nth(0).getByTestId("quality-flag-glare")).toHaveText("Glare");
  await expect(thumbs.nth(1)).toContainText("scan-page-2.jpg");
  await expect(thumbs.nth(1).getByTestId("quality-flag-blurry")).toHaveText("Blurry");
  await expect(thumbs.nth(1).getByTestId("quality-flag-too_dark")).toHaveText("Too dark");
  const quality = page.getByTestId("image-quality").filter({ visible: true });
  await expect(quality).toContainText("blurry");
  await expect(quality).toContainText("Upload a clearer photo");
  await expect(page.getByTestId("continue")).toHaveCount(0);
  await expect(page.getByTestId("quote-total").filter({ visible: true })).toContainText(
    "Not quoted yet",
  );
  await expect(
    page.getByRole("heading", { name: "We need a clearer photo." }).filter({ visible: true }),
  ).toBeVisible();
}
