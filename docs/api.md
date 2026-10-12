# CredPronto order API

Customer routes authenticate with the raw order token from the email link (`/order/<token>`). The database stores only the lowercase hex SHA-256 of that string in `orders.public_token_hash`. Server routes use the Supabase service role. Responses never include storage paths or the token hash.

Prices are `$9.95` per billable page (`unitPriceCents` 995). For Chinese, Japanese, and Korean, a billable page is `max(1, ceil(units / 400))` per original side. A unit is one Han, Hiragana, Katakana, or Hangul character, or one ASCII number or Latin-letter group (`3.85`, `2019`, `GPA`, and `2019-06` are each one unit). Spaces and punctuation count as 0. `学号 2019 GPA 3.85` is 5 units. Every other language stays `max(1, ceil(words / 250))` per original side, and an empty side is still 1. `GET /api/orders/[token]` returns that sentence in `pageRule`.

Uploads are normalized into one combined original PDF at `originals/<orderId>/original-combined.pdf`. Page N of the watermarked preview is the English translation of page N of that PDF.

The watermark is drawn in a separate render pass on every preview page: a repeating diagonal `PREVIEW · CREDPRONTO · NOT FOR OFFICIAL USE` in `#1F5EFF` at 16% opacity. The preview file has no certification page. The clean translation and the certification page are separate objects in the `finals` bucket and are not used to build the preview.

## `GET /api/orders/[token]/preview`

Signed URLs expire in 10 minutes. `translation.url` is the watermarked preview only.

{ status, totalCents, unitPriceCents, billablePages, original: { url (10-min signed), pageCount, pages: [{ number, widthPt, heightPt, documentId, documentIndex, documentName }] }, translation: { url (10-min signed, watermarked preview only), pageCount, pages: [{ number, widthPt, heightPt, documentId, documentIndex, documentName }], version }, corrections: [{ id, documentId, page, quote, note, status, createdAt }] }

