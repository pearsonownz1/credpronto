import Link from "next/link";

const LINKS = [
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
] as const;

export function SiteFooter() {
  return (
    <footer className="preview-theme mt-auto border-t border-line bg-bg text-ink">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-6 py-6 text-sm text-ink-muted md:flex-row md:items-center md:justify-between">
        <p>CredPronto</p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="font-semibold text-ink hover:text-primary">
              {link.label}
            </Link>
          ))}
        </nav>
        <p>Certified translations. Preview before you pay.</p>
      </div>
    </footer>
  );
}
