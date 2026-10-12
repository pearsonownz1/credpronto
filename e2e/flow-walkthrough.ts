import { expect, type Page } from "@playwright/test";

const PAGE_RULE =
  "A page is one side of your original, up to 250 words. Longer sides count as another page.";

async function expectNoHorizontalOverflow(page: Page) {
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflows).toBe(false);
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
  await expect(page.getByTestId("upload-drop")).toBeVisible();
  await expect(page.getByTestId("email")).toHaveValue("maria.ruiz@email.com");
  await expect(page.getByTestId("file-list")).toContainText("acta-nacimiento.pdf");
  await expect(page.getByTestId("file-list")).toContainText("IMG_4021.HEIC");
  await check();

  await page.getByRole("link", { name: "Get your free preview" }).click();
  await expect(page).toHaveURL(/\/translate$/);
  await expect(
    page.getByTestId("flow-stepper").locator("[data-state=current]"),
  ).toContainText("Upload");
  await expect(page.locator("main")).not.toContainText(/sign in|account/i);
  await check();

  await page.getByTestId("get-quote").click();
  await expect(page).toHaveURL(/\/quote$/);
  await expect(page.getByTestId("detected-language")).toContainText(
    "Spanish → English",
  );
  await expect(page.getByTestId("file-list")).toContainText("acta-nacimiento.pdf");
  await expect(page.getByTestId("file-list")).toContainText("IMG_4021.HEIC");
  await expect(page.getByTestId("file-list")).toContainText("182 words");
  await expect(page.getByTestId("file-list")).toContainText("96 words");
  await expect(page.getByTestId("quote-total")).toContainText("$19.90");
  await expect(page.getByText("Free", { exact: true })).toBeVisible();
  await expect(page.getByTestId("page-rule")).toHaveText(PAGE_RULE);
  await expect(
    page.getByTestId("flow-stepper").locator("[data-state=current]"),
  ).toContainText("Quote");
  await check();

  await page.getByTestId("continue").click();
  await expect(page).toHaveURL(/\/confirm$/);
  await expect(page.getByLabel("Full name on document")).toHaveValue(
    "María Fernanda Ruiz Delgado",
  );
  await expect(page.getByLabel("Date of birth")).toHaveValue("14 March 1994");
  await expect(page.getByLabel("Father")).toHaveValue("Jorge Luis Ruiz Pérez");
  await expect(page.getByLabel("Mother")).toHaveValue("Ana María Delgado Soto");
  await expect(page.getByLabel("Place of birth")).toHaveValue(
    "Guadalajara, Jalisco, Mexico",
  );
  await expect(page.getByLabel("Date format")).toHaveValue("US · MM/DD/YYYY");
  await expect(page.getByText("03/14/1994")).toBeVisible();
  await check();

  await page.getByTestId("start-preview").click();
  await expect(page).toHaveURL(/\/processing$/);
  await expect(page.getByTestId("progress-bar")).toBeVisible();
  await expect(page.getByText("Files received")).toBeVisible();
  await expect(page.getByText("278 words")).toBeVisible();
  await expect(page.getByText("~4 min left")).toBeVisible();
  await expect(page.getByTestId("add-documents")).toBeVisible();
  await expect(
    page.getByTestId("flow-stepper").locator("[data-state=current]"),
  ).toContainText("Preview");
  await check();

  await page.getByTestId("preview-ready").click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByTestId("email")).toHaveValue("maria.ruiz@email.com");
  await expect(page.getByTestId("card-number")).toHaveValue(
    "4242 4242 4242 4242",
  );
  await expect(page.getByTestId("wallet-apple")).toBeVisible();
  await expect(page.getByTestId("wallet-google")).toBeVisible();
  await expect(page.getByTestId("wallet-link")).toBeVisible();
  await expect(page.getByTestId("order-total")).toContainText("$19.90");
  await expect(
    page.getByTestId("flow-stepper").locator("[data-state=current]"),
  ).toContainText("Preview");
  await page.getByTestId("wallet-apple").click();
  await expect(page).toHaveURL(/\/checkout$/);
  await check();

  await page.getByTestId("pay-button").click();
  await expect(page).toHaveURL(/\/download$/);
  await expect(page.getByTestId("download-certified")).toBeVisible();
  await expect(page.getByTestId("download-certified")).toHaveAttribute(
    "download",
    "birth-certificate-EN-certified.pdf",
  );
  await expect(page.getByTestId("download-original")).toHaveAttribute(
    "download",
    "acta-nacimiento.pdf",
  );
  await expect(page.getByTestId("email-note")).toContainText(
    "maria.ruiz@email.com",
  );
  await expect(page.getByTestId("email-note")).toContainText("CP-24817");
  await expect(page.getByTestId("email-note")).toContainText("$19.90");
  await expect(
    page.getByTestId("flow-stepper").locator("[data-state=done]"),
  ).toHaveCount(5);
  await check();
}