```json
{
  "status": "preview_ready",
  "totalCents": 2985,
  "unitPriceCents": 995,
  "billablePages": 3,
  "original": {
    "url": "https://…",
    "pageCount": 3,
    "pages": [
      {
        "number": 1,
        "widthPt": 612,
        "heightPt": 792,
        "documentId": "…",
        "documentIndex": 0,
        "documentName": "diploma.pdf"
      }
    ]
  },
  "translation": {
    "url": "https://…",
    "pageCount": 3,
    "pages": [
      {
        "number": 1,
        "widthPt": 612,
        "heightPt": 792,
        "documentId": "…",
        "documentIndex": 0,
        "documentName": "diploma.pdf"
      }
    ],
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

`documentId` is the upload that page came from. `documentIndex` is the 0-based index of that upload in `documents` on `GET /api/orders/[token]` (upload order). `documentName` is that document's `filename`. Original and translation pages share `number`, `documentId`, `documentIndex`, and `documentName`, because page N of the watermarked preview is page N of the combined original.

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
  "email": "ada@example.com",
  "status": "quoted",
  "sourceLanguage": "es",
  "sourceLanguageConfidence": 0.92,
  "targetLanguage": "en",
  "languageConfirmed": false,
  "documents": [
    {
      "id": "…",
      "filename": "scan-page-2.jpg",
      "pageCount": 1,
      "detectedLanguage": "fr",
      "confidence": 0.92,
      "uploadPosition": 1,
      "appliedPosition": 2
    }
  ],
  "pageOrder": {
    "basis": "logical",
    "pages": [
      {
        "documentId": "…",
        "filename": "scan-page-1.jpg",
        "uploadPosition": 2,
        "appliedPosition": 1,
        "uploadPage": 1,
        "appliedPage": 1,
        "logicalPage": 1,
        "hint": "page 1/2",
        "confidence": 0.93
      }
    ]
  },
  "pages": [
    {
      "documentId": "…",
      "pageNumber": 1,
      "uploadPage": 1,
      "logicalPage": 1,
      "orderHint": "page 1/2",
      "qualityScore": 0.94,
      "qualityFlags": [],
      "qualityMessage": null
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

`email` is the customer address stored for the order. It is `null` only when that customer row is missing. `confirmations` has one row per document for each of `full_name`, `date_of_birth`, `parent_names`, `place_of_birth`, and `date_format`. `originalValue` is what the model read. `confirmedValue` is null until the customer confirms. `payment.status` is `pending`, `paid`, `paid_test`, `failed`, `canceled`, `expired`, or `refunded`. `delivery.status` is `pending`, `approved`, `delivered`, or `failed`.

`sourceLanguageConfidence` is the lowest document confidence, from 0 to 1.

`documents` stays in upload order, which is also `documentIndex` on preview pages and original downloads. `uploadPosition` is that upload order. `appliedPosition` is the order used for the combined original after analysis. `pageOrder` is null until analysis finishes. `basis` is `logical` when printed page numbers or continuation cues were confident enough to reorder pages, and `upload` when they were not. Pages inside one file are reordered on their own. Separate one-page files (a scan of page 2 uploaded before page 1) are reordered together only when every page has a confident sequence. Otherwise the upload order is kept. `logicalPage` is the printed number, `hint` is the cue (`page 1/2`, `suite`), and `confidence` is the model's score for that cue. The combined original PDF follows this applied order, so preview page N is still the translation of original page N.

`pages` lists each side after analysis. `pageNumber` is the applied page inside that file. `qualityScore` is legibility from 0 to 1. A severe flag caps it below `0.6`, so a high model score is not kept. `qualityFlags` may include `blurry`, `cropped`, `glare`, `too_dark`, and `unreadable_fields`. `qualityMessage` is the retake instruction when any flag is set, or when the score itself is below `0.6`. It is null when the page was not flagged and the score passed.

Quoted orders set `etaAt` about one hour out. `needs_review` sets it about 24 hours out and explains why in `reviewReason` (low confidence, unreadable page, unsupported language, detection unavailable, or `image_quality`).

A photo or scan the model sees (a phone picture, or a PDF page without a usable text layer) does not get a quote when legibility is below `0.6`, or when a severe flag is set: `blurry`, `too_dark`, `unreadable_fields`, or `cropped` (the crop cuts off text). A high score does not override those flags. `glare` alone does not hold the quote, but it still sets `qualityMessage`. `status` is `needs_review` and `reviewReason` is exactly `image_quality`, even if language detection also looks uncertain. `qualityMessage` tells the customer how to retake it. Billable pages and `totalCents` are still stored so staff can override. `POST /api/admin/orders/[id]/resolve-review` clears the hold and moves the order to `quoted` without a new photo. Until then, confirm, preview, and checkout stay blocked.

## `POST /api/orders/[token]/documents/[documentId]/replace`

Multipart upload with one `file` (or `files`) field. Allowed only when `status` is `needs_review` and `reviewReason` is `image_quality`. The file replaces that document and every document on the order is read again. The response is the `GET /api/orders/[token]` shape with `status` `draft`. Analysis runs after the response. A readable replacement can then be quoted. Another unreadable photo stays `needs_review` with `reviewReason` `image_quality`.

`400` when the file is missing or empty. `404` when the token or document is unknown. `409` when the order is not waiting on a retake. `415` for an unsupported type. The same size limits as `POST /api/orders` apply.

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

The Checkout line is `CredPronto certified translation (N pages)`. `price_data.product_data.description` names the languages, the documents, and the billable pages, for example `French → English · fr_diplome-licence.pdf · 1 page`. Language codes are shown as names (`fr` → French, `en` → English). The first document name follows upload order. Further documents are `+N more` (`acta.pdf` plus two others → `acta.pdf +2 more`). One billable page reads `1 page`; any other count reads `N pages`.

`price_data.product_data.images[0]` is a signed URL, valid for 25 hours, for a PNG of page 1 of the watermarked translation preview. The PNG's longer side is about 1000px. It is stored in the private `previews` bucket at `checkout-previews/<orderId>/<random>.png`. A later checkout for the same order reuses that PNG and signs a new URL. The object is the watermarked preview in `previews`, whose key starts with `preview-`. If rendering or signing fails, the session is still created without `images`, and the error is logged.

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

## `GET /api/orders/[token]/download?file=translation|certification|original`

`translation` and `certification` are the clean files in `finals`.

| Payment | Delivery | Result |
| --- | --- | --- |
| not `paid` or `paid_test` (including `refunded`) | any | `402` `{ "error": "Payment required" }` |
| settled | not `approved` or `delivered` | `403` `{ "error": "Certification is not approved" }` |
| settled | `approved` or `delivered` | `200` |

```json
{
  "url": "https://…",
  "filename": "fr_diplome-licence-EN-certified.pdf",
  "expiresInSeconds": 300
}
```

The URL is a 5-minute signed URL for the object in `finals` (`translation` → clean translated PDF, `certification` → certification page). `createSignedUrl` is called with `download` set to `filename`, so the response carries `Content-Disposition` and the browser saves that name. A `downloaded` event is recorded. The URL is not stored.

`filename` is built from the source document name (`documentName`, the upload's `documents.filename`):

| File | Name |
| --- | --- |
| `translation` | `{base}-{TARGET}-certified.pdf` |
| `certification` | `{base}-certificate.pdf` |
| `original` | the original `documentName`, kept as safe ASCII |

`base` is that name without its extension. `fr_diplome-licence.pdf` with target language `en` becomes `fr_diplome-licence-EN-certified.pdf`, `fr_diplome-licence-certificate.pdf`, and `fr_diplome-licence.pdf`. `{TARGET}` is the order's target language code in uppercase (`en` → `EN`). Characters outside ASCII letters, digits, `.`, `_`, and `-` are folded or replaced. Accents fold (`diplôme` → `diplome`). A name with no safe stem uses `document`. A sample name such as `birth-certificate` is used only when that is the uploaded name.

A multi-document order names each original from its own document. The translation and the certification are still one PDF each; their base joins every document stem in upload order (`fr_diplome-licence.pdf` and `releve.pdf` → `fr_diplome-licence-releve-EN-certified.pdf`).

`file=original` returns the customer's own uploads from the private `originals` bucket (`documents.original_path`, not the combined PDF). The token is enough at any order status. Payment and certification are not checked. Each URL expires in 5 minutes (`expiresInSeconds` 300) and is signed with `download` set to that file's `filename`. A `downloaded` event is recorded with `file` set to `original` and `documentIds` listing the files that were signed. The response does not include storage paths.

Pass `documentId` to sign one upload. When `documentId` is omitted and the order has one document, the body is that same single-file object. When `documentId` is omitted and the order has more than one document, the body is a list in upload order. `documentIndex` and `documentName` match the preview page fields (`documentName` is `documents[].filename`).

One file (`documentId` set, or the only upload):

```json
{
  "url": "https://…",
  "filename": "diploma.pdf",
  "expiresInSeconds": 300,
  "documentId": "…",
  "documentIndex": 0,
  "documentName": "diploma.pdf"
}
```

`documentIndex` stays the index in the full order. Asking for the second upload returns `"documentIndex": 1`.

Several uploads, no `documentId`:

```json
{
  "expiresInSeconds": 300,
  "originals": [
    {
      "documentId": "…",
      "documentIndex": 0,
      "documentName": "diploma.pdf",
      "filename": "diploma.pdf",
      "url": "https://…"
    },
    {
      "documentId": "…",
      "documentIndex": 1,
      "documentName": "transcript.pdf",
      "filename": "transcript.pdf",
      "url": "https://…"
    }
  ]
}
```

`404` `{ "error": "Unknown document." }` when `documentId` is not on the order. `404` `{ "error": "That file is not ready" }` when the order has no uploads. `400` `{ "error": "file must be translation, certification, or original" }` for any other `file`.

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
  "translation": {
    "url": "https://…",
    "filename": "fr_diplome-licence-EN-certified.pdf",
    "expiresInSeconds": 300
  },
  "certification": {
    "url": "https://…",
    "filename": "fr_diplome-licence-certificate.pdf",
    "expiresInSeconds": 300
  }
}
```

