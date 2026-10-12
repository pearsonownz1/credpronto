import { Resend } from "resend";
import {
  renderOrderReceivedEmail,
  renderPaymentReceiptEmail,
  renderPreviewReadyEmail,
  type OrderReceivedEmail,
  type PaymentReceiptEmail,
  type PreviewReadyEmail,
} from "./email-templates";

export function appOrigin(): string {
  const raw = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://credpronto.com";
  return raw.replace(/\/$/, "");
}

export function orderLink(token: string): string {
  return `${appOrigin()}/order/${token}`;
}

type SendResult = { sent: boolean; skipped: boolean };

function mailer(): { from: string; resend: Resend } | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.info("email skipped: RESEND_API_KEY or EMAIL_FROM unset");
    return null;
  }
  return { from, resend: new Resend(apiKey) };
}

async function send(to: string, subject: string, text: string, html?: string): Promise<SendResult> {
  const client = mailer();
  if (!client) return { sent: false, skipped: true };
  const { error } = await client.resend.emails.send({
    from: client.from,
    to,
    subject,
    text,
    ...(html ? { html } : {}),
  });
  if (error) {
    console.error(`email failed: ${error.message}`);
    return { sent: false, skipped: false };
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

export function sendDeliveryReady(to: string): Promise<SendResult> {
  return send(
    to,
    "Your CredPronto translation is ready to download",
    "Your certified translation is approved. Open the CredPronto order link from your earlier email to download the translation and the certification. That link now allows the download.",
  );
}
