# CredPronto data model

CredPronto sells a certified translation before the customer pays. The customer uploads documents and an email address, sees an exact price, checks a watermarked preview, and only then pays. Staff approve the certification, and the clean PDF plus the certification page are released by a short-lived signed link.

A buyer can stay anonymous and come back with the order token, or sign in. `customers` is still the email address on the order. `profiles` is the `auth.users` row (one per account) and `orders.user_id` is set when a verified sign-in claims orders for that email. Later products (credential evaluation, expert letters) are additional `orders.service_type` values on this same model, not a second schema.

The database is Postgres on Supabase. Files live in private Storage buckets. Token routes on the Next.js server still use the service role after checking the order token. A signed-in customer may also select their own rows under RLS. Staff select and write under RLS, and the admin routes use the service role after the same staff check.

## Access

Row level security is enabled on every application table. There are no policies for `anon`. `staff_all` on each table lets an `authenticated` user read and write a row when `private.is_staff()` is true.

`private.is_staff()` is `security definer` and lives in the `private` schema, which the Data API does not expose. It returns true when `auth.uid()` matches `staff.user_id`, or when `profiles.is_admin` is true for that user. Because it runs as the owner, the staff policy can read `staff` and `profiles` without the policy calling itself. `search_path` is empty so the function cannot be redirected at a different table.

Customers who are signed in may `select` their own orders (`orders.user_id = auth.uid()`) and the documents, previews, and payment rows on those orders. Those policies are select-only. Payment rows include status, amount, timestamps, and the Stripe ids stored on the row. Card data is not stored. They cannot select other customers' rows, and they cannot select source text, translations, notes, or deliveries through the Data API. Token routes do not use the customer JWT. They check the order token, then use the service role, which bypasses RLS.

Staff use the admin API as `authenticated` users who have a `staff` row or `profiles.is_admin`. The first admin is a service-role update of `profiles.is_admin` (SQL editor or a seed), because a non-staff session cannot update that column. A reviewer is still a `staff` row. Approving a delivery writes `deliveries.approved_by`, which references `staff`. An `is_admin` profile with no staff row is inserted into `staff` as `admin` at approval time so that foreign key holds.

`anon` is revoked from every application table. A leaked anon key cannot read orders, documents, or payments even if a policy is added later by mistake and forgotten for one table — the grant is gone too. Do not grant these tables back to `anon`.

## Order token

Each order has an unguessable token that brings the customer back to the quote, the preview, and the download without an account.

The server generates at least 32 bytes from a CSPRNG and puts that raw token in the email link. The database stores only the lowercase hex SHA-256 of the exact string in the link, in `orders.public_token_hash`. A check constraint rejects anything that is not 64 hex characters, so a raw token cannot be written into the column. The column is unique. Lookup is equality on the hash. Do not log the raw token, and do not put it in `order_events.data`.

The hash is not a password hash. It does not need to be slow. It only prevents a database read from becoming a list of live links.

## Billable pages

Price for a translation is `$9.95` per billable page (`orders.unit_price_cents` defaults to `995`, `currency` defaults to `usd`).

A billable page is one physical side, priced from the text on that side. `billable_units` stores the density for that side, at least 1, including a blank side (`word_count` 0). `skipped` and `skip_reason` decide whether that density is charged. Blank pages, shipping labels, and pages that are already English (when the translation is into English) are stored with `skipped` true. The order total and each `pageLineItems` row count those sides as 0. Turning the skip off charges the stored density. The check still accepts `billable_units = 0`.

For Chinese, Japanese, and Korean (`billing_basis = 'cjk'`), `word_count` stores the Han, Hiragana, Katakana, and Hangul character count. Digits and Latin letters on that page are not added.

```text
billable_units = 0 or greatest(1, ceil(word_count / 1000))
```

| CJK characters on that side | Density stored |
| --- | --- |
| 0 | 1 |
| 1–1000 | 1 |
| 1001–2000 | 2 |