`filename` follows the same rules as `GET /api/orders/[token]/download`. Each signed URL is created with the Supabase Storage `download` option set to that filename (`Content-Disposition`). `email` is `sent`, `skipped`, or `failed`. When email fails the delivery stays `approved` and the signed URLs are still returned. The delivery email tells the customer to open the order link from the earlier message. The raw token is not stored, so that email cannot contain a new copy of it.

A `paid_test` refund returns `{ "paymentStatus": "refunded", "mode": "paid_test", "duplicate": false }`. A Stripe test refund also returns `refundId`. `409` when the payment cannot be refunded or the Stripe key is not a test key. `503` `{ "error": "Payments not configured" }` when a real `paid` row has no Stripe secret.

## Order statuses

`draft` → `quoted` or `needs_review` → `confirmed` → `processing` → `preview_ready` → (`correction_requested` → `processing` → `preview_ready`) → `paid` → `approved` → `delivered`.

After translation, QA runs before `preview_ready`. A failing QA retranslates up to 2 times. If it still fails, the order becomes `needs_review` and `reviewReason` names the QA issues. `failed` can be retried with `POST /api/orders/[token]/process`. `cancelled` is unused by these routes.

## Evaluations

An evaluation is an order whose `orderType` is `evaluation`. `service` is `diploma` or `course_by_course`. A translation order leaves `service` null and `orderType` as `translation`. This `service` is the evaluation kind. It is not the partner field `service` on `POST /api/v1/orders`, which is still `translation` or `evaluation` (`orders.service_type`).

