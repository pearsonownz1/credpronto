export const CONTACT_TO = "support@credpronto.com";

export const CONTACT_FIELD_ERRORS = {
  name: "Enter your name.",
  email: "Enter your email.",
  emailInvalid: "Enter a valid email address.",
  message: "Tell us how we can help.",
  tooLong: "That is too long.",
} as const;

const LIMITS = {
  name: 200,
  email: 320,
  company: 200,
  orderNumber: 80,
  message: 5000,
} as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ContactMessage = {
  name: string;
  email: string;
  company: string;
  orderNumber: string;
  message: string;
};

export type ContactField = "name" | "email" | "company" | "orderNumber" | "message";

export type ContactFieldErrors = Partial<Record<ContactField, string>>;

export type ContactValidation =
  | { ok: true; honeypot: true }
  | { ok: true; honeypot: false; value: ContactMessage }
  | { ok: false; errors: ContactFieldErrors };

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim();
}

function limited(value: string, max: number): string | "long" {
  if (value.length > max) return "long";
  return value;
}

export function validateContact(input: unknown): ContactValidation {
  const body = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const website = text(body.website);
  if (website) return { ok: true, honeypot: true };

  const errors: ContactFieldErrors = {};
  const name = text(body.name);
  const email = text(body.email);
  const message = text(body.message);
  const company = text(body.company ?? "");
  const orderNumber = text(body.orderNumber ?? "");

  if (name == null) errors.name = CONTACT_FIELD_ERRORS.name;
  else if (!name) errors.name = CONTACT_FIELD_ERRORS.name;
  else if (limited(name, LIMITS.name) === "long") errors.name = CONTACT_FIELD_ERRORS.tooLong;

  if (email == null) errors.email = CONTACT_FIELD_ERRORS.email;
  else if (!email) errors.email = CONTACT_FIELD_ERRORS.email;
  else if (limited(email, LIMITS.email) === "long" || !EMAIL_PATTERN.test(email)) {
    errors.email = CONTACT_FIELD_ERRORS.emailInvalid;
  }

  if (message == null) errors.message = CONTACT_FIELD_ERRORS.message;
  else if (!message) errors.message = CONTACT_FIELD_ERRORS.message;
  else if (limited(message, LIMITS.message) === "long") errors.message = CONTACT_FIELD_ERRORS.tooLong;

  if (company == null) errors.company = CONTACT_FIELD_ERRORS.tooLong;
  else if (limited(company, LIMITS.company) === "long") errors.company = CONTACT_FIELD_ERRORS.tooLong;

  if (orderNumber == null) errors.orderNumber = CONTACT_FIELD_ERRORS.tooLong;
  else if (limited(orderNumber, LIMITS.orderNumber) === "long") errors.orderNumber = CONTACT_FIELD_ERRORS.tooLong;

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    honeypot: false,
    value: {
      name: name ?? "",
      email: email ?? "",
      company: company ?? "",
      orderNumber: orderNumber ?? "",
      message: message ?? "",
    },
  };
}

export function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}
