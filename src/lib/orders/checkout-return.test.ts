import { describe, expect, it } from "vitest";
import {
  CHECKOUT_ORDER_RETRY_MS,
  checkoutOrderRetryDelay,
  checkoutOrigin,
  checkoutReturnUrl,
  orderTokenFromReturnUrl,
  waitsForCheckoutOrder,
} from "./checkout-return";

describe("checkout return", () => {
  it("keeps the order token in the success and cancel URLs", () => {
    const token = "abc_DEF-123";
    expect(checkoutReturnUrl("https://credpronto.com/", token, "success")).toBe(
      "https://credpronto.com/order/abc_DEF-123?checkout=success",
    );
    expect(checkoutReturnUrl("https://www.credpronto.com", "a b/c", "cancel")).toBe(
      "https://www.credpronto.com/order/a%20b%2Fc?checkout=cancel",
    );
    expect(orderTokenFromReturnUrl("https://www.credpronto.com/order/a%20b%2Fc?checkout=success")).toBe("a b/c");
    expect(orderTokenFromReturnUrl("https://www.credpronto.com/checkout/success")).toBeNull();
  });

  it("keeps retrying after checkout and slows down once the first window passes", () => {
    expect(waitsForCheckoutOrder("success")).toBe(true);
    expect(waitsForCheckoutOrder("cancel")).toBe(true);
    expect(waitsForCheckoutOrder(null)).toBe(false);
    expect(checkoutOrderRetryDelay(0)).toBe(1_000);
    expect(checkoutOrderRetryDelay(CHECKOUT_ORDER_RETRY_MS - 1)).toBe(1_000);
    expect(checkoutOrderRetryDelay(CHECKOUT_ORDER_RETRY_MS)).toBe(5_000);
    expect(checkoutOrderRetryDelay(Number.NaN)).toBe(1_000);
  });
});
describe("checkoutOrigin", () => {
  const prod = "https://www.credpronto.com";

  it("keeps the configured origin on production hosts", () => {
    expect(checkoutOrigin("https://credpronto.com/api/orders/t/checkout", prod)).toBe(prod);
    expect(checkoutOrigin("https://www.credpronto.com/api/orders/t/checkout", prod)).toBe(prod);
  });

  it("returns a preview deploy to itself", () => {
    expect(checkoutOrigin("https://credpronto-git-fix-x-guy-gcsorgs-projects.vercel.app/api/orders/t/checkout", prod)).toBe(
      "https://credpronto-git-fix-x-guy-gcsorgs-projects.vercel.app",
    );
  });

  it("returns localhost to itself", () => {
    expect(checkoutOrigin("http://localhost:3000/api/orders/t/checkout", prod)).toBe("http://localhost:3000");
  });

  it.each([
    "https://evil.com/api/orders/t/checkout",
    "https://credpronto.com.evil.com/x",
    "https://evil-guy-gcsorgs-projects.vercel.app.evil.com/x",
    "https://other-team.vercel.app/x",
    "http://credpronto-abc-guy-gcsorgs-projects.vercel.app/x",
    "https://credpronto-abc-guy-gcsorgs-projects.vercel.app:8443/x",
    "javascript:alert(1)",
    "not a url",
    "",
    null,
    undefined,
  ])("falls back for untrusted host %s", (url) => {
    expect(checkoutOrigin(url, prod)).toBe(prod);
  });

  it("builds the Stripe return URLs from the chosen origin", () => {
    const origin = checkoutOrigin("https://credpronto-abc-guy-gcsorgs-projects.vercel.app/api", prod);
    expect(checkoutReturnUrl(origin, "tok", "success")).toBe("https://credpronto-abc-guy-gcsorgs-projects.vercel.app/order/tok?checkout=success");
  });
});
