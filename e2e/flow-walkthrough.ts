import { expect, type Page } from "@playwright/test";
import { WORD_PAGE_RULE } from "../src/lib/orders/billing";

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
  await expect(page.getByText("No account, no card.")).toBeVisible();
  await expect(shown(page, "upload-drop")).toBeVisible();
  await expect(shown(page, "email")).toHaveValue("maria.ruiz@email.com");
  await expect(shown(page, "file-list")).toContainText("acta-nacimiento.pdf");
  await expect(shown(page, "file-list")).toContainText("IMG_4021.HEIC");
  await check();

  await page.getByRole("link", { name: "Get your free preview" }).click();
  await expect(page).toHaveURL(/\/translate$/);
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
  await expect(shown(page, "file-list")).toContainText("1 page");
  await expect(shown(page, "quote-total")).toContainText("$19.90");
  await expect(shown(page, "order-email")).toContainText("maria.ruiz@email.com");
  await expect(page.getByText("Free", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(shown(page, "page-rule")).toHaveText(WORD_PAGE_RULE);
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
  await expect(shown(page, "progress-bar")).toBeVisible();
  await expect(page.getByText("Files received").filter({ visible: true })).toBeVisible();
  await expect(page.getByText("278 words").filter({ visible: true })).toBeVisible();
  await expect(page.getByText("~4 min left").filter({ visible: true })).toBeVisible();
  await expect(shown(page, "add-documents")).toBeVisible();
  await expect(shown(page, "flow-stepper").locator("[data-state=current]")).toContainText(
    "Preview",
  );
  await check();

  await shown(page, "preview-ready").click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(shown(page, "email")).toHaveValue("maria.ruiz@email.com");
  await expect(shown(page, "order-total")).toContainText("$19.90");
  await expect(shown(page, "pay-button")).toContainText("Pay $19.90");
  await expect(shown(page, "flow-stepper").locator("[data-state=current]")).toContainText(
    "Preview",
  );
  await check();

  await shown(page, "pay-button").click();
  await expect(page).toHaveURL(/\/order\/mock-token\?checkout=success$/);
  await expect(shown(page, "download-certified")).toBeVisible();
  await expect(shown(page, "download-certified-name")).toHaveText(
    "acta-nacimiento-EN-certified.pdf",
  );
  await expect(shown(page, "download-certification-name")).toHaveText("certification.pdf");
  await expect(shown(page, "download-original-acta")).toHaveText("Download original");
  await expect(shown(page, "download-original-acta-name")).toHaveText("acta-nacimiento.pdf");
  await expect(shown(page, "download-original-back-name")).toHaveText("IMG_4021.HEIC");
  await expect(shown(page, "email-note")).toContainText("maria.ruiz@email.com");
  await expect(shown(page, "email-note")).toContainText("CP-24817");
  await expect(shown(page, "email-note")).toContainText("$19.90");
  await expect(shown(page, "flow-stepper").locator("[data-state=done]")).toHaveCount(5);
  await check();
}
