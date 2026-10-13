import { describe, expect, it } from "vitest";
import { BRAND_NAME } from "./brand";
import { buildContactEmail, deliveryReadyMessage, emailFromHeader } from "./email";

describe("email from header", () => {
  it("uses the CredPronto display name and keeps the mailbox", () => {
    expect(emailFromHeader("Ada Lovelace <hello@credpronto.com>")).toBe(`${BRAND_NAME} <hello@credpronto.com>`);
    expect(emailFromHeader("hello@credpronto.com")).toBe(`${BRAND_NAME} <hello@credpronto.com>`);
  });
});

describe("delivery ready email", () => {
  it("names the evaluation report for an evaluation and the translation for a translation", () => {
    expect(deliveryReadyMessage("evaluation")).toEqual({
      subject: "Your CredPronto evaluation is ready to download",
      text: "Your credential evaluation is approved. Open the CredPronto order link from your earlier email to download the evaluation report.",
    });
    expect(deliveryReadyMessage("evaluation", "https://credpronto.com/order/28492f38-1111-4111-8111-111111111111")).toEqual({
      subject: "Your CredPronto evaluation is ready to download",
      text: "Your credential evaluation is approved. Download the evaluation report: https://credpronto.com/order/28492f38-1111-4111-8111-111111111111",
    });
    expect(deliveryReadyMessage()).toMatchObject({
      subject: "Your CredPronto translation is ready to download",
    });
    expect(deliveryReadyMessage("translation").text).toContain("certified translation");
    expect(deliveryReadyMessage("evaluation").text).not.toMatch(/\bEDGE\b/);
  });
});

describe("contact email", () => {
  it("sends to support and replies to the customer", () => {
    expect(
      buildContactEmail({
        name: "Ada\nLovelace",
        email: "ada@example.com",
        company: "Northwind",
        orderNumber: "",
        message: "Please check order CP-100.",
      }),
    ).toEqual({
      to: "support@credpronto.com",
      replyTo: "ada@example.com",
      subject: "Message from Ada Lovelace",
      text: "Name: Ada Lovelace\nEmail: ada@example.com\nCompany: Northwind\n\nPlease check order CP-100.",
    });
  });
});