### Upload choice

`POST /api/orders` accepts these extra form fields. The front end sends them with the files.

| Field | Required | Notes |
| --- | --- | --- |
| `orderType` | no | `translation` (default) or `evaluation` |
| `service` | yes when `orderType` is `evaluation` | `diploma` or `course_by_course` |
| `degreeCount` | yes when `orderType` is `evaluation` | Integer ≥ 1. The number of degrees to price |

`400` when an evaluation is missing `service` or `degreeCount`, or when `service` is not one of those two values.

`GET /api/orders/[token]` echoes the choice on every status:

```json
{
  "orderType": "evaluation",
  "service": "diploma",
  "degreeCount": 1
}
```

`orderType` is `translation` and `service` and `degreeCount` are null on a translation order.

### Price

Amounts are integer cents. The evaluation fee and, when the source is not English, the translation fee are separate Stripe line items on one Checkout session.

| `service` | Per degree |
| --- | --- |
| `diploma` | `1995` ($19.95) |
| `course_by_course` | `3995` ($39.95) |

`evaluationCents` is `degreeCount` times that unit. When `sourceLanguage` is `en`, there is no translation line and `translationCents` is `0`. Otherwise the translation uses the same billable-page rule as a translation order (`unitPriceCents` `995`) and `translationCents` is `billablePages * 995`. `totalCents` is `evaluationCents + translationCents`. It is not `billablePages * unitPriceCents`.

```json
{
  "evaluationCents": 1995,
  "translationCents": 1990,
  "totalCents": 3985,
  "lineItems": [
    {
      "kind": "evaluation",
      "description": "Diploma evaluation",
      "quantity": 1,
      "unitAmountCents": 1995,
      "amountCents": 1995
    },
    {
      "kind": "translation",
      "description": "Certified translation",
      "quantity": 2,
      "unitAmountCents": 995,
      "amountCents": 1990
    }
  ]
}
```

A course-by-course evaluation uses the description `Course-by-course evaluation` and `unitAmountCents` `3995`. The translation line is omitted when `translationCents` is `0`. `lineItems` is an empty array until the quote exists.

### Flow

