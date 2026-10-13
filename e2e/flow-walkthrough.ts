import { expect, type Page } from "@playwright/test";
import { QUOTE_BILLING_NOTE } from "../src/lib/flow/present";
import { MOCK_TOKEN } from "../src/lib/flow/session";

async function expectNoHorizontalOverflow(page: Page) {
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflows).toBe(false);
}

/** Next keeps the previous route mounted and hidden. Match the page on screen. */
function shown(page: Page, testId: string) {
  return page.getByTestId(testId).filter({ visible: true });
}

export async function walkCustomerFlow(
  page: Page,
  options?: { checkOverflow?: boolean },
) {
  const check = async () => {
    if (options?.checkOverflow) await expectNoHorizontalOverflow(page);
  };

  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: /Your documents/ }),
  ).toBeVisible();
  await expect(page.getByTestId("upload-drop")).toHaveCount(0);
  await expect(page.getByTestId("nav-log-in")).toBeVisible();
  await expect(page.getByTestId("nav-get-started")).toBeVisible();
  await expect(page.getByTestId("cover-sample")).toBeVisible();
  await expect(page.getByText("Signed certification included")).toBeVisible();
  await expect(page.getByText("Sample certificate · example data")).toBeVisible();
  await expect(page.getByText(/USCIS accepts/i)).toHaveCount(0);
  await check();

  await page.getByTestId("nav-get-started").click();
  await expect(page).toHaveURL(/\/translate$/);
  await expect(shown(page, "upload-drop")).toBeVisible();
  await expect(shown(page, "email")).toHaveValue("maria.ruiz@email.com");
  await expect(shown(page, "file-list")).toContainText("acta-nacimiento.pdf");
  await expect(shown(page, "file-list")).toContainText("IMG_4021.HEIC");
  await expect(shown(page, "flow-stepper").locator("[data-state=current]")).toContainText(
    "Upload",
  );
  await expect(page.getByRole("main")).not.toContainText(/sign in|account/i);
  await check();

  await shown(page, "get-quote").click();
  await expect(page).toHaveURL(/\/quote$/);
  await expect(shown(page, "detected-language")).toContainText("Spanish → English");
  await expect(shown(page, "file-list")).toContainText("acta-nacimiento.pdf");
  await expect(shown(page, "file-list")).toContainText("IMG_4021.HEIC");
  await expect(shown(page, "file-list")).toContainText("1 billable page");
  await expect(page.getByTestId("file-turnaround")).toHaveCount(0);
  await expect(shown(page, "quote-turnaround")).toContainText("3 minutes");
  await expect(shown(page, "quote-turnaround")).toContainText("Fast");
  await expect(page.getByTestId("quote-counts")).toHaveCount(0);
  await expect(shown(page, "quote-total")).toContainText("$19.90");
  await expect(page.getByText("2 pages × $9.95").filter({ visible: true })).toBeVisible();
  await expect(page.getByText("Free", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(shown(page, "page-rule")).toHaveText(QUOTE_BILLING_NOTE);
  await expect(shown(page, "flow-stepper").locator("[data-state=current]")).toContainText(
    "Quote",
  );
  await check();

  await shown(page, "continue").click();
  await expect(page).toHaveURL(/\/confirm/);
  await expect(page.getByLabel("Full name on document · acta-nacimiento.pdf")).toHaveValue(
    "María Fernanda Ruiz Delgado",
  );
  await expect(page.getByLabel("Date of birth · acta-nacimiento.pdf")).toHaveValue(
    "14 March 1994",
  );
  await expect(page.getByLabel("Father · acta-nacimiento.pdf")).toHaveValue(
    "Jorge Luis Ruiz Pérez",
  );
  await expect(page.getByLabel("Mother · acta-nacimiento.pdf")).toHaveValue(
    "Ana María Delgado Soto",
  );
  await expect(page.getByLabel("Place of birth · acta-nacimiento.pdf")).toHaveValue(
    "Guadalajara, Jalisco, Mexico",
  );
  await expect(page.getByLabel("Date format · acta-nacimiento.pdf")).toHaveValue("MM/DD/YYYY");
  await check();

  await shown(page, "start-preview").click();
  await expect(page).toHaveURL(/\/processing$/);
  await expect(page.getByRole("heading", { name: "Translating your document" }).filter({ visible: true })).toBeVisible();
  await expect(shown(page, "progress-bar")).toBeVisible();
  await expect(shown(page, "preview-step-translating")).toHaveAttribute("data-state", "current");
  await expect(shown(page, "preview-step-ready")).toHaveAttribute("data-state", "pending");
  const progress = Number(await shown(page, "progress-bar").getAttribute("aria-valuenow"));
  expect(progress).toBeGreaterThan(0);
  expect(progress).toBeLessThan(100);
  await expect(shown(page, "view-preview")).toHaveCount(0);
  await expect(shown(page, "add-documents")).toBeVisible();
  await expect(shown(page, "flow-stepper").locator("[data-state=current]")).toContainText(
    "Preview",
  );
  await check();

  await page.evaluate(() => {
    const key = "credpronto-mock-order";
    const order = JSON.parse(sessionStorage.getItem(key) || "{}");
    order.status = "preview_ready";
    sessionStorage.setItem(key, JSON.stringify(order));
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your preview is ready" }).filter({ visible: true })).toBeVisible();
  await expect(shown(page, "preview-steps")).toHaveCount(0);
  await expect(shown(page, "view-preview")).toBeVisible();
  await check();

  await shown(page, "view-preview").click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(shown(page, "email")).toHaveValue("maria.ruiz@email.com");
  await expect(shown(page, "order-total")).toContainText("$19.90");
  await expect(shown(page, "pay-button")).toContainText("Pay $19.90");
  await expect(shown(page, "flow-stepper").locator("[data-state=current]")).toContainText(
    "Preview",
  );
  await check();

  await shown(page, "pay-button").click();
  await expect(page).toHaveURL(new RegExp(`/order/${MOCK_TOKEN}\\?checkout=success$`));
  await expect(shown(page, "download-certified")).toBeVisible();
  await expect(shown(page, "download-certified")).toHaveAttribute(
    "download",
    "birth-certificate-EN-certified.pdf",
  );
  await expect(shown(page, "download-certification")).toHaveAttribute(
    "download",
    "certification.pdf",
  );
  await expect(shown(page, "email-note")).toContainText("maria.ruiz@email.com");
  await expect(shown(page, "email-note")).toContainText("CP-24817");
  await expect(shown(page, "email-note")).toContainText("$19.90");
  await expect(shown(page, "flow-stepper").locator("[data-state=done]")).toHaveCount(4);
  await expect(shown(page, "flow-stepper").locator("[data-state=current]")).toContainText(
    "Download",
  );
  await check();
}
