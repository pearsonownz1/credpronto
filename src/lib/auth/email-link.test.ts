import { describe, expect, it } from "vitest";
import { isExistingAccountError } from "./email-link";

describe("existing account errors", () => {
  it("recognizes an email that already has an account", () => {
    expect(isExistingAccountError({ code: "email_exists", message: "already been registered" })).toBe(true);
    expect(isExistingAccountError({ message: "User already exists" })).toBe(true);
    expect(isExistingAccountError({ message: "Password is too short" })).toBe(false);
    expect(isExistingAccountError(null)).toBe(false);
  });
});