For every other page (`billing_basis = 'words'`):

```text
billable_units = 0 or greatest(1, ceil(word_count / 250))
```

| Words on that side | Density stored |
| --- | --- |
| 0 | 1 |
| 1–250 | 1 |
| 251–500 | 2 |
| 501–750 | 3 |

The check constraint `document_pages_billable_rule_chk` rejects any other pair. `word_count` and `billable_units` stay null until the count is known. `GET /api/orders/[token]` returns the sentence for the rule that applied in `pageRule`, and `pageLineItems` with `pageIndex`, `billableUnits`, `skip`, and `skipReason`.

`orders.billable_pages` is the sum of charged units across every side: 0 when that side is skipped, otherwise its `billable_units`. For a translation, `orders.total_cents` must equal `billable_pages * unit_price_cents + addon_cents` whenever the page count and total are set. `addon_cents` defaults to 0. A translation cannot move to `paid`, `approved`, or `delivered` unless the language pair is confirmed, `billable_pages` is at least 1, and the total matches that product. Evaluation and expert-letter orders may carry a total without a page count.

Example: a two-sided diploma, 180 words on the first side and 400 on the second, is `1 + 2 = 3` billable pages, `$29.85`, `total_cents = 2985`.

## Status flow

`orders.status` is the customer-visible workflow. The database does not encode every transition, so a later `service_type` can reuse the same statuses. These are the translation transitions the server should perform:

1. `draft` — email captured, upload starting. Acquisition fields (`utm_source`, `utm_medium`, `utm_campaign`, `gclid`, `landing_path`) are written here.
2. `quoted` — language and billable pages are known and `total_cents` is set. `quote_shown` is recorded.
3. `needs_review` — detection confidence is low, a page is flagged (`document_pages.needs_review`), a photo failed the image-quality gate (`review_reason` is `image_quality`), or a person has to look before a price is trustworthy. `review_reason` says why. Staff clear it back into `quoted` or `processing`. `image_quality` can also be cleared by the customer uploading a replacement photo that passes the gate.
4. `confirmed` — the customer has accepted the language pair (`language_confirmed`) and the name and date fields in `confirmations`.
5. `processing` — a translation job is running.
6. `preview_ready` — a watermarked preview version exists. The customer compares it with the original.
7. `correction_requested` — the customer asked for a change. Open `corrections` rows are regenerated into the next preview version, marked `resolved` with `resolved_preview_version`, and the order returns to `preview_ready`.
8. `paid` — Stripe Checkout completed. A `payments` row is `paid` and a `deliveries` row exists in `pending`.
9. `approved` — a staff user has certified the translation. `deliveries.status` is `approved`.
10. `delivered` — the email with the signed links has been sent.
11. `cancelled` — the customer or staff stopped the order before delivery.
12. `failed` — processing or payment failed and the order will not continue without a new attempt.

`cancelled` and `failed` are terminal for that order. A new upload is a new order.

Related statuses:

- `documents.status`: `uploaded` → `processing` → `ready`, or `failed`.
- `translations.status` and `previews.status`: `pending` → `ready`, or `failed`.
- `corrections.status`: `open` → `resolved` (a preview version fixed it) or `dismissed`. A resolved row must name `resolved_preview_version`. An open or dismissed row must not.
- `payments.status`: `pending` → `paid`, or `failed` / `canceled`. `charge.refunded` sets `refunded` (which still requires `paid_at`) and download is locked again. At most one settled (`paid` or `paid_test`) row per order.
- `deliveries.status`: `pending` → `approved` → `delivered`, or `failed`. Approval requires `approved_by` (a `staff.user_id`) and `approved_at`. Delivery also requires `delivered_at`. Approved and delivered rows must both have `final_path` and `certification_path`.

## Tables

### `profiles`

One row per `auth.users` id. A trigger on `auth.users` insert creates it, and existing users are backfilled. `is_admin` defaults to false. The signed-in user can select their own row. Only staff can update it, so a customer cannot set `is_admin` on themselves.

