import { expect, test } from "@playwright/test";

test("preview groups pages by document and the order links each original", async ({
  page,
}) => {
  await page.goto("/preview/mock-token");

  const status = page.getByTestId("page-status");
  await expect(status).toContainText("Page 1 of 3");
  await expect(status).toContainText("acta-nacimiento.pdf");
  await expect(page.getByTestId("document-acta")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("document-back")).toBeVisible();

  await page.getByTestId("document-back").click();
  await expect(page.getByTestId("pane-original")).toHaveAttribute("data-page", "2");
  await expect(status).toContainText("IMG_4021.HEIC");
  await expect(page.getByTestId("document-back")).toHaveAttribute("aria-pressed", "true");

  await page.screenshot({ path: "artifacts/preview-documents.png" });

  await page.evaluate(() => {
    sessionStorage.setItem(
      "credpronto-mock-order",
      JSON.stringify({
        status: "paid",
        payment: { status: "paid_test" },
        delivery: { status: "approved" },
      }),
    );
  });
  await page.goto("/order/mock-token?checkout=success");
  await expect(page.getByTestId("email-note")).toContainText("maria.ruiz@email.com");
  await expect(page.getByTestId("download-original-acta")).toHaveText("Download original");
  await expect(page.getByTestId("download-original-back")).toHaveAttribute(
    "download",
    "IMG_4021.HEIC",
  );
  await page.screenshot({ path: "artifacts/order-originals.png", fullPage: true });
});
