import { ADDON_CATALOG } from "./addons";
import { BRAND_ADDRESS, BRAND_FOOTER } from "./brand";
import { evaluationPrice, evaluationServiceDescription, lineItemsForOrder } from "./evaluation-price";
import { languageLabel } from "./languages";
import type { AddonId, EvaluationService } from "./types";

/** Hosted wordmark. Email clients do not render SVG. */
export const EMAIL_LOGO_URL = "https://www.credpronto.com/logo-1080.png";
export const EMAIL_FOOTER_ADDRESS = BRAND_ADDRESS;
export const EMAIL_SUPPORT = "support@credpronto.com";

const FONT = "Geist,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";

export type ReceiptAddon = {
  id: AddonId;
  quantity: number;
  unitCents: number;
  totalCents: number;
};

export type ReceiptLine = {
  label: string;
  amountCents: number;
};

export type OrderReceivedEmail = {
  customerName: string | null;
  orderId: string;
  sourceLanguage: string | null;
  targetLanguage: string;
  documentCount: number;
  pageCount: number | null;
  estimatedCents: number | null;
  trackUrl: string;
};

export type PreviewReadyEmail = {
  orderId: string;
  sourceLanguage: string | null;
  targetLanguage: string;
  documentCount: number;
  pageCount: number | null;
  totalCents: number | null;
  payUrl: string | null;
  includesTranslation: boolean;
};

export type PaymentReceiptEmail = {
  downloadUrl: string | null;
  receiptNumber: string;
  paidAt: string;
  paymentLabel: string | null;
  lines: ReceiptLine[];
  totalCents: number;
};

export type RenderedEmail = {
  subject: string;
  text: string;
  html: string;
};

export function formatEmailMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function formatEmailDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  const date = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    : new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.trim();
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** First name for the greeting. An email address is never a name. */
export function emailGreetingName(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.includes("@")) return null;
  return trimmed.split(/\s+/)[0] ?? null;
}

export function emailLanguageLine(sourceLanguage: string | null, targetLanguage: string): string {
  if (!sourceLanguage?.trim()) return "We'll confirm the language";
  const target = targetLanguage.trim() || "en";
  return `${languageLabel(sourceLanguage)} to ${languageLabel(target)}`;
}

export function documentSummary(documentCount: number, pageCount: number | null, certified = false): string {
  const documents = documentCount === 1 ? "1 document" : `${documentCount} documents`;
  if (pageCount == null) return documents;
  const pages = pageCount === 1 ? "1 page" : `${pageCount} pages`;
  return certified ? `${documents} · ${pageCount === 1 ? "1 certified page" : `${pageCount} certified pages`}` : `${documents} · ${pages}`;
}

export function formatPaymentMethod(brand: string | null | undefined, last4: string | null | undefined): string | null {
  if (!last4 || !/^\d{4}$/.test(last4)) return null;
  const raw = brand?.trim();
  const name = raw ? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase() : "Card";
  return `${name} •••• ${last4}`;
}

export function receiptLineItems(input: {
  service: EvaluationService | null;
  degreeCount: number | null;
  evaluationCents: number | null;
  translationCents: number | null;
  billablePages: number | null;
  unitPriceCents: number;
  addons: readonly ReceiptAddon[];
}): ReceiptLine[] {
  const lines: ReceiptLine[] = [];
  const flat = evaluationPrice({
    service: input.service,
    degreeCount: input.degreeCount,
    addonCents: 0,
  });
  if (flat && input.service && input.degreeCount != null) {
    lines.push({
      label: lineLabel(evaluationServiceDescription(input.service), false, input.degreeCount, flat.unitPriceCents),
      amountCents: flat.evaluationCents,
    });
  } else {
    const priced = lineItemsForOrder(input);
    if (priced.length > 0) {
      for (const item of priced) {
        lines.push({
          label: lineLabel(item.description, item.kind === "translation", item.quantity, item.unitAmountCents),
          amountCents: item.amountCents,
        });
      }
    } else if (input.billablePages != null && input.billablePages > 0) {
      lines.push({
        label: lineLabel("Certified translation", true, input.billablePages, input.unitPriceCents),
        amountCents: input.billablePages * input.unitPriceCents,
      });
    }
  }

  for (const addon of input.addons) {
    const catalog = ADDON_CATALOG.find((item) => item.id === addon.id);
    const name = catalog?.label ?? (addon.id === "expedited" ? "Expedited" : addon.id);
    const detail = addon.quantity > 1 ? ` · ${addon.quantity} × ${formatEmailMoney(addon.unitCents)}` : "";
    lines.push({ label: `${name}${detail}`, amountCents: addon.totalCents });
  }
  return lines;
}

