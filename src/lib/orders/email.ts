import { Resend } from "resend";

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

async function send(to: string, subject: string, text: string): Promise<SendResult> {
  const client = mailer();
  if (!client) return { sent: false, skipped: true };
  const { error } = await client.resend.emails.send({
    from: client.from,
    to,
    subject,
    text,
  });
  if (error) {
    console.error(`email failed: ${error.message}`);
    return { sent: false, skipped: false };
  }
  return { sent: true, skipped: false };
}

export function sendOrderReceived(to: string, token: string): Promise<SendResult> {
  const link = orderLink(token);
  return send(
    to,
    "We received your CredPronto documents",
    `We received your documents. Open this link to see your quote and preview:\n\n${link}\n\nKeep this email. It is how you get back to the order.`,
  );
}

export function sendPreviewReady(to: string, token: string | null): Promise<SendResult> {
  const link = token ? `\n\n${orderLink(token)}` : "\n\nOpen the CredPronto link from your earlier email.";
  return send(
    to,
    "Your CredPronto preview is ready",
    `Your watermarked preview is ready. Compare it with the original, then pay only if it looks right.${link}`,
  );
}

export function sendDeliveryReady(to: string): Promise<SendResult> {
  return send(
    to,
    "Your CredPronto translation is ready to download",
    "Your certified translation is approved. Open the CredPronto order link from your earlier email to download the translation and the certification. That link now allows the download.",
  );
}
