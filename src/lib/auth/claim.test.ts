import { describe, expect, it } from "vitest";
import { claimableOrderIds } from "./claim";

const orders = [
  { id: "owned", userId: "someone-else", customerEmail: "ada@example.com" },
  { id: "match", userId: null, customerEmail: "Ada@example.com" },
  { id: "other", userId: null, customerEmail: "other@example.com" },
];

describe("claimable orders", () => {
  it("claims only unowned orders with the verified email", () => {
    expect(
      claimableOrderIds({
        emailVerified: true,
        email: " ada@example.com ",
        orders,
      }),
    ).toEqual(["match"]);
  });

  it("claims nothing until the email is verified", () => {
    expect(
      claimableOrderIds({
        emailVerified: false,
        email: "ada@example.com",
        orders,
      }),
    ).toEqual([]);
  });

  it("claims nothing without an email", () => {
    expect(claimableOrderIds({ emailVerified: true, email: null, orders })).toEqual([]);
  });
});