export function renderOrderReceivedEmail(input: OrderReceivedEmail): RenderedEmail {
  const name = emailGreetingName(input.customerName);
  const heading = name ? `We're on it, ${name}.` : "We're on it.";
  const language = emailLanguageLine(input.sourceLanguage, input.targetLanguage);
  const documents = documentSummary(input.documentCount, input.pageCount);
  const price = input.estimatedCents == null ? "Pending" : formatEmailMoney(input.estimatedCents);
  const rows = [
    ["Order", input.orderId, true],
    ["Language", language, false],
    ["Documents", documents, false],
    ["Estimated price", price, false],
  ] as const;
  const html = layout({
    preheader: "We got your documents and are preparing your free preview.",
    body: `${badge("Order received", "#EEF3FF", "#1F5EFF")}
<h1 style="margin:14px 0 8px;font-size:24px;letter-spacing:-.4px;line-height:1.25">${escapeHtml(heading)}</h1>
<p style="margin:0;color:#5B6575">We got your documents. Your free side-by-side preview is being prepared now, and we'll email you the moment it's ready. You only pay once you've seen it.</p>
${detailTable(rows)}
${button("Track your order", input.trackUrl)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;font-size:13.5px"><tr>
<td style="padding-right:8px;vertical-align:top"><b style="color:#1F5EFF">1</b> &nbsp;Received</td>
<td style="padding:0 8px;vertical-align:top;color:#5B6575"><b>2</b> &nbsp;Preview ready</td>
<td style="padding-left:8px;vertical-align:top;color:#5B6575"><b>3</b> &nbsp;Certified PDF</td>
</tr></table>`,
  });
  const text = [
    heading,
    "",
    "We got your documents. Your free side-by-side preview is being prepared now, and we'll email you the moment it's ready. You only pay once you've seen it.",
    "",
    `Order: ${input.orderId}`,
    `Language: ${language}`,
    `Documents: ${documents}`,
    `Estimated price: ${price}`,
    "",
    `Track your order: ${input.trackUrl}`,
  ].join("\n");
  return { subject: "We received your CredPronto documents", text, html };
}

export function renderPreviewReadyEmail(input: PreviewReadyEmail): RenderedEmail {
  const pair = input.sourceLanguage?.trim()
    ? `${languageLabel(input.sourceLanguage)} to ${languageLabel(input.targetLanguage.trim() || "en")}`
    : null;
  const heading = input.includesTranslation ? "Your translation is ready." : "Your evaluation is ready.";
  const intro = input.includesTranslation
    ? `Your ${pair ? `certified ${pair} translation` : "certified translation"} has been reviewed and signed. Take a look at the preview, then pay to unlock the clean, certified PDF.`
    : "Your credential evaluation has been reviewed. Take a look at the preview, then pay to unlock the report.";
  const documents = documentSummary(input.documentCount, input.pageCount, true);
  const includes = input.includesTranslation ? "Includes signed certification cover page" : "Includes the credential evaluation report";
  const price = input.totalCents == null ? "Pending" : formatEmailMoney(input.totalCents);
  const action = input.payUrl
    ? `${button("View and pay", input.payUrl)}<p style="margin:6px 0 0;font-size:13px;color:#5B6575">Not quite right? Request a correction from the same page before you pay, at no cost.</p>`
    : `<p style="margin:24px 0 0;font-size:13px;color:#5B6575">Open the CredPronto link from your earlier email to view the preview and pay.</p>`;
  const html = layout({
    preheader: "Your certified translation is ready. Review it and pay to download.",
    body: `${badge("Ready", "#E8F7EE", "#137A3E")}
<h1 style="margin:14px 0 8px;font-size:24px;letter-spacing:-.4px;line-height:1.25">${escapeHtml(heading)}</h1>
<p style="margin:0;color:#5B6575">${escapeHtml(intro)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;border:1px solid #E5E8EE;border-radius:4px"><tr>
<td style="padding:16px 18px"><div style="font-size:12px;color:#5B6575;text-transform:uppercase;letter-spacing:.05em;font-weight:600">Order ${escapeHtml(input.orderId)}</div>
<div style="font-weight:600;margin-top:4px">${escapeHtml(documents)}</div>
<div style="color:#5B6575;font-size:13.5px">${escapeHtml(includes)}</div></td>
<td align="right" style="padding:16px 18px;font-size:22px;font-weight:700">${escapeHtml(price)}</td>
</tr></table>
${action}`,
  });
  const text = [
    heading,
    "",
    intro,
    "",
    `Order ${input.orderId}`,
    documents,
    includes,
    price,
    "",
    input.payUrl ? `View and pay: ${input.payUrl}` : "Open the CredPronto link from your earlier email to view the preview and pay.",
  ].join("\n");
  return { subject: "Your CredPronto preview is ready", text, html };
}

