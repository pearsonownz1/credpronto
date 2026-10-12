import Link from "next/link";
import type { FlowStep } from "@/lib/flow/types";
import { Logo } from "./mark";
import { Stepper } from "./stepper";
import { buttonClasses } from "./ui";

const SECTIONS = ["Translations", "Evaluations", "Expert letters", "Pricing"];

export function MarketingHeader() {
  return (
    <header className="flex h-16 items-center gap-3 border-b border-line px-4 md:gap-7 md:px-10">
      <Logo />
      <nav
        aria-label="Sections"
        className="hidden items-center gap-7 text-sm text-ink-muted md:flex"
      >
        {SECTIONS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-7">
        <span className="hidden text-sm text-ink-muted md:inline">
          Find my order
        </span>
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
  );
}

export function FlowHeader({ current }: { current: FlowStep }) {
  return (
    <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-4 py-3 md:h-16 md:px-10 md:py-0">
      <Logo />
      <div className="min-w-0 overflow-x-auto">
        <Stepper current={current} />
      </div>
      <span className="text-sm text-ink-muted">Help</span>
    </header>
  );
}