### `customers`

The buyer email captured at upload. `email` is `citext` and unique, so `Ada@example.com` and `ada@example.com` are one person. `name` is optional until they confirm it. This table is not the login. The login is `auth.users` plus `profiles`.

### `orders`

One purchase of one `service_type`: `translation`, `evaluation`, or `expert_letter`. `order_type` repeats that product and defaults to `translation`. A customer evaluation also sets `service` to `diploma` or `course_by_course` and `degree_count` to the number of degrees. `evaluation_cents` is `degree_count` times 1995 or 3995. `translation_cents` is 0 when the source is English and otherwise `billable_pages * unit_price_cents`. For those orders `total_cents` is `evaluation_cents + translation_cents + addon_cents`, not the page product alone. `addon_cents` is the sum of checkout add-ons. `expedited` is true when an evaluation purchased that add-on. New translation orders store false. Older translation rows may still be true, and the staff queue sorts those orders first. Mail stores `shipping_name`, `shipping_line1`, `shipping_line2`, `shipping_city`, `shipping_state`, `shipping_postal_code`, and `shipping_country` (`US`). `mail_status` is `pending` or `shipped`, with `mail_tracking` once it ships. `notarization_status` is `pending` or `done`. Apply `supabase/migrations/20261012080000_order_addons.sql` separately; the app does not run it. `evaluation_result` is the diploma credentials or the course-by-course table. `target_language` defaults to `en`. `source_language` is filled by detection and then confirmed. `eta_at` is the promise shown with the quote. `public_token_hash` is the return-link secret described above. `user_id` is a nullable foreign key to `auth.users`. It stays null until a verified sign-in claims the order. Claim matches `customers.email` to the verified account email and only updates rows whose `user_id` is still null. `progress` is jsonb `{ step, pagesRead, pagesTotal, retries? }`. `step` is `uploaded`, `reading`, `language`, `counting`, `quoting`, `done`, or `translating`. `pagesRead` and `pagesTotal` are integers and `pagesRead` is never greater than `pagesTotal`. `retries` is an optional non-negative integer; the translation watchdog increments it once before flagging a stuck job. The quote pipeline updates that column alone, once per extracted page and once when it moves to language, counting, quoting, or done. Apply `supabase/migrations/20261012120000_order_progress.sql` and `supabase/migrations/20261012140000_progress_translating.sql` separately; the app does not run them. `updated_at` is maintained by `private.set_updated_at` on every update. `edge_credential_id` and `edge_grading_scale_id` point at the matched EDGE rows for an evaluation. Both are null until a match. Customer routes do not return them. Apply `supabase/migrations/20261012090000_edge_reference.sql` separately; the app does not run it and does not load the rows.

### `order_addons`

One purchased checkout add-on. `addon_id` is `notarization`, `mail`, or `expedited`. `unit_cents` and `quantity` multiply to `total_cents`. Notarization and mail have quantity 1. Expedited quantity is the billable page count. New translation orders reject `expedited`; diploma and course-by-course evaluations can still purchase it. The check constraint still allows `expedited` so older rows stay valid. Replacing the selection at checkout deletes the previous rows for that order. Customers who own the order may select these rows. Staff may select, insert, update, and delete them.

### `documents`

One uploaded file on an order. `original_path` is the object key in the `originals` bucket, not a URL and not prefixed with the bucket name. `size` is bytes. `page_count` is the number of sides. `detected_language` and `confidence` (0 through 1) come from detection. `position` stays the upload order. `applied_position` is the order analysis used for the combined original; it stays null until then. Deleting an order deletes its documents.

### `document_pages`

