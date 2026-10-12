# CredPronto order API

Customer routes authenticate with the raw order token from the email link (`/order/<token>`). The database stores only the lowercase hex SHA-256 of that string in `orders.public_token_hash`. Server routes use the Supabase service role. Responses never include storage paths or the token hash.

Prices are `$9.95` per billable page (`unitPriceCents` 995). For Chinese, Japanese, and Korean, a billable page is `max(1, ceil(units / 400))` per original side. A unit is one Han, Hiragana, Katakana, or Hangul character, or one ASCII number or Latin-letter group (`3.85`, `2019`, `GPA`, and `2019-06` are each one unit). Spaces and punctuation count as 0. `学号 2019 GPA 3.85` is 5 units. Every other language stays `max(1, ceil(words / 250))` per original side, and an empty side is still 1. `GET /api/orders/[token]` returns that sentence in `pageRule`.

Uploads are normalized into one combined original PDF at `originals/<orderId>/original-combined.pdf`. Page N of the watermarked preview is the English translation of page N of that PDF.

The watermark is drawn in a separate render pass on every preview page: a repeating diagonal `PREVIEW · CREDPRONTO · NOT FOR OFFICIAL USE` in `#1F5EFF` at 16% opacity. The preview file has no certification page. The clean translation and the certification page are separate objects in the `finals` bucket and are not used to build the preview.

## `GET /api/orders/[token]/preview`

Signed URLs expire in 10 minutes. `translation.url` is the watermarked preview only.

{ status, totalCents, unitPriceCents, billablePages, original: { url (10-min signed), pageCount, pages: [{ number, widthPt, heightPt }] }, translation: { url (10-min signed, watermarked preview only), pageCount, pages: [{ number, widthPt, heightPt }], version }, corrections: [{ id, documentId, page, quote, note, status, createdAt }] }

```json
{
  "status": "preview_ready",
  "totalCents": 2985,
  "unitPriceCents": 995,
  "billablePages": 3,
  "original": {
    "url": "https://…",
    "pageCount": 3,
    "pages": [{ "number": 1, "widthPt": 612, "heightPt": 792 }]
  },
  "translation": {
    "url": "https://…",
    "pageCount": 3,
    "pages": [{ "number": 1, "widthPt": 612, "heightPt": 792 }],
    "version": 1
  },
  "corrections": [
    {
      "id": "…",
      "documentId": "…",
      "page": 2,
      "quote": "the highlighted passage",
      "note": "use the confirmed spelling",
      "status": "open",
      "createdAt": "2026-10-12T00:00:00.000Z"
    }
  ]
}
```

`page` on a correction is the combined PDF page number (`number` above). `quote` is the passage the customer highlighted. `404` when the token is unknown. `409` `{ "error": "Preview is not ready" }` before a preview exists.

## `POST /api/orders`

`multipart/form-data`.

| Field | Required | Notes |
| --- | --- | --- |
| `email` | yes | Upserts `customers` by email |
| `files` | yes | Repeat the field. `file` is also accepted. 1–15 files, 25MB each, 100MB total |
| `utm_source`, `utm_medium`, `utm_campaign`, `gclid`, `landing_path` | no | Stored on the order |

Allowed types: PDF, JPEG, PNG, WEBP, HEIC/HEIF. HEIC is converted when the runtime can decode it.

`202` is not used. The response is immediate. Analysis runs after the response (`after`) and can be retried.

```json
{ "orderToken": "…", "orderId": "…" }
```

`400` validation, `415` unsupported type, `503` when the service role is not configured.

## `POST /api/orders/[token]/process`

Idempotent retry of analysis or translation. Safe to call more than once. Returns the same shape as `GET /api/orders/[token]`.

## `GET /api/orders/[token]`

```json
{
  "orderId": "…",
  "status": "quoted",
  "sourceLanguage": "es",
  "sourceLanguageConfidence": 0.92,
  "targetLanguage": "en",
  "languageConfirmed": false,
  "documents": [
    {
      "id": "…",
      "filename": "diploma.pdf",
      "pageCount": 2,
      "detectedLanguage": "es",
      "confidence": 0.92
    }
  ],
  "billablePages": 3,
  "unitPriceCents": 995,
  "totalCents": 2985,
  "currency": "usd",
  "pageRule": "250 words per billable page. Each original page side counts as at least 1.",
  "etaAt": "2026-10-12T01:00:00.000Z",
  "reviewReason": null,
  "confirmations": [
    {
      "documentId": "…",
      "fieldKey": "full_name",
      "originalValue": "Ada Lovelace",
      "confirmedValue": null
    }
  ],
  "previewVersion": null,
  "payment": null,
  "delivery": null
}
```

`confirmations` has one row per document for each of `full_name`, `date_of_birth`, `parent_names`, `place_of_birth`, and `date_format`. `originalValue` is what the model read. `confirmedValue` is null until the customer confirms. `payment.status` is `pending`, `paid`, `paid_test`, `failed`, `canceled`, or `refunded`. `delivery.status` is `pending`, `approved`, `delivered`, or `failed`.

`sourceLanguageConfidence` is the lowest document confidence, from 0 to 1.

Quoted orders set `etaAt` about one hour out. `needs_review` sets it about 24 hours out and explains why in `reviewReason` (low confidence, unreadable page, unsupported language, or detection unavailable).

## `POST /api/orders/[token]/confirm`

JSON. Allowed only when `status` is `quoted`. Every document on the order must appear once. Translation then starts (`status` becomes `confirmed`, then `processing`).

