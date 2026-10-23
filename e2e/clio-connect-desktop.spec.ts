import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./account";
import { stubIntegrations } from "./integrations-routes";

const email = "maria.ruiz@email.com";

test("connected Clio can disconnect and the card follows the refreshed status", async ({ page }) => {
  await stubIntegrations(page, { connected: true });
  await signIn(page, email, "/dashboard/integrations");
  await expect(page.getByTestId("integration-clio-status")).toHaveText("Connected");
  await expect(page.getByTestId("clio-disconnect")).toHaveText("Disconnect");
  await expect(page.getByTestId("clio-connect")).toHaveCount(0);
  await expect(page.getByTestId("integration-clio")).not.toContainText("Coming soon");

  const calls: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/integrations/clio/disconnect" || url.pathname === "/api/integrations/clio/status") {
      calls.push(`${request.method()} ${url.pathname}`);
    }
  });
  await page.getByTestId("clio-disconnect").click();
  await expect(page.getByTestId("clio-connect")).toHaveAttribute("href", "/api/integrations/clio/connect");
  await expect(page.getByTestId("clio-disconnect")).toHaveCount(0);
  await expect(page.getByTestId("integration-clio-status")).toHaveCount(0);
  expect(calls).toEqual(["POST /api/integrations/clio/disconnect", "GET /api/integrations/clio/status"]);
  await page.screenshot({ path: "artifacts/clio-disconnected.png", fullPage: true });
});

test("Connect opens the Clio connect route", async ({ page }) => {
  await stubIntegrations(page);
  await signIn(page, email, "/dashboard/integrations");
  await page.getByTestId("clio-connect").click();
  await expect(page).toHaveURL(/\/api\/integrations\/clio\/connect$/);
  await expect(page).toHaveTitle("Clio connect");
});

async function signInThenOpen(page: Page, path: string) {
  await signIn(page, email, "/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto(path);
}

test("?clio=connected shows the connected card and a success notice", async ({ page }) => {
  await stubIntegrations(page, { connected: true });
  await signInThenOpen(page, "/dashboard/integrations?clio=connected");
  await expect(page).toHaveURL(/\/dashboard\/integrations\?clio=connected$/);
  await expect(page.getByTestId("integration-clio-status")).toHaveText("Connected");
  await expect(page.getByTestId("clio-notice")).toHaveText("Clio is connected.");
  await expect(page.getByTestId("clio-disconnect")).toBeVisible();
  await expect(page.getByTestId("integration-clio")).not.toContainText("Coming soon");
  await page.screenshot({ path: "artifacts/clio-connected.png", fullPage: true });
});

test("a failed matter action stays connected and explains what did not finish", async ({ page }) => {
  await stubIntegrations(page, { connected: true });
  await signInThenOpen(page, "/dashboard/integrations?clio=connected&clio_action=failed");
  await expect(page.getByTestId("integration-clio-status")).toHaveText("Connected");
  await expect(page.getByTestId("clio-notice")).toHaveText("Clio is connected. The matter action could not be added.");
  await expect(page.getByTestId("clio-disconnect")).toBeVisible();
});

test("error query params show a fixed notice and the connect link", async ({ page }) => {
  await stubIntegrations(page);
  await signInThenOpen(page, "/dashboard/integrations?clio=error&error=access_denied&error_description=server_exploded");
  await expect(page.getByTestId("clio-notice")).toHaveText("Clio could not be connected. Try again.");
  await expect(page.getByTestId("integration-clio")).not.toContainText("access_denied");
  await expect(page.getByTestId("integration-clio")).not.toContainText("server_exploded");
  await expect(page.getByTestId("integration-clio")).not.toContainText("Coming soon");
  await expect(page.getByTestId("clio-connect")).toHaveAttribute("href", "/api/integrations/clio/connect");
  await expect(page.getByTestId("integration-clio-status")).toHaveCount(0);

  await page.goto("/dashboard/integrations?error=access_denied");
  await expect(page.getByTestId("clio-notice")).toHaveText("Clio could not be connected. Try again.");
  await expect(page.getByTestId("integration-clio")).not.toContainText("access_denied");
});

test("a failed status request stays on Connect with the server message", async ({ page }) => {
  await stubIntegrations(page, { statusStatus: 503, statusError: "Clio storage is not ready" });
  await signIn(page, email, "/dashboard/integrations");
  await expect(page.getByTestId("clio-notice")).toHaveText("Clio storage is not ready");
  await expect(page.getByTestId("clio-connect")).toBeVisible();
  await expect(page.getByTestId("integration-clio")).not.toContainText("Coming soon");
});

test("a failed disconnect leaves the connected card in place", async ({ page }) => {
  await stubIntegrations(page, { connected: true, disconnectStatus: 500, disconnectError: "Clio could not be disconnected." });
  await signIn(page, email, "/dashboard/integrations");
  await page.getByTestId("clio-disconnect").click();
  await expect(page.getByTestId("integration-clio-status")).toHaveText("Connected");
  await expect(page.getByTestId("clio-notice")).toHaveText("Clio could not be disconnected.");
  await expect(page.getByTestId("clio-connect")).toHaveCount(0);
});