One side of a document. `page_number` starts at 1 and is unique per document. After analysis it is the applied page inside that file, matching the combined original. `upload_page` is the page index in the uploaded file before that reorder. `logical_page` is the printed page number when the model saw one. `order_hint` is the cue (`page 1/2`, `suite`). `ocr_text` is the text used for the word count and for the side-by-side review. `needs_review` marks a side a person must check (low confidence, unreadable scan, suspected wrong language, or a failed image-quality gate). `quality_score` is legibility from 0 to 1. `quality_flags` is a subset of `blurry`, `cropped`, `glare`, `too_dark`, and `unreadable_fields`. `quality_message` is the retake text when a photo or scan is flagged, or when its score is below 0.6. Severe flags (`blurry`, `too_dark`, `unreadable_fields`, `cropped` when the crop cuts off text) cap `quality_score` below 0.6 and set `orders.review_reason` to `image_quality`. `billable_units` follows the rule above.

`orders.page_order_basis` is `logical` or `upload`. `orders.page_order` is the recorded sequence: each page's upload position, applied position, upload page, applied page, logical page, hint, and confidence.

### `edge_credentials`

Licensed AACRAO EDGE credential reference. Columns: `id` uuid, `country_slug`, `country`, `title`, `content`, `level_number`, `level_title`, `url`, `us_equivalency` (nullable). Index on `(country_slug, lower(title))`. RLS is enabled with no anon or authenticated policy. Only the service role can read or write. The source files are not in the repo.

Load one object keyed by country. A key that is already a lowercase hyphenated slug is `country_slug`. Any other key uses `countrySlug(country)`, then `countrySlug(key)`. `countrySlug` strips accents, lowercases, and turns other characters into single hyphens (`México` → `mexico`, `Côte d'Ivoire` → `cote-d-ivoire`, `United States` → `united-states`). Loaded rows used that same rule on the country name, so an official name can be a long slug such as `korea-republic-of-south-korea`. Order matching slugifies the order country the same way. An exact `country_slug` wins. Otherwise the order slug must sit on a hyphen boundary inside exactly one stored slug (prefix, suffix, or middle), so `South Korea` or `Korea` can match `korea-republic-of-south-korea`. Two stored slugs that both match are left unmatched.

```json
{
  "mexico": {
    "country": "Mexico",
    "credentials": [
      {
        "title": "…",
        "content": "…",
        "level": { "number": 6, "title": "…" },
        "url": "https://…",
        "us_equivalency": "Bachelor's degree"
      }
    ],
    "grading_scales": [
      {
        "title": "…",
        "raw": null,
        "rows": [{ "indigenous_grade": "10", "us_equivalent": "A" }]
      }
    ]
  }
}
```

Each credential becomes one `edge_credentials` row: `country_slug`, `country`, `title`, `content` (empty string when blank), `level_number` from `level.number`, `level_title` from `level.title`, `url`, `us_equivalency`. Blank `url` and `us_equivalency` are null. `id` is generated. A blank title is skipped.

### `edge_grading_scales`

Licensed grading scales for the same country groups. Columns: `id` uuid, `country_slug`, `title`, `raw` (nullable original text), `rows` jsonb. `rows` is an array of `{indigenous_grade, us_equivalent}`. A row missing either string is dropped. A loaded `title` is the section, name, and qualifier joined with ` — `. `raw` is the original entry. With printed grades, the scale whose rows match the most grades is used, and a tie matches nothing. With no grades, one scale for the country is used; otherwise a title segment or `raw` must uniquely match the credential. Same RLS as `edge_credentials`: service role only, no anon or authenticated policy.

### `confirmations`

Name and date fields the customer accepts before translation. `field_key` identifies the field (`applicant_name`, `date_of_birth`, `document_date`, and so on). `original_value` is what OCR extracted. `confirmed_value` is what the customer kept or corrected. One row per field per order. The translation uses `confirmed_value`.

### `translations`

One generation of a document translation. `version` starts at 1 and increases when a correction is regenerated. `model` is the model id. `output` is `jsonb`: a JSON object of structured segments, or a JSON string when the model returns plain text. Versions are unique per document.

