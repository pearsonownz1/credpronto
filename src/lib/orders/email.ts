import { Resend } from "resend";
import { CONTACT_TO, oneLine, type ContactMessage } from "@/lib/contact/validate";
import { BRAND_NAME } from "./brand";
import {
  renderOrderReceivedEmail,
  renderPaymentReceiptEmail,
  renderPreviewReadyEmail,
  renderStaffAlertEmail,
  type OrderReceivedEmail,
  type PaymentReceiptEmail,
  type PreviewReadyEmail,
  type StaffAlertEmail,
} from "./email-templates";

export function appOrigin(): string {
  const raw = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://credpronto.com";
  return raw.replace(/\/$/, "");
}

export function orderLink(token: string): string {
  return `${appOrigin()}/order/${token}`;
}

export function adminStudioLink(orderId: string): string {
  return `${appOrigin()}/admin/orders/${encodeURIComponent(orderId)}`;
}

type SendResult = { sent: boolean; skipped: boolean; detail?: string };

/** Display name is always CredPronto. The mailbox is the address in EMAIL_FROM. */
export function emailFromHeader(raw: string): string {
  const trimmed = raw.trim();
  const angled = trimmed.match(/<([^<>\s]+@[^<>\s]+)>/);
  const bare = trimmed.match(/[^\s<>]+@[^\s<>]+/);
  const address = (angled?.[1] ?? bare?.[0] ?? trimmed).trim();
  return `${BRAND_NAME} <${address}>`;
}

function mailer(): { from: string; resend: Resend } | null {
  const apiKey = process.env.RESEND_API_KEY;
  const configured = process.env.EMAIL_FROM;
  if (!apiKey || !configured) {
    console.info("email skipped: RESEND_API_KEY or EMAIL_FROM unset");
    return null;
  }
  return { from: emailFromHeader(configured), resend: new Resend(apiKey) };
}

async function send(to: string | readonly string[], subject: string, text: string, html?: string): Promise<SendResult> {
  const client = mailer();
  if (!client) return { sent: false, skipped: true };
  const { error } = await client.resend.emails.send({
    from: client.from,
    to: typeof to === "string" ? to : [...to],
    subject,
    text,
    ...(html ? { html } : {}),
  });
  if (error) {
    console.error(`email failed: ${error.message}`);
    return { sent: false, skipped: false, detail: error.message };
  }
  return { sent: true, skipped: false };
}

export function buildContactEmail(input: ContactMessage): {
  to: string;
  replyTo: string;
  subject: string;
  text: string;
} {
  const lines = [
    `Name: ${oneLine(input.name)}`,
    `Email: ${oneLine(input.email)}`,
    input.company ? `Company: ${oneLine(input.company)}` : null,
    input.orderNumber ? `Order number: ${oneLine(input.orderNumber)}` : null,
    "",
    input.message,
  ].filter((line): line is string => line != null);
  return {
    to: CONTACT_TO,
    replyTo: oneLine(input.email),
    subject: `Message from ${oneLine(input.name)}`,
    text: lines.join("\n"),
  };
}

export async function sendContactMessage(input: ContactMessage): Promise<SendResult> {
  const client = mailer();
  if (!client) return { sent: false, skipped: true, detail: "RESEND_API_KEY or EMAIL_FROM is unset" };
  const message = buildContactEmail(input);
  const { error } = await client.resend.emails.send({
    from: client.from,
    to: message.to,
    replyTo: message.replyTo,
    subject: message.subject,
    text: message.text,
  });
  if (error) {
    console.error(`contact email failed: ${error.message}`);
    return { sent: false, skipped: false, detail: error.message };
  }
  return { sent: true, skipped: false };
}

export function sendOrderReceived(
  to: string,
  input: Omit<OrderReceivedEmail, "trackUrl"> & { token: string },
): Promise<SendResult> {
  const rendered = renderOrderReceivedEmail({ ...input, trackUrl: orderLink(input.token) });
  return send(to, rendered.subject, rendered.text, rendered.html);
}

export function sendPreviewReady(
  to: string,
  input: Omit<PreviewReadyEmail, "payUrl"> & { token: string | null },
): Promise<SendResult> {
  const rendered = renderPreviewReadyEmail({
    ...input,
    payUrl: input.token ? orderLink(input.token) : null,
  });
  return send(to, rendered.subject, rendered.text, rendered.html);
}

export function sendPaymentReceipt(to: string, input: PaymentReceiptEmail): Promise<SendResult> {
  const rendered = renderPaymentReceiptEmail(input);
  return send(to, rendered.subject, rendered.text, rendered.html);
}

export function sendStaffOrderAlert(
  to: readonly string[],
  input: StaffAlertEmail,
): Promise<SendResult> {
  const rendered = renderStaffAlertEmail(input);
  return send(to, rendered.subject, rendered.text, rendered.html);
}

export function deliveryReadyMessage(product: "translation" | "evaluation" = "translation"): {
  subject: string;
  text: string;
} {
  if (product === "evaluation") {
    return {
      subject: "Your CredPronto evaluation is ready to download",
      text: "Your credential evaluation is approved. Open the CredPronto order link from your earlier email to download the evaluation report.",
    };
  }
  return {
    subject: "Your CredPronto translation is ready to download",
    text: "Your certified translation is approved. Open the CredPronto order link from your earlier email to download the translation and the certification. That link now allows the download.",
  };
}

export function sendDeliveryReady(
  to: string,
  product: "translation" | "evaluation" = "translation",
): Promise<SendResult> {
  const message = deliveryReadyMessage(product);
  return send(to, message.subject, message.text);
}
