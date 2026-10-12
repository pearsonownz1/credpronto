import { expect, test } from "@playwright/test";

test("mobile toggle keeps the page and zoom", async ({ page }) => {
  await page.goto("/preview/demo");

  const original = page.getByTestId("pane-original");
  await expect(original).toHaveAttribute("data-page", "1");
  await expect(page.getByTestId("pane-translation")).toHaveCount(0);
  await expect(original.locator("img").first()).toBeVisible();

  await page.getByTestId("next-page").click();
  await expect(original).toHaveAttribute("data-page", "2");

  const before = Number(await original.getAttribute("data-zoom"));
  await page.getByTestId("zoom-in").click();
  await expect.poll(async () => Number(await original.getAttribute("data-zoom"))).toBeGreaterThan(before);
  const zoom = await original.getAttribute("data-zoom");

  await page.getByTestId("doc-toggle-translation").click();
  const translation = page.getByTestId("pane-translation");
  await expect(translation).toHaveAttribute("data-page", "2");
  await expect(translation).toHaveAttribute("data-zoom", zoom ?? "");
  await expect(page.getByTestId("pane-original")).toHaveCount(0);
  await expect(page.getByTestId("translation-watermark")).toBeVisible();

  await page.getByTestId("doc-toggle-original").click();
  await expect(page.getByTestId("pane-original")).toHaveAttribute("data-page", "2");
  await expect(page.getByTestId("pane-original")).toHaveAttribute("data-zoom", zoom ?? "");
});