Upload, then a watermarked preview of the evaluation report, then payment, then staff approval before the clean report is released. The statuses are `draft` → `preview_ready` or `needs_review` → `paid` → `approved` → `delivered`. Checkout is allowed only at `preview_ready`, the same gate as a translation. There is no 10-minute preview promise and no one-hour delivery promise. `etaAt` is null.

The watermark is the same diagonal `PREVIEW · CREDPRONTO · NOT FOR OFFICIAL USE` used on translation previews. `preview.report` is that watermarked PDF (`url`, `pageCount`). It is null before the report exists. `GET /api/orders/[token]/download?file=evaluation` returns the clean report only after payment and staff approval, the same gate as `file=translation`.

`needs_review` is used when the credential or the grades cannot be mapped. Staff resolve it with the existing resolve-review route.

### Diploma result

`evaluation` is null until the report is built. `credentials` has one object per degree.

```json
{
  "kind": "diploma",
  "credentials": [
    {
      "applicant": "Ada Lovelace",
      "institution": "Université de Paris",
      "country": "France",
      "credential": "Licence",
      "field": "Mathematics",
      "dates": "2016–2019",
      "usEquivalency": "Bachelor's degree",
      "documentsReviewed": ["fr_diplome-licence.pdf"]
    }
  ]
}
```

`dates` is the period as printed. `documentsReviewed` lists the uploaded filenames that support that degree. `usEquivalency` is one of `High school diploma`, `Associate degree`, `Bachelor's degree`, `Master's degree`, or `Doctoral degree`.

| Printed credential | `usEquivalency` |
| --- | --- |
| high school, bachillerato, baccalauréat | High school diploma |
| associate | Associate degree |
| bachelor, licenciatura, licence, bachelor's | Bachelor's degree |
| master, maestría, maîtrise, master's | Master's degree |
| doctor, doctorado, doctorat, doctoral | Doctoral degree |

Anything else stays `needs_review`. The preview PDF prints a blue equivalency box at the top, then these fields, then the documents reviewed.

### Course-by-course result

```json
{
  "kind": "course_by_course",
  "applicant": "Ada Lovelace",
  "institution": "Université de Paris",
  "country": "France",
  "credential": "Licence",
  "years": [
    {
      "year": "2018–2019",
      "courses": [
        {
          "originalName": "Algèbre",
          "englishName": "Algebra",
          "localCredits": 6,
          "localGrade": "14",
          "usSemesterHours": 6,
          "usGrade": "A-",
          "gradePoints": 22.2
        }
      ]
    }
  ],
  "totalHours": 6,
  "gpa": 3.7,
  "gradeScale": "Grades are on a 20-point scale. 16–20 is A (4.0), 14–15.99 is A- (3.7), 12–13.99 is B (3.0), 10–11.99 is C (2.0), and below 10 is F (0)."
}
```

Rows are grouped by `year`. Each course has the original name, the English name, local credits, the local grade as printed, US semester hours, the US grade, and grade points. `totalHours` is the sum of US semester hours. `gpa` is total grade points divided by `totalHours`, rounded to two decimals. `gradeScale` explains the scale that was applied.

US semester hours equal local credits. Grade points for a row are US semester hours times the point value, rounded to two decimals.

A 10-point scale (passing mark 6), used when printed grades are out of 10:

| Local grade | US grade | Points |
| --- | --- | --- |
| 9.0–10 | A | 4.0 |
| 8.0–8.9 | B | 3.0 |
| 7.0–7.9 | C | 2.0 |
| 6.0–6.9 | D | 1.0 |
| below 6 | F | 0 |

A 20-point scale (passing mark 10), used when printed grades are out of 20:

| Local grade | US grade | Points |
| --- | --- | --- |
| 16–20 | A | 4.0 |
| 14–15.99 | A- | 3.7 |
| 12–13.99 | B | 3.0 |
| 10–11.99 | C | 2.0 |
| below 10 | F | 0 |