### `previews`

One watermarked rendering of the whole order, not of a single document. `version` matches the preview the customer is looking at. `preview_path` is the object key in the `previews` bucket. A correction's `resolved_preview_version` points at the version that incorporated it.

### `corrections`

A customer request to change the preview. `passage` is the text they highlighted. `note` is what they want changed. `page_number` requires `document_id`. Several open corrections may be resolved by the same new preview version.

### `payments`

One Stripe Checkout attempt. `stripe_checkout_session_id` is unique. `stripe_payment_intent_id` is filled when Stripe creates it and is indexed for the webhook. `amount_cents` is the amount charged and should equal `orders.total_cents`. A new attempt after a failure inserts a new row. Orders that have a payment cannot be deleted.

### `deliveries`

The release of the certified files. One row per order. Created when payment succeeds, with `status = pending` and null paths. Staff set `approved_by` and `approved_at` when they certify. The server sets `delivered_at` after it emails the links. `approved_by` references `staff`, so only a staff user can be recorded, and that staff row cannot be removed while the approval exists. Orders that have a delivery cannot be deleted.

### `order_events`

Product-funnel events, separate from the UTM columns (those record where the visitor came from; these record what they did):

`landing_view`, `upload_started`, `upload_done`, `quote_shown`, `preview_ready`, `preview_viewed`, `checkout_started`, `paid`, `refunded`, `downloaded`, `account_linked`, `translation_edited`, `note_added`, `approved`.

`account_linked` is recorded when a verified sign-in claims the order. `translation_edited` is a staff edit of the translation text. `note_added` is a staff note. `approved` is staff certification. `refunded` is a Stripe refund or the `paid_test` placeholder. The enum values for the account events are added in their own migration and are not inserted by that file.

`landing_view` may be inserted before a draft order exists, so `order_id` is nullable only for that type. Later events require an order. `data` is extra context (page path, document id, preview version). Do not put the raw order token in `data`.

### `order_notes`

A staff note on an order. `author_id` references `auth.users`. `body` is 1 to 4000 characters after trim. Customers have no policy. Deleting the order deletes its notes. Deleting the author is restricted while a note names them.

### `staff`

`user_id` references `auth.users`. `role` is `admin` or `reviewer`. Both roles have full read and write through RLS; the role is for the admin UI, not for a second set of policies. `profiles.is_admin` is a second way into `private.is_staff()`. Deleting the auth user deletes the staff row unless a delivery still names them as `approved_by`.

## Storage

Three private buckets, inserted into `storage.buckets` with `public = false`:

| Bucket | Holds | Written by | Read by |
| --- | --- | --- | --- |
| `originals` | Customer uploads (`documents.original_path`) | Service role | Staff, via `staff_read_originals` |
| `previews` | Watermarked preview PDFs (`previews.preview_path`) | Service role | Staff, via `staff_read_previews` |
| `finals` | Clean translation and the certification page | Service role | Staff, via `staff_read_finals` |

Object keys are stored on the row. The bucket name is not part of the key.

`storage.objects` already has row level security on Supabase. This migration does not run `alter table storage.objects enable row level security`, because Supabase owns that table and repeating the statement breaks a fresh project. The only policies added are staff `select` on these three buckets. There is no insert, update, or delete policy, and no anon policy. The service role bypasses RLS, uploads the files, and creates signed URLs.

`finals` stays private after approval. The customer does not receive the service role key and has no storage policy, so the object is not readable with the anon key. After `payments.status` is `paid` and a staff member has approved the delivery (`deliveries.status` in `approved` or `delivered`, which requires both file keys), the server creates a short-lived signed URL (minutes, not days) for `final_path` and for `certification_path` and emails those links. When the URL expires, the object is still private. A new link is another signed URL from a server route that checks the order token, payment, and approval again. The watermarked preview is the file the customer may look at before paying; the clean PDF in `finals` is the file they receive only after both payment and staff certification.
