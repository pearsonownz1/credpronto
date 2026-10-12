import Link from "next/link";
import type { FlowStep } from "@/lib/flow/types";
import { Logo } from "./mark";
import { Stepper } from "./stepper";
import { buttonClasses } from "./ui";

const SECTIONS = [
  { id: "translations", label: "Translations", href: "/" },
  { id: "evaluations", label: "Evaluations", href: "/evaluations" },
  { id: "pricing", label: "Pricing", href: "/#pricing" },
] as const;

export function MarketingHeader({
  section,
}: {
  section?: (typeof SECTIONS)[number]["id"];
}) {
  return (
    <div className="border-b border-line">
      <header className="flex h-16 items-center gap-3 px-4 md:gap-7 md:px-10">
        <Logo />
        <SectionNav
          section={section}
          className="hidden items-center gap-7 text-sm md:flex"
        />
        <div className="ml-auto flex items-center gap-7">
          <span className="hidden text-sm text-ink-muted md:inline">Find my order</span>
          <Link
            href="/translate"
            className={buttonClasses(
              "primary",
              "h-[38px] px-3 text-[13px] md:px-[18px] md:text-sm",
            )}
          >
            Get your free preview
          </Link>
        </div>
      </header>
      <div className="px-4 pb-3 md:hidden">
        <SectionNav
          section={section}
          className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm"
        />
      </div>
    </div>
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
    </nav>
  );
}

export function FlowHeader({ current }: { current: FlowStep }) {
  return (
    <header className="border-b border-line">
      <div className="flex items-center justify-between px-4 py-3 md:hidden">
        <Logo />
        <span className="text-sm text-ink-muted">Help</span>
      </div>
      <div className="overflow-x-auto px-4 pb-3 md:hidden">
        <Stepper current={current} compact />
      </div>
      <div className="hidden h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-10 md:grid">
        <Logo />
        <div className="min-w-0 overflow-x-auto">
          <Stepper current={current} />
        </div>
        <span className="text-sm text-ink-muted">Help</span>
      </div>
    </header>
  );
}