```json
{
  "sourceLanguage": "es",
  "documents": [
    {
      "documentId": "…",
      "full_name": "Ada Lovelace",
      "date_of_birth": "12/10/1815",
      "parent_names": "Anne Isabella Milbanke; Lord Byron",
      "place_of_birth": "London",
      "date_format": "MM/DD/YYYY"
    }
  ]
}
```

`date_format` is `MM/DD/YYYY` or `DD/MM/YYYY`. The other four fields are strings and may be empty when the document does not contain them. The translation uses the confirmed spellings and writes every date, including the date of birth, in `date_format`.

Response: the `GET /api/orders/[token]` shape. `409` if the order is not quoted.

## `POST /api/orders/[token]/corrections`

JSON. Allowed when a preview exists (`preview_ready`, or another correction is already in flight).

```json
{ "documentId": "…", "page": 2, "note": "what should change" }
```

`page` is the combined page number and is required. `note` is required. `passage` (or `quote`) is optional and may be `null` or omitted. The first release ties a correction to the page, not to a highlighted span. When a passage is sent, it is stored and sent to the translator with the note.

The order moves to `correction_requested`. Translation and a new watermarked preview are regenerated, the preview version increases, and the preview-ready email is sent again.

```json
{
  "id": "…",
  "documentId": "…",
  "page": 2,
  "quote": "highlighted text",
  "note": "what should change",
  "status": "correction_requested"
}
```

## `POST /api/orders/[token]/checkout`

Allowed from `preview_ready` for the order's exact `totalCents`.

Stripe session:

```json
{ "url": "https://checkout.stripe.com/…", "sessionId": "cs_…" }
```

`CHECKOUT_PLACEHOLDER=1` does not call Stripe. The payment row status is `paid_test`, the order status is `paid`, and a pending delivery is created.

```json
{ "mode": "paid_test", "paymentStatus": "paid_test", "orderStatus": "paid" }
```

If `STRIPE_SECRET_KEY` is unset and the placeholder is not `1`:

```json
{ "error": "Payments not configured" }
```

HTTP 503.

`409` if the preview is not ready or the order is already paid.

## `POST /api/stripe/webhook`

`checkout.session.completed` and `charge.refunded`. The body must be the raw payload. `Stripe-Signature` is verified with `STRIPE_WEBHOOK_SECRET`.

`checkout.session.completed` is applied once per Checkout Session id. A second delivery returns `{ "received": true, "duplicate": true }` and does not create a second payment or a second `paid` event. The payment is marked `paid`, a `deliveries` row is ensured at `pending`, and the order becomes `paid` only when `amount_total` equals `orders.total_cents` and `currency` equals `orders.currency` (case-insensitive). A mismatch does not mark the order paid.

`charge.refunded` marks that payment `refunded` when the charge amount and currency match the order total. Downloads are locked again (`402`) even if delivery was already approved. A second refund of the same payment returns `{ "received": true, "duplicate": true }`.

`400` invalid signature. `503` `{ "error": "Payments not configured" }` when Stripe env is missing.

## `GET /api/orders/[token]/download?file=translation|certification`

| Payment | Delivery | Result |
| --- | --- | --- |
| not `paid` or `paid_test` (including `refunded`) | any | `402` `{ "error": "Payment required" }` |
| settled | not `approved` or `delivered` | `403` `{ "error": "Certification is not approved" }` |
| settled | `approved` or `delivered` | `200` |

```json
{ "url": "https://…", "expiresInSeconds": 300 }
```

The URL is a 5-minute signed URL for the object in `finals` (`translation` → clean translated PDF, `certification` → certification page). A `downloaded` event is recorded. The URL is not stored.

## Admin

These routes require a signed-in Supabase user who has a `staff` row. `401` if signed out, `403` if the user is not staff.

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| `GET` | `/api/admin/orders?status=` | | `{ "orders": [ { id, status, serviceType, sourceLanguage, billablePages, totalCents, currency, createdAt, reviewReason, email } ] }` |
| `GET` | `/api/admin/orders/[id]` | | Order, documents, pages (including text), confirmations, corrections, payment, delivery. Includes storage keys for staff. |
| `POST` | `/api/admin/orders/[id]/resolve-review` | `{ "sourceLanguage": "es" }` | `needs_review` → `quoted`. `sourceLanguage` optional when the order already has one. |
| `POST` | `/api/admin/orders/[id]/resolve-corrections` | `{ "action": "dismiss", "correctionIds": [] }` or `{ "action": "regenerate" }` | Dismiss open corrections, or regenerate the translation and preview. |
| `POST` | `/api/admin/orders/[id]/approve` | | Sets `deliveries.approved_by` and `approved_at`. A paid order is then emailed and set to `delivered`. |

Approval copies the clean translation and certification keys onto the delivery. The delivery email tells the customer to open the order link from the earlier message. The raw token is not stored, so that email cannot contain a new copy of it.

## Order statuses

`draft` → `quoted` or `needs_review` → `confirmed` → `processing` → `preview_ready` → (`correction_requested` → `processing` → `preview_ready`) → `paid` → `approved` → `delivered`.

`failed` can be retried with `POST /api/orders/[token]/process`. `cancelled` is unused by these routes.

## Events

`order_events` records `upload_started`, `upload_done`, `quote_shown`, `preview_ready`, `preview_viewed`, `checkout_started`, `paid`, `refunded`, and `downloaded`. The raw token is never written on those rows.
