import { expect, test } from "@playwright/test";
import { walkCustomerFlow } from "./flow-walkthrough";

test("the turnaround stacks under the filename on a phone", async ({ page }) => {
  await page.goto("/order/mock-token");
  const row = page.getByTestId("file-row").filter({ visible: true }).first();
  const filename = row.locator("b");
  const turnaround = row.getByTestId("file-turnaround");
  await expect(turnaround).toContainText("Ready in about 10 minutes");
  const nameBox = await filename.boundingBox();
  const turnBox = await turnaround.boundingBox();
  expect(nameBox).toBeTruthy();
  expect(turnBox).toBeTruthy();
  expect(turnBox!.y).toBeGreaterThan(nameBox!.y + nameBox!.height - 2);
  expect(turnBox!.x).toBeLessThan(nameBox!.x + 24);
  const frame = row.getByTestId("page-viewer-frame");
  await expect(frame).toBeVisible();
  await expect(row.getByTestId("page-viewer-label")).toHaveText("Page 1");
  const rowBox = await row.boundingBox();
  const frameBox = await frame.boundingBox();
  expect(rowBox).toBeTruthy();
  expect(frameBox).toBeTruthy();
  expect(frameBox!.width).toBeGreaterThan(rowBox!.width - 48);
  expect(frameBox!.width).toBeLessThan(400);
});

test("customer flow fits a 390px phone", async ({ page }) => {
  await walkCustomerFlow(page, { checkOverflow: true });
});
