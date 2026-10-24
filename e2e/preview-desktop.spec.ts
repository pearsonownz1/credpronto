import { expect, type Locator, test } from "@playwright/test";

async function expectPaintedPage(pane: Locator) {
  const image = pane.locator("img").first();
  await expect(image).toBeVisible({ timeout: 30_000 });
  const box = await image.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(20);
  expect(box!.height).toBeGreaterThan(20);
}

test("side-by-side preview syncs page and zoom", async ({ page }) => {
  const consoleText: string[] = [];
  const pdfiumUrls: string[] = [];
  page.on("console", (message) => {
    consoleText.push(message.text());
  });
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("pdfium") || url.includes("jsdelivr")) pdfiumUrls.push(url);
  });

  await page.goto("/preview/demo");

  const original = page.getByTestId("pane-original");
  const translation = page.getByTestId("pane-translation");

  await expect(original).toHaveAttribute("data-page", "1");
  await expect(translation).toHaveAttribute("data-page", "1");
  await expect(original.locator("img").first()).toBeVisible();
  await expect(translation.locator("img").first()).toBeVisible();
  await expect(original).toHaveAttribute("data-zoom-ready", "true");
  await expect(page.getByTestId("page-status")).toContainText("Page 1 of 3");
  await expect(page.getByTestId("translation-watermark")).toBeVisible();
  await expect(original.getByTestId("translation-watermark")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Review every page, then buy." })).toBeVisible();
  await expect(page.getByTestId("order-rail")).toContainText("Buy & download — $29.85");
  await expect(page.getByTestId("addon-panel")).toContainText("Notarization");
  await expect(page.getByTestId("addon-panel")).toContainText("$17.95");
  await expect(page.getByTestId("addon-panel")).toContainText("USPS Priority hard copy");
  await expect(page.getByTestId("addon-panel")).toContainText("$12.95");
  await expect(page.getByTestId("addon-expedited")).toHaveCount(0);
  await page.getByTestId("addon-mail").check();
  await expect(page.getByTestId("shipping-address")).toBeVisible();
  await expect(page.getByLabel("Street address")).toBeVisible();
  await expect(page.getByTestId("buy-download")).toContainText("Buy & download — $42.80");

  await page.getByTestId("flag-correction").click();
  await expect(page.getByTestId("correction-popover")).toContainText("page 1");
  await expect(page.getByTestId("correction-popover")).toContainText("image");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("correction-popover")).toHaveCount(0);

  const shell = await page.getByTestId("preview-shell").boundingBox();
  await page.getByTestId("next-page").click();
  await expect(original).toHaveAttribute("data-page", "2");
  await expect(translation).toHaveAttribute("data-page", "2");
  await expect(page.getByTestId("page-status")).toContainText("Page 2 of 3");
  const shellAfter = await page.getByTestId("preview-shell").boundingBox();
  expect(shellAfter).toEqual(shell);

  const before = Number(await original.getAttribute("data-zoom"));
  await page.getByTestId("zoom-in").click();
  await expect.poll(async () => Number(await original.getAttribute("data-zoom"))).toBeGreaterThan(before);
  const zoomedOriginal = Number(await original.getAttribute("data-zoom"));
  const zoomedTranslation = Number(await translation.getAttribute("data-zoom"));
  expect(Math.abs(zoomedOriginal - zoomedTranslation)).toBeLessThanOrEqual(1);

  await page.getByTestId("next-page").click();
  await expect(original).toHaveAttribute("data-page", "3");
  await expect(translation).toHaveAttribute("data-page", "3");

  const wasmRequests = pdfiumUrls.filter((url) => url.includes("/pdfium/pdfium.wasm"));
  expect(wasmRequests).toHaveLength(1);
  expect(pdfiumUrls.some((url) => url.includes("jsdelivr"))).toBe(false);
  expect(consoleText.join("\n")).not.toContain('unique "key" prop');
});

test("a 12-page sample renders without moving the shell", async ({ page }) => {
  await page.goto("/preview/demo?sample=long");
  const original = page.getByTestId("pane-original");
  await expect(original).toHaveAttribute("data-total", "12");
  await expect(page.getByTestId("pane-translation")).toHaveAttribute("data-page", "1");
  const shell = await page.getByTestId("preview-shell").boundingBox();
  expect(shell).not.toBeNull();
  for (let pageNumber = 2; pageNumber <= 10; pageNumber += 1) {
    await page.getByTestId("next-page").click();
    await expect(original).toHaveAttribute("data-page", String(pageNumber));
  }
  await expect(page.getByTestId("pane-translation")).toHaveAttribute("data-page", "10");
  expect(await page.getByTestId("preview-shell").boundingBox()).toEqual(shell);
});

test("adding an evaluation keeps the certified translation painted", async ({ page }) => {
  await page.goto("/dev/gcs-viewer");
  const original = page.getByTestId("pane-original");
  const translation = page.getByTestId("pane-translation");
  await expectPaintedPage(original);
  await expectPaintedPage(translation);
  await expect(page.getByTestId("pane-evaluation")).toHaveCount(0);

  const evaluate = page.getByTestId("evaluate-document");
  const download = page.getByTestId("download-certified");
  await expect(evaluate).toHaveText("Evaluate Document");
  await expect(evaluate).toHaveCSS("background-color", "rgb(31, 94, 255)");
  await expect(evaluate).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(download).toHaveCSS("background-color", "rgb(31, 94, 255)");
  await expect(download).toHaveCSS("color", "rgb(255, 255, 255)");
  await evaluate.click();

  const evaluation = page.getByTestId("pane-evaluation");
  await expect(evaluation).toBeVisible();
  await expectPaintedPage(original);
  await expectPaintedPage(translation);
  await expectPaintedPage(evaluation);
});

test("a viewer that already has an evaluation paints all three documents", async ({ page }) => {
  await page.goto("/dev/gcs-viewer?ready=1");
  await expectPaintedPage(page.getByTestId("pane-original"));
  await expectPaintedPage(page.getByTestId("pane-translation"));
  await expectPaintedPage(page.getByTestId("pane-evaluation"));
});
