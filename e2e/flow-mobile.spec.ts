import { expect, test } from "@playwright/test";
import { MOCK_TOKEN } from "../src/lib/flow/session";
import { walkCustomerFlow } from "./flow-walkthrough";

test("the turnaround row stays full width on a phone", async ({ page }) => {
  await page.goto(`/order/${MOCK_TOKEN}`);
  const row = page.getByTestId("file-row").filter({ visible: true }).first();
  await expect(page.getByTestId("file-turnaround")).toHaveCount(0);
  const turnaround = page.getByTestId("quote-turnaround").filter({ visible: true });
  await expect(turnaround).toContainText(/turnaround time/i);
  await expect(turnaround).toContainText("3 minutes");
  const summary = turnaround.locator("xpath=ancestor::div[contains(@class,'border-line')][1]");
  const summaryBox = await summary.boundingBox();
  const turnBox = await turnaround.boundingBox();
  const label = turnaround.getByText(/turnaround time/i);
  const time = turnaround.getByText("3 minutes");
  const pill = turnaround.getByText("Fast", { exact: true });
  const labelBox = await label.boundingBox();
  const timeBox = await time.boundingBox();
  const pillBox = await pill.boundingBox();
  expect(summaryBox).toBeTruthy();
  expect(turnBox).toBeTruthy();
  expect(labelBox).toBeTruthy();
  expect(timeBox).toBeTruthy();
  expect(pillBox).toBeTruthy();
  expect(turnBox!.width).toBeGreaterThan(summaryBox!.width - 40);
  expect(timeBox!.y).toBeGreaterThan(labelBox!.y);
  expect(pillBox!.x).toBeGreaterThan(timeBox!.x + timeBox!.width - 4);
  expect(pillBox!.x + pillBox!.width).toBeLessThanOrEqual(turnBox!.x + turnBox!.width + 1);
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