A letter grade already printed as A–F, with an optional `+` or `-`, keeps that letter. Points are A 4.0, A- 3.7, B+ 3.3, B 3.0, B- 2.7, C+ 2.3, C 2.0, C- 1.7, D+ 1.3, D 1.0, D- 0.7, F 0. A grade that matches neither scale sets the order to `needs_review`.

The preview PDF prints total hours and GPA at the top, then a table grouped by year with a totals row (hours and GPA again), then `gradeScale` beneath the table.

## Events

`order_events` records `upload_started`, `upload_done`, `quote_shown`, `preview_ready`, `preview_viewed`, `checkout_started`, `paid`, `refunded`, `downloaded`, `account_linked`, `translation_edited`, `note_added`, `approved`, and `staff_notified`. The raw token is never written on those rows. `staff_notified` is written once when a new order finishes upload. It is the staff notification for now. Email to staff comes later. The payload is `{ "channel": "event" }`.

## Integrations

Signed-in routes under `/api/me` use the same cookie session as `GET /api/me/orders`. `401` `{ "error": "Sign in required" }` when the session is missing. `503` `{ "error": "Auth is not configured" }` when Supabase auth is missing.

### API keys

A key is `cp_live_` or `cp_test_` plus 32 bytes of CSPRNG hex (64 hex characters). The database stores only the lowercase hex SHA-256 of the full string in `api_keys.key_hash`. The raw key is returned once, on create. Later reads return `prefix`, `last4` (the last 4 characters of the full key), and `name`. The hash and the raw key are never returned again.

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| `GET` | `/api/me/api-keys` | | `{ "keys": [ { id, name, prefix, last4, createdAt, revokedAt } ] }` |
| `POST` | `/api/me/api-keys` | `{ "name": "Production", "mode": "live" \| "test" }` | `201` `{ id, name, prefix, last4, secret, createdAt }`. `secret` is the full key. |
| `DELETE` | `/api/me/api-keys/[id]` | | `{ "id", "revokedAt" }`. A revoked key no longer authenticates. `404` when the id is not owned by the session. |

`name` is 1 to 80 characters. `mode` is required. `prefix` is `cp_live_` when `mode` is `live` and `cp_test_` when `mode` is `test`.

### Saved card

One Stripe Customer per profile (`billing_customers.user_id`). Card numbers are not stored. The row keeps `stripe_customer_id`, `payment_method_id`, `brand`, and `last4`.

| Method | Path | Result |
| --- | --- | --- |
| `POST` | `/api/me/billing/setup-intent` | `{ "clientSecret": "seti_…", "customerId": "cus_…" }`. Creates the Stripe Customer on first use and a SetupIntent with `usage: off_session`. |
| `GET` | `/api/me/billing` | `{ "card": { "brand": "visa", "last4": "4242" } }` or `{ "card": null }` |
| `DELETE` | `/api/me/billing` | Detaches the payment method and clears `payment_method_id`, `brand`, and `last4`. The Stripe Customer id stays. `{ "card": null }` |

SetupIntent and the off-session charge run only when `STRIPE_SECRET_KEY` starts with `sk_test_`. Otherwise `503` `{ "error": "Payments not configured", "code": "payments_not_configured" }`. The webhook `setup_intent.succeeded` copies `brand` and `last4` onto the row. `POST /api/me/billing/setup-intent` can also be confirmed by the client; `GET` reads whatever is stored.

### Outbound webhook

One endpoint per profile.

`PUT /api/me/webhook`

```json
{ "url": "https://example.com/hooks/credpronto" }
```

```json
{ "url": "https://example.com/hooks/credpronto", "secret": "whsec_…" }
```

`url` must be `https`. `400` `{ "error": "Webhook URL must be https", "code": "validation_error" }` otherwise. The signing secret is 32 bytes of hex prefixed with `whsec_`. It is stored so deliveries can be signed, and it is returned only from this `PUT`. A later `PUT` rotates it and returns the new secret once.

Deliveries are posted for orders whose `user_id` has an endpoint:

| Event | When |
| --- | --- |
| `order.quoted` | Analysis sets the order to `quoted` |
| `order.delivered` | Delivery becomes `delivered` |
| `order.failed` | The order becomes `failed` |

```json
{
  "id": "evt_…",
  "type": "order.quoted",
  "createdAt": "2026-10-12T00:00:00.000Z",
  "data": {
    "orderId": "…",
    "status": "quoted",
    "externalRef": null
  }
}
```

`CredPronto-Signature` is `t=<unix seconds>,v1=<hex>`. `v1` is HMAC-SHA256 of `${t}.${rawBody}` using the current signing secret, hex-encoded. Receivers reject a timestamp more than 5 minutes off.

Each delivery is stored in `webhook_deliveries`. A non-2xx response or a network error is retried up to 3 attempts total (immediately, then after 60 seconds, then after 5 minutes). `attempt` is 1, 2, or 3. `status` is `pending`, `succeeded`, or `failed`. After the third failure the row stays `failed` and no further retry is scheduled.

### Public API

`Authorization: Bearer <secret>`. The secret is hashed and matched to an unrevoked `api_keys` row. `401` `{ "error": "Invalid API key", "code": "invalid_api_key" }` otherwise.

While `STRIPE_SECRET_KEY` starts with `sk_test_`, `cp_live_` keys may call `GET` but `POST /api/v1/orders` returns `403` `{ "error": "Live mode is disabled", "code": "live_mode_disabled" }`. `cp_test_` keys may create orders.

#### `POST /api/v1/orders`

`multipart/form-data`.

| Field | Required | Notes |
| --- | --- | --- |
| `files` | yes | Same rules as `POST /api/orders`. `file` is also accepted. |
| `source_language` | yes for `translation` | Confirmed immediately. No separate confirm call. |
| `target_language` | no | Defaults to `en` |
| `service` | yes | `translation` or `evaluation` |
| `external_ref` | no | Stored on the order. Unique per `user_id`. A repeat returns the existing order with `200`. |

The order is owned by the key's user (`orders.user_id`). Analysis quotes it. The saved card is then charged off-session for `totalCents` in Stripe test mode (`confirm: true`, `off_session: true`). A successful charge marks the payment `paid`, records `paid`, and for `translation` starts the normal translation pipeline. `evaluation` is quoted and charged the same way, then set to `needs_review` with `reviewReason` `Credential evaluation is reviewed by staff.` It does not enter translation.

`201` after a new charge:

```json
{
  "id": "…",
  "status": "paid",
  "service": "translation",
  "sourceLanguage": "es",
  "targetLanguage": "en",
  "externalRef": "crm-1842",
  "billablePages": 3,
  "unitPriceCents": 995,
  "totalCents": 2985,
  "currency": "usd",
  "payment": { "status": "paid" }
}
```

No saved card, after the quote exists:

`402`

```json
{
  "error": "A saved card is required",
  "code": "card_required",
  "orderId": "…",
  "totalCents": 2985,
  "currency": "usd"
}
```

The order stays `quoted` and can be charged by repeating the request with the same `external_ref` once a card is saved. Stripe decline is `402` `{ "error": "The card was declined", "code": "card_declined", "orderId": "…" }`. The payment row is `failed`.

Other codes: `400` `validation_error`, `415` `unsupported_type`, `409` `quote_unavailable` when analysis cannot price the order, `503` `payments_not_configured`.

#### `GET /api/v1/orders/[id]`

The shape above, plus `reviewReason` and `qa` (the same object as the admin order, or `null`). `404` `{ "error": "Order not found", "code": "not_found" }` when the id is not owned by the key's user.

#### `GET /api/v1/orders/[id]/files`

Originals are the caller's uploads and are signed at any status. The clean translation and the certification page follow the same payment and approval gate as `GET /api/orders/[token]/download`. When that gate is closed they are `null`, not an error.

