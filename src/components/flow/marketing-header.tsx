import { Suspense } from "react";
import Link from "next/link";
import { getAccount } from "@/lib/account/session";
import { Logo } from "./mark";

const SECTIONS = [
  { id: "translations", label: "Translations", href: "/" },
  { id: "evaluations", label: "Evaluations", href: "/evaluations" },
  { id: "pricing", label: "Pricing", href: "/#pricing" },
] as const;

const RESOURCES = [
  { href: "/guides", label: "Guides" },
  { href: "/faq", label: "FAQ" },
] as const;

function SignInLink() {
  return (
    <Link href="/sign-in" data-testid="nav-log-in" className="text-sm font-semibold text-ink">
      Sign in
    </Link>
  );
}

async function MarketingAccountLinks() {
  const account = await getAccount();
  if (!account) return <SignInLink />;
  return (
    <Link href="/account" data-testid="nav-my-orders" className="text-sm font-semibold text-ink">
      My orders
    </Link>
  );
}

function ResourcesMenu() {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none text-ink-muted [&::-webkit-details-marker]:hidden">
        Resources
      </summary>
      <div className="absolute left-0 z-30 mt-2 min-w-40 rounded-[var(--cp-radius)] border border-line bg-bg p-1 shadow-lg">
        {RESOURCES.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="block rounded px-3 py-2 text-ink hover:bg-bg-muted"
          >
            {item.label}
          </Link>
        ))}
      </div>
    </details>
  );
}

function SectionNav({
  section,
  className,
}: {
  section?: (typeof SECTIONS)[number]["id"];
  className: string;
}) {
  return (
    <nav aria-label="Sections" className={className}>
      {SECTIONS.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          aria-current={item.id === section ? "page" : undefined}
          className={item.id === section ? "font-semibold text-ink" : "text-ink-muted"}
        >
          {item.label}
        </Link>
      ))}
      <ResourcesMenu />
    </nav>
  );
}

export function MarketingHeader({
  section,
}: {
  section?: (typeof SECTIONS)[number]["id"];
}) {
  return (
    <div className="border-b border-line">
      <header className="flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 md:gap-x-7 md:px-10">
        <Logo />
        <SectionNav section={section} className="hidden items-center gap-7 text-sm md:flex" />
        <div className="ml-auto flex items-center gap-3 md:gap-7">
          <Suspense fallback={<SignInLink />}>
            <MarketingAccountLinks />
          </Suspense>
        </div>
      </header>
      <div className="px-4 pb-3 md:hidden">
        <SectionNav section={section} className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm" />
      </div>
    </div>
  );
}
