import { formatCardExpiry, formatCardLabel } from "@/lib/integrations/present";

export type SavedMethodFields = {
  brand: string;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
  email?: string | null;
  wallet?: "link" | null;
};

function brandName(brand: string): string {
  const known: Record<string, string> = {
    visa: "Visa",
    mastercard: "Mastercard",
    amex: "American Express",
    discover: "Discover",
  };
  const lower = brand.toLowerCase();
  return known[lower] ?? brand.charAt(0).toUpperCase() + brand.slice(1);
}

function LinkLogo() {
  return (
    <svg viewBox="0 0 48 20" className="h-5 w-12 shrink-0" aria-hidden>
      <rect width="48" height="20" rx="6" fill="#00D66F" />
      <text x="24" y="14" textAnchor="middle" fill="#011E0F" fontSize="12" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="600">
        link
      </text>
    </svg>
  );
}

export function SavedMethodSummary({ method }: { method: SavedMethodFields }) {
  const link = method.wallet === "link" || method.brand.toLowerCase() === "link";
  const digits = /^\d{4}$/.test(method.last4) ? method.last4 : null;
  const email = method.email?.trim() || null;
  const expiry =
    method.expMonth != null && method.expYear != null ? formatCardExpiry(method.expMonth, method.expYear) : null;
  const cardBrand = method.brand.toLowerCase() === "link" ? null : brandName(method.brand);
  return (
    <span className="min-w-0">
      <span className="flex items-center gap-2 text-[13.5px] font-medium">
        {link ? <LinkLogo /> : null}
        <span data-testid="saved-method-label">{link ? (email ? `Link · ${email}` : "Link") : formatCardLabel(brandName(method.brand), method.last4)}</span>
      </span>
      {link && digits ? (
        <span data-testid="saved-method-card" className="mt-0.5 block text-[12.5px] text-ink-muted">
          {formatCardLabel(cardBrand ?? "Card", digits)}
        </span>
      ) : null}
      {expiry ? (
        <span data-testid="card-exp" className="mt-0.5 block text-[12.5px] text-ink-muted">
          {expiry}
        </span>
      ) : null}
    </span>
  );
}