export function renderPaymentReceiptEmail(input: PaymentReceiptEmail): RenderedEmail {
  const paid = formatEmailDate(input.paidAt);
  const total = formatEmailMoney(input.totalCents);
  const rows: Array<readonly [string, string, boolean]> = [
    ["Receipt number", input.receiptNumber, true],
    ["Date paid", paid, false],
  ];
  if (input.paymentLabel) rows.push(["Payment", input.paymentLabel, false]);
  for (const line of input.lines) rows.push([line.label, formatEmailMoney(line.amountCents), false]);
  const download = input.downloadUrl
    ? button("Download certified PDF", input.downloadUrl)
    : `<p style="margin:24px 0 0;color:#5B6575">Open the CredPronto link from your earlier email to download the certified PDF.</p>`;
  const html = layout({
    preheader: "Payment received. Your certified PDF is ready to download.",
    body: `${badge("Paid", "#E8F7EE", "#137A3E")}
<h1 style="margin:14px 0 8px;font-size:24px;letter-spacing:-.4px;line-height:1.25">Payment received. Thank you!</h1>
<p style="margin:0;color:#5B6575">Your certified translation is unlocked and ready to download. Keep this email as your receipt.</p>
${download}
<div style="margin-top:22px;font-size:12px;color:#5B6575;text-transform:uppercase;letter-spacing:.05em;font-weight:600">Receipt</div>
${receiptTable(rows, total)}`,
  });
  const text = [
    "Payment received. Thank you!",
    "",
    "Your certified translation is unlocked and ready to download. Keep this email as your receipt.",
    "",
    input.downloadUrl ? `Download certified PDF: ${input.downloadUrl}` : "Open the CredPronto link from your earlier email to download the certified PDF.",
    "",
    `Receipt number: ${input.receiptNumber}`,
    `Date paid: ${paid}`,
    input.paymentLabel ? `Payment: ${input.paymentLabel}` : null,
    ...input.lines.map((line) => `${line.label}: ${formatEmailMoney(line.amountCents)}`),
    `Total paid: ${total}`,
  ]
    .filter((line) => line != null)
    .join("\n");
  return { subject: "Your CredPronto payment receipt", text, html };
}

export type StaffAlertEmail = {
  urgent: boolean;
  orderId: string;
  sourceLanguage: string | null;
  targetLanguage: string;
  serviceType: string;
  billablePages: number | null;
  totalCents: number | null;
  studioUrl: string;
};

/** Names and domains that must never appear in a CredPronto email. */
export const BANNED_EMAIL_TEXT = /\bGuy\b|Pearson|\bGCS\b|gcs\.org|ImmiTranslate/i;

export function staffServiceLabel(serviceType: string): string {
  if (serviceType === "translation") return "Certified translation";
  if (serviceType === "evaluation") return "Credential evaluation";
  if (serviceType === "expert_letter") return "Expert letter";
  return "Order";
}

export function renderStaffAlertEmail(input: StaffAlertEmail): RenderedEmail {
  const language = emailLanguageLine(input.sourceLanguage, input.targetLanguage);
  const service = staffServiceLabel(input.serviceType);
  const pages =
    input.billablePages == null
      ? "Not set"
      : input.billablePages === 1
        ? "1 billable page"
        : `${input.billablePages} billable pages`;
  const total = input.totalCents == null ? "Not set" : formatEmailMoney(input.totalCents);
  const heading = input.urgent ? "URGENT: this paid order is still waiting." : "A paid order needs review.";
  const intro = input.urgent
    ? "This order was paid and is still unapproved. Open it in the studio."
    : "Payment cleared and this order needs a person to approve it.";
  const rows = [
    ["Order", input.orderId, true],
    ["Language", language, false],
    ["Service", service, false],
    ["Pages", pages, false],
    ["Total", total, false],
  ] as const;
  const html = layout({
    preheader: input.urgent ? "Urgent: a paid order is still waiting." : "A paid order needs review.",
    body: `${badge(input.urgent ? "URGENT" : "Paid", input.urgent ? "#FDECEC" : "#EEF3FF", input.urgent ? "#9B1C1C" : "#1F5EFF")}
<h1 style="margin:14px 0 8px;font-size:24px;letter-spacing:-.4px;line-height:1.25">${escapeHtml(heading)}</h1>
<p style="margin:0;color:#5B6575">${escapeHtml(intro)}</p>
${detailTable(rows)}
${button("Open in the studio", input.studioUrl)}`,
  });
  const text = [
    heading,
    "",
    intro,
    "",
    `Order: ${input.orderId}`,
    `Language: ${language}`,
    `Service: ${service}`,
    `Pages: ${pages}`,
    `Total: ${total}`,
    "",
    `Open in the studio: ${input.studioUrl}`,
    "",
    BRAND_FOOTER,
  ].join("\n");
  const subject = input.urgent ? "URGENT: CredPronto order still waiting" : "CredPronto order paid";
  return { subject, text, html };
}

