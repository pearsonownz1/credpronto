# CredPronto

Certified translations with a preview before you pay. The public site is [credpronto.com](https://credpronto.com).

## Stack

- **Next.js** (App Router) on **Vercel**. Production deploys from `main`.
- **Supabase** (`credpronto-db`) for data and **private storage**. Migrations live in `supabase/migrations/` and are owned by Backend.
- **Resend** for transactional email.
- **Stripe Checkout** for payment.
- **EmbedPDF** for the in-browser document preview.

Secrets are Vercel environment variables. Read them at runtime. Do not hardcode them. `.env.example` lists names only.

## Scripts

```bash
npm run dev
npm run lint
npm run typecheck
npm run test
npm run build
```

## Folder conventions

| Path | Purpose |
| --- | --- |
| `src/app/` | App Router routes and layouts |
| `src/components/` | Shared UI |
| `src/lib/supabase/` | Browser and server Supabase clients (`@supabase/ssr`) |
| `src/styles/tokens.css` | Light-theme CSS variables |
| `src/proxy.ts` | Session refresh for Supabase Auth. Public pages stay open. |
| `public/` | Static assets |
| `supabase/migrations/` | SQL migrations. Backend owns this directory. |

`src/lib/supabase/client.ts` is for Client Components. `src/lib/supabase/server.ts` is for Server Components, Server Actions, and Route Handlers. `createServiceClient()` uses `SUPABASE_SERVICE_ROLE_KEY` and must stay on the server.
