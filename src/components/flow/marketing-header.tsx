import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { getAccount } from "@/lib/account/session";
import { Logo } from "./mark";
import { buttonClasses } from "./ui";

const SECTIONS = [
  { id: "evaluations", label: "Evaluations", href: "/evaluations" },
  { id: "translations", label: "Translations", href: "/" },
  { id: "preval", label: "PreVal", href: "/preval" },
  { id: "pricing", label: "Pricing", href: "/#pricing" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

/** Blue active treatment from the PreVal comp. Other sections keep the existing active style. */
const PREVAL_ACTIVE = "font-bold text-[#2160ff]";

function sectionLinkClass(id: SectionId, current?: SectionId) {
  if (id !== current) return "text-ink-muted";
  if (id === "preval") return PREVAL_ACTIVE;
  return "font-semibold text-ink";
}

const RESOURCES = [
  { href: "/guides", label: "Guides" },
  { href: "/faq", label: "FAQ" },
] as const;

const getStartedClass = buttonClasses(
  "primary",
  "h-[38px] whitespace-nowrap px-3 text-[13px] md:px-[18px] md:text-sm",
);

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
    <Link href="/dashboard" data-testid="nav-my-orders" className="text-sm font-semibold text-ink">
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
  testId,
}: {
  section?: SectionId;
  className: string;
  testId: string;
}) {
  return (
    <nav aria-label="Sections" data-testid={testId} className={className}>
      {SECTIONS.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          aria-current={item.id === section ? "page" : undefined}
          data-testid={item.id === "preval" ? "nav-preval" : undefined}
          className={sectionLinkClass(item.id, section)}
        >
          {item.label}
        </Link>
      ))}
      <ResourcesMenu />
    </nav>
  );
}

export function MarketingHeaderFrame({
  section,
  account,
}: {
  section?: SectionId;
  account: ReactNode;
}) {
  return (
    <div className="border-b border-line">
      <header className="flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 md:gap-x-7 md:px-10">
        <Logo />
        <SectionNav section={section} testId="nav-desktop" className="hidden items-center gap-7 text-sm md:flex" />
        <div className="ml-auto flex items-center gap-3 md:gap-7">
          {account}
          <Link href="/translate" data-testid="nav-get-started" className={getStartedClass}>
            Get started
          </Link>
        </div>
      </header>
      <div className="px-4 pb-3 md:hidden" data-testid="nav-mobile">
        <SectionNav
          section={section}
          testId="nav-mobile-links"
          className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm"
        />
      </div>
    </div>
  );
}

export function MarketingHeader({
  section,
}: {
  section?: SectionId;
}) {
  return (
    <MarketingHeaderFrame
      section={section}
      account={
        <Suspense fallback={<SignInLink />}>
          <MarketingAccountLinks />
        </Suspense>
      }
    />
  );
}
