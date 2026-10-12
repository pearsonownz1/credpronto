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

`confirmations` has one row per document for each of `full_name`, `date_of_birth`, `parent_names`, `place_of_birth`, and `date_format`. `originalValue` is what the model read. `confirmedValue` is null until the customer confirms. `payment.status` is `pending`, `paid`, `paid_test`, `failed`, `canceled`, `expired`, or `refunded`. `delivery.status` is `pending`, `approved`, `delivered`, or `failed`.

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

`checkout.session.completed`, `checkout.session.expired`, and `charge.refunded`. The body must be the raw payload. `Stripe-Signature` is verified with `STRIPE_WEBHOOK_SECRET`. The route runs on the Node.js runtime.

`checkout.session.completed` is applied once per Checkout Session id. A second delivery returns `{ "received": true, "duplicate": true }` and does not create a second payment or a second `paid` event. The payment is marked `paid`, a `deliveries` row is ensured at `pending`, and the order becomes `paid` only when `amount_total` equals `orders.total_cents` and `currency` equals `orders.currency` (case-insensitive). A mismatch does not mark the order paid.

`checkout.session.expired` marks the pending payment for that Checkout Session id `expired`. If the order is still awaiting payment for that session and has not been paid (`paid`, `approved`, or `delivered`, or any settled payment), the order is set back to `preview_ready` so the customer can pay again. A second delivery returns `{ "received": true, "duplicate": true }` and does not change the payment again. An unknown session is ignored.

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

## Auth

Email magic link, email plus password, and Google OAuth all use the cookie client from `@supabase/ssr`. `src/proxy.ts` refreshes the session on each matched request. The browser returns to `GET /auth/callback`, which exchanges a `code` (PKCE magic link or Google) or verifies `token_hash` plus `type` (email OTP). After the session exists, unowned orders whose customer email matches the verified account email are claimed (`orders.user_id`). An unverified address claims nothing.

`next` is a relative path (`/orders`). Absolute and protocol-relative values are ignored.

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| `POST` | `/api/auth/magic-link` | `{ "email", "next"? }` | `{ "sent": true }`. The link redirects to `/auth/callback`. |
| `POST` | `/api/auth/password` | `{ "email", "password", "mode"? , "next"? }` | `mode` is `sign-in` (default) or `sign-up`. Sign-in returns `{ "userId", "claimedOrderIds" }`. Sign-up returns `{ "userId", "session", "claimedOrderIds" }`. Password is at least 8 characters. `401` for a bad sign-in. |
| `POST` | `/api/auth/google` | `{ "next"? }` | `{ "url" }` for Google OAuth. The provider redirect in Supabase is `{APP_URL}/auth/callback`. |
| `GET` | `/auth/callback?code=` or `?token_hash=&type=` | | Redirects to `next` after claim. Failure redirects to `/?auth_error=1`. |

`401` `{ "error": "Sign in required" }` when a session is missing. `503` `{ "error": "Auth is not configured" }` when the public Supabase env is missing.

## `GET /api/me/orders`

Signed-in customer. Claims matching unowned orders first, then lists orders with `user_id` equal to the session user. Token routes are unchanged.

```json
{
  "orders": [
    {
      "id": "…",
      "status": "paid",
      "serviceType": "translation",
      "totalCents": 2985,
      "currency": "usd",
      "billablePages": 3,
      "unitPriceCents": 995,
      "createdAt": "2026-10-12T00:00:00.000Z",
      "previewAvailable": true,
      "paymentStatus": "paid",
      "downloadAvailable": false
    }
  ]
}
```

`previewAvailable` is true when a ready watermarked preview exists. `paymentStatus` is the settled payment (`paid` or `paid_test`) or, if none, the newest payment status (`pending`, `failed`, `canceled`, `refunded`). `downloadAvailable` uses the same rule as `GET /api/orders/[token]/download`: settled payment and delivery `approved` or `delivered`. A refund sets `downloadAvailable` to false.

## Admin

