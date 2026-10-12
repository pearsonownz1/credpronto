import { describe, expect, it } from "vitest";
import {
  CHECKOUT_ORDER_RETRY_MS,
  checkoutOrderRetryDelay,
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

  it("retries a missing order only for a short time after checkout", () => {
    expect(waitsForCheckoutOrder("success")).toBe(true);
    expect(waitsForCheckoutOrder("cancel")).toBe(true);
    expect(waitsForCheckoutOrder(null)).toBe(false);
    expect(checkoutOrderRetryDelay(0)).toBe(1_000);
    expect(checkoutOrderRetryDelay(CHECKOUT_ORDER_RETRY_MS - 1)).toBe(1_000);
    expect(checkoutOrderRetryDelay(CHECKOUT_ORDER_RETRY_MS)).toBeNull();
  });
});