export type TranslationFailureAlertEmail = {
  orderId: string;
  reason: string;
  studioUrl: string;
};

/** First id group, capped at 8 characters, for the staff subject line. */
export function staffOrderShortId(orderId: string): string {
  const trimmed = orderId.trim();
  const group = trimmed.split("-")[0] ?? "";
  return (group || trimmed).slice(0, 8);
}

export function renderTranslationFailureAlertEmail(input: TranslationFailureAlertEmail): RenderedEmail {
  const reason = input.reason.trim() || "Translation failed.";
  const subject = `Translation failed, needs review — order ${staffOrderShortId(input.orderId)}`;
  const heading = "Translation failed and needs review.";
  const html = layout({
    preheader: subject,
    body: `${badge("Needs review", "#FDECEC", "#9B1C1C")}
<h1 style="margin:14px 0 8px;font-size:24px;letter-spacing:-.4px;line-height:1.25">${escapeHtml(heading)}</h1>
<p style="margin:0;color:#5B6575">A person needs to look at this translation before it can continue.</p>
${detailTable([
  ["Order", input.orderId, true],
  ["Reason", reason, false],
])}
${button("Open in the studio", input.studioUrl)}`,
  });
  const text = [
    heading,
    "",
    `Order: ${input.orderId}`,
    `Reason: ${reason}`,
    "",
    `Open in the studio: ${input.studioUrl}`,
    "",
    BRAND_FOOTER,
  ].join("\n");
  return { subject, text, html };
}

function lineLabel(description: string, pages: boolean, quantity: number, unitCents: number): string {
  if (pages && quantity > 0) {
    const noun = quantity === 1 ? "page" : "pages";
    return `${description} · ${quantity} ${noun} × ${formatEmailMoney(unitCents)}`;
  }
  if (quantity > 1) return `${description} · ${quantity} × ${formatEmailMoney(unitCents)}`;
  return description;
}

function layout(input: { preheader: string; body: string }): string {
  return `<html><body style="margin:0;background:#F5F7FA;font-family:${FONT}"><div style="display:none">${escapeHtml(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F7FA;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:100%">
<tr><td style="padding:0 4px 18px"><img src="${EMAIL_LOGO_URL}" width="26" height="26" alt="CredPronto" style="display:block;border:0;height:26px;width:26px"></td></tr>
<tr><td style="background:#fff;border:1px solid #E5E8EE;border-radius:4px;padding:32px 36px;color:#0B1220;font-size:15px;line-height:1.6">${input.body}</td></tr>
<tr><td style="padding:20px 4px;color:#5B6575;font-size:12px;line-height:1.6">Questions? Just reply to this email or write to <a href="mailto:${EMAIL_SUPPORT}" style="color:#5B6575">${EMAIL_SUPPORT}</a>.<br>${BRAND_FOOTER}</td></tr>
</table></td></tr></table></body></html>`;
}

function badge(label: string, background: string, color: string): string {
  return `<span style="display:inline-block;background:${background};color:${color};font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px">${escapeHtml(label)}</span>`;
}

function button(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px"><tr><td style="background:#1F5EFF;border-radius:4px"><a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 26px;color:#fff;text-decoration:none;font-weight:600;font-size:15px;font-family:${FONT}">${escapeHtml(label)}</a></td></tr></table>`;
}

function detailTable(rows: readonly (readonly [string, string, boolean])[]): string {
  const body = rows
    .map(([label, value, mono]) => {
      const shown = mono ? `<span style="font-family:monospace">${escapeHtml(value)}</span>` : escapeHtml(value);
      return `<tr><td style="padding:9px 0;border-bottom:1px solid #E5E8EE;color:#5B6575">${escapeHtml(label)}</td><td align="right" style="padding:9px 0;border-bottom:1px solid #E5E8EE;color:#0B1220">${shown}</td></tr>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin-top:20px">${body}</table>`;
}

function receiptTable(rows: readonly (readonly [string, string, boolean])[], total: string): string {
  const body = rows
    .map(([label, value, mono]) => {
      const shown = mono ? `<span style="font-family:monospace">${escapeHtml(value)}</span>` : escapeHtml(value);
      return `<tr><td style="padding:9px 0;border-bottom:1px solid #E5E8EE;color:#5B6575">${escapeHtml(label)}</td><td align="right" style="padding:9px 0;border-bottom:1px solid #E5E8EE;color:#0B1220">${shown}</td></tr>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin-top:20px">${body}<tr><td style="padding:12px 0 0;font-weight:700;color:#0B1220">Total paid</td><td align="right" style="padding:12px 0 0;font-weight:700;color:#0B1220;font-size:17px">${escapeHtml(total)}</td></tr></table>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
