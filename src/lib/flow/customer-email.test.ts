import { describe, expect, it } from "vitest";
import { customerEmailError } from "./customer-email";

describe("customer email", () => {
  it("asks for an address when the field is empty or invalid", () => {
    expect(customerEmailError("")).toBe("Enter your email.");
    expect(customerEmailError("   ")).toBe("Enter your email.");
    expect(customerEmailError("not-an-email")).toBe("Enter a valid email.");
    expect(customerEmailError("ada@example")).toBe("Enter a valid email.");
    expect(customerEmailError("ada@example.com")).toBeNull();
  });
});
