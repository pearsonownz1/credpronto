import { expect, test } from "@playwright/test";

test("side-by-side preview syncs page and zoom", async ({ page }) => {
  await page.goto("/preview/demo");

  const original = page.getByTestId("pane-original");
  const translation = page.getByTestId("pane-translation");

  await expect(original).toHaveAttribute("data-page", "1");
  await expect(translation).toHaveAttribute("data-page", "1");
  await expect(original.locator("img").first()).toBeVisible();
  await expect(translation.locator("img").first()).toBeVisible();
  await expect(page.getByTestId("page-status")).toContainText("Page 1 of 3");
  await expect(page.getByTestId("translation-watermark")).toBeVisible();
  await expect(original.getByTestId("translation-watermark")).toHaveCount(0);

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

  await page.getByTestId("thumb-original-3").click();
  await expect(original).toHaveAttribute("data-page", "3");
  await expect(translation).toHaveAttribute("data-page", "3");
});

test("a 12-page sample renders without moving the shell", async ({ page }) => {
  await page.goto("/preview/demo?sample=long");
  const shell = await page.getByTestId("preview-shell").boundingBox();
  const original = page.getByTestId("pane-original");
  await expect(original).toHaveAttribute("data-total", "12");
  await expect(page.getByTestId("pane-translation")).toHaveAttribute("data-page", "1");
  await page.getByTestId("thumb-translation-10").click();
  await expect(original).toHaveAttribute("data-page", "10");
  await expect(page.getByTestId("pane-translation")).toHaveAttribute("data-page", "10");
  expect(await page.getByTestId("preview-shell").boundingBox()).toEqual(shell);
});