```json
{
  "downloadAvailable": false,
  "originals": [
    {
      "documentId": "…",
      "filename": "diploma.pdf",
      "url": "https://…",
      "expiresInSeconds": 300
    }
  ],
  "translation": null,
  "certification": null
}
```

When the gate is open, `translation` and `certification` are `{ "url", "filename", "expiresInSeconds": 300 }` using the same filenames as the token download.

## Fulfillment QA

After each translation render, and before `preview_ready`, the server compares the original page text with the translation.

Checked:

| `type` | Fails the run when |
| --- | --- |
| `name` | A confirmed `full_name`, `parent_names`, or `place_of_birth` value is missing from the translation. |
| `date` | A confirmed `date_of_birth` is missing from the translation. |
| `number` | A number of 2 or more digits in the original text is missing from the translation. |
| `missing_text` | An original page with text has an empty translation. |
| `layout` | The translation page count differs from the original page count. |

`severity` is `high`, `medium`, or `low`. The checks above are `high`. `score` starts at 100 and loses 25 per high issue, 10 per medium, and 5 per low, with a floor of 0. The run fails when any high issue exists or `score` is below 80.

On failure the order is retranslated, up to 2 times (3 QA runs total). Prior issues are passed into the next translation. A failing run that will be retried is stored as `retranslated` and still lists its `issues`. The run that passes on the first attempt is `pass` with `issues: []`. A pass after at least one retranslation is `retranslated` with `issues: []` and `attempts` greater than 1. The run that still fails on attempt 3 is `fail`, the order becomes `needs_review`, and `reviewReason` is `QA found issues that were not fixed after 2 retranslations.`

`GET /api/admin/orders/[id]` includes `qa`. `null` when no run exists.

```json
{
  "status": "fail",
    "score": 75,
  "checkedAt": "2026-10-12T00:00:00.000Z",
  "attempts": 3,
  "issues": [
    {
      "type": "name",
      "severity": "high",
      "page": 1,
      "original": "Ada Lovelace",
      "translated": "",
      "note": "Confirmed full_name is missing from the translation."
    }
  ]
}
```

`page` is the combined page number, or `null` for a layout issue that covers the whole order. `checkedAt` is the latest run's timestamp. `attempts` is how many runs exist for the order.

The clean translation in `finals` (`file=translation`) starts with the certification cover page, then the translated pages. The watermarked preview does not include the cover. The separate certification object (`file=certification`) is still the cover alone. The cover text is the existing translator certification (order id, date, source language to English).

### Tables

`api_keys`: `id`, `user_id` → `auth.users`, `name`, `prefix` (`cp_live_` or `cp_test_`), `key_hash` (unique lowercase hex SHA-256), `last4`, `created_at`, `revoked_at` null until delete. RLS: the owner selects their rows; staff select all. Writes go through the service role.

`billing_customers`: `user_id` primary key → `auth.users`, `stripe_customer_id` unique, `payment_method_id` null, `brand` null, `last4` null, `created_at`, `updated_at`. No card number. RLS: the owner selects their row. Writes go through the service role.

`webhook_endpoints`: `id`, `user_id` unique → `auth.users`, `url`, `signing_secret`, `created_at`, `updated_at`. The secret is not readable by the customer session. RLS: no customer policy. Staff select. Writes go through the service role.

`webhook_deliveries`: `id`, `endpoint_id`, `order_id`, `event` (`order.quoted`, `order.delivered`, `order.failed`), `attempt`, `status` (`pending`, `succeeded`, `failed`), `response_status` null, `created_at`, `next_retry_at` null. RLS: staff select. Writes go through the service role.

`order_qa_runs`: `id`, `order_id`, `attempt` (unique per order, 1–3), `status` (`pass`, `fail`, `retranslated`), `score` 0–100, `issues` jsonb, `created_at`. RLS: staff select. Customers do not select QA rows. Writes go through the service role.

New enum values (`order_event_type` value `staff_notified`, and the QA status labels when stored as an enum) land in their own migration files. A later file creates the table or inserts the row. Do not add an enum value and use it in the same file.