These routes require a signed-in Supabase user who has a `staff` row or `profiles.is_admin`. `401` if signed out, `403` if the user is neither.

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| `GET` | `/api/admin/orders?status=&limit=&offset=` | | `{ "orders": [ { id, status, serviceType, sourceLanguage, billablePages, totalCents, currency, createdAt, reviewReason, email } ], "page": { "limit", "offset", "total" } }`. `limit` defaults to 50 and cannot exceed 100. `offset` defaults to 0. |
| `GET` | `/api/admin/orders/[id]` | | Order, documents, pages (source text and the latest ready AI translation paragraphs per page), confirmations, corrections, payment, delivery. Includes storage keys for staff. |
| `PATCH` | `/api/admin/orders/[id]` | `{ "pages": [ { "documentId", "pageNumber", "paragraphs": ["…"] } ] }` | Replaces those pages' translation text, writes a new translation version (`model` `staff-edit`), and regenerates the watermarked preview, clean translation, and certification page the same way the pipeline renders them. Other pages keep their current text. Allowed from `preview_ready`, `correction_requested`, `paid`, `approved`, and `delivered`. The order status does not move backward. An approved or delivered row's file keys are updated. Records `translation_edited`. |
| `POST` | `/api/admin/orders/[id]/resolve-review` | `{ "sourceLanguage": "es" }` | `needs_review` → `quoted`. `sourceLanguage` optional when the order already has one. |
| `POST` | `/api/admin/orders/[id]/resolve-corrections` | `{ "action": "dismiss", "correctionIds": [] }` or `{ "action": "regenerate" }` | Dismiss open corrections, or regenerate the translation and preview. |
| `POST` | `/api/admin/orders/[id]/approve` | | Sets `deliveries.approved_by` and `approved_at`, records `approved`, and returns 5-minute signed URLs for the clean translation and the certification page. A paid order is then emailed and set to `delivered`. |
| `POST` | `/api/admin/orders/[id]/refund` | | Stripe refund when the payment is `paid`, the secret key is `sk_test_…`, and a payment intent is stored. `paid_test` does not call Stripe: the row is marked `refunded` and a `refunded` event is recorded with `mode: "paid_test"`. A second call returns `{ "paymentStatus": "refunded", "duplicate": true }`. Downloads lock again. |
| `GET` | `/api/admin/orders/[id]/notes` | | `{ "notes": [ { id, authorId, body, createdAt } ] }` |
| `POST` | `/api/admin/orders/[id]/notes` | `{ "body": "…" }` | `201` and the note. Records `note_added`. Body is 1 to 4000 characters. |

Approval copies the clean translation and certification keys onto the delivery and returns:

```json
{
  "status": "delivered",
  "email": "sent",
  "translation": { "url": "https://…", "expiresInSeconds": 300 },
  "certification": { "url": "https://…", "expiresInSeconds": 300 }
}
```

`email` is `sent`, `skipped`, or `failed`. When email fails the delivery stays `approved` and the signed URLs are still returned. The delivery email tells the customer to open the order link from the earlier message. The raw token is not stored, so that email cannot contain a new copy of it.

A `paid_test` refund returns `{ "paymentStatus": "refunded", "mode": "paid_test", "duplicate": false }`. A Stripe test refund also returns `refundId`. `409` when the payment cannot be refunded or the Stripe key is not a test key. `503` `{ "error": "Payments not configured" }` when a real `paid` row has no Stripe secret.

## Order statuses

`draft` → `quoted` or `needs_review` → `confirmed` → `processing` → `preview_ready` → (`correction_requested` → `processing` → `preview_ready`) → `paid` → `approved` → `delivered`.

`failed` can be retried with `POST /api/orders/[token]/process`. `cancelled` is unused by these routes.

## Events

`order_events` records `upload_started`, `upload_done`, `quote_shown`, `preview_ready`, `preview_viewed`, `checkout_started`, `paid`, `refunded`, `downloaded`, `account_linked`, `translation_edited`, `note_added`, and `approved`. The raw token is never written on those rows.